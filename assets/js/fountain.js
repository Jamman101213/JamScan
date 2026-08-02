(() => {
  "use strict";

  // Adapted from Decimen Optical Transfer under the MIT License.
  // Copyright (c) 2026 BashAlarmist. See licenses/DECIMEN-MIT.txt.
  const LN2 = 0.6931471805599453;
  const SOLITON_C = 0.1;
  const SOLITON_DELTA = 0.5;

  // Random number generator
  function splitmix32(seed) {
    let state = seed | 0;

    return () => {
      state = (state + 0x9e3779b9) | 0;
      let value = state ^ (state >>> 16);
      value = Math.imul(value, 0x21f0aaad);
      value ^= value >>> 15;
      value = Math.imul(value, 0x735a2d97);
      value ^= value >>> 15;
      return value >>> 0;
    };
  }

  // Deterministic logarithm
  function deterministicLog(value) {
    let exponent = 0;
    let mantissa = value;

    while (mantissa >= 1.5) {
      mantissa /= 2;
      exponent += 1;
    }

    while (mantissa < 0.75) {
      mantissa *= 2;
      exponent -= 1;
    }

    const z = (mantissa - 1) / (mantissa + 1);
    const zSquared = z * z;
    let term = z;
    let sum = 0;

    for (let number = 1; number <= 21; number += 2) {
      sum += term / number;
      term *= zSquared;
    }

    return exponent * LN2 + 2 * sum;
  }

  // Degree distribution
  function makeSolitonCdf(blockCount) {
    const cdf = new Float64Array(blockCount);

    if (blockCount === 1) {
      cdf[0] = 1;
      return cdf;
    }

    const r = Math.max(
      1,
      SOLITON_C * deterministicLog(blockCount / SOLITON_DELTA) * Math.sqrt(blockCount)
    );
    const spike = Math.min(blockCount, Math.ceil(blockCount / r));
    let total = 0;

    for (let degree = 1; degree <= blockCount; degree += 1) {
      const rho = degree === 1 ? 1 / blockCount : 1 / (degree * (degree - 1));
      let tau = 0;

      if (degree < spike) tau = r / (degree * blockCount);
      else if (degree === spike) {
        tau = (r * Math.max(0, deterministicLog(r / SOLITON_DELTA))) / blockCount;
      }

      total += rho + tau;
      cdf[degree - 1] = total;
    }

    for (let index = 0; index < blockCount; index += 1) cdf[index] /= total;
    cdf[blockCount - 1] = 1;
    return cdf;
  }

  // Frame seed
  function frameSeed(streamId, sequence) {
    let value = (Math.imul(streamId + 1, 0x9e3779b1) ^ (sequence + 0x85ebca6b)) | 0;
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return (value ^ (value >>> 16)) | 0;
  }

  // Frame block list
  function frameIndices(blockCount, cdf, streamId, sequence) {
    const random = splitmix32(frameSeed(streamId, sequence));
    const sample = random() * 2 ** -32;
    let low = 0;
    let high = blockCount - 1;

    while (low < high) {
      const middle = (low + high) >> 1;
      if (cdf[middle] >= sample) high = middle;
      else low = middle + 1;
    }

    const degree = Math.min(blockCount, low + 1);

    if (degree > blockCount >> 3) {
      const scratch = new Uint32Array(blockCount);
      for (let index = 0; index < blockCount; index += 1) scratch[index] = index;

      const output = new Array(degree);
      for (let index = 0; index < degree; index += 1) {
        const selected = index + (random() % (blockCount - index));
        const saved = scratch[index];
        scratch[index] = scratch[selected];
        scratch[selected] = saved;
        output[index] = scratch[index];
      }
      return output;
    }

    const output = new Set();
    while (output.size < degree) output.add(random() % blockCount);
    return [...output];
  }

  // XOR words
  function xorWords(target, source) {
    for (let index = 0; index < target.length; index += 1) {
      target[index] = (target[index] ^ source[index]) >>> 0;
    }
  }

  // Fountain encoder
  class Encoder {
    constructor(payload, blockLength, streamId) {
      this.blockLength = blockLength;
      this.streamId = streamId >>> 0;
      this.blockCount = Math.max(1, Math.ceil(payload.length / blockLength));
      this.wordCount = Math.ceil(blockLength / 4);
      this.blocks = new Uint32Array(this.blockCount * this.wordCount);

      const bytes = new Uint8Array(this.blocks.buffer);
      for (let block = 0; block < this.blockCount; block += 1) {
        const source = payload.subarray(
          block * blockLength,
          Math.min((block + 1) * blockLength, payload.length)
        );
        bytes.set(source, block * this.wordCount * 4);
      }

      this.cdf = makeSolitonCdf(this.blockCount);
    }

    encode(sequence) {
      const indices = frameIndices(this.blockCount, this.cdf, this.streamId, sequence >>> 0);
      const output = new Uint32Array(this.wordCount);

      for (const block of indices) {
        const offset = block * this.wordCount;
        for (let word = 0; word < this.wordCount; word += 1) {
          output[word] = (output[word] ^ this.blocks[offset + word]) >>> 0;
        }
      }

      return new Uint8Array(output.buffer, 0, this.blockLength);
    }
  }

  // Fountain decoder
  class Decoder {
    constructor(blockCount, blockLength, streamId, totalLength) {
      this.blockCount = blockCount;
      this.blockLength = blockLength;
      this.streamId = streamId >>> 0;
      this.totalLength = totalLength;
      this.wordCount = Math.ceil(blockLength / 4);
      this.cdf = makeSolitonCdf(blockCount);
      this.solved = new Array(blockCount).fill(null);
      this.byBlock = new Map();
      this.seen = new Set();
      this.solvedCount = 0;
      this.framesNew = 0;
      this.framesDuplicate = 0;
    }

    get isComplete() {
      return this.solvedCount >= this.blockCount;
    }

    addFrame(sequence, block) {
      const seq = sequence >>> 0;

      if (this.seen.has(seq)) {
        this.framesDuplicate += 1;
        return false;
      }

      this.seen.add(seq);
      this.framesNew += 1;
      if (this.isComplete) return true;

      const indices = new Set(frameIndices(this.blockCount, this.cdf, this.streamId, seq));
      const words = new Uint32Array(this.wordCount);
      new Uint8Array(words.buffer).set(block.subarray(0, this.blockLength));

      for (const index of [...indices]) {
        const solved = this.solved[index];
        if (!solved) continue;
        xorWords(words, solved);
        indices.delete(index);
      }

      if (!indices.size) return true;

      if (indices.size === 1) {
        this.resolve(indices.values().next().value, words);
        return true;
      }

      const pending = { indices, words };
      for (const index of indices) {
        let waiting = this.byBlock.get(index);
        if (!waiting) {
          waiting = new Set();
          this.byBlock.set(index, waiting);
        }
        waiting.add(pending);
      }

      return true;
    }

    // Solve pending equations
    resolve(firstBlock, firstWords) {
      const queue = [[firstBlock, firstWords]];

      while (queue.length) {
        const [block, words] = queue.pop();
        if (this.solved[block]) continue;

        this.solved[block] = words;
        this.solvedCount += 1;

        const waiting = this.byBlock.get(block);
        if (!waiting) continue;
        this.byBlock.delete(block);

        for (const pending of waiting) {
          xorWords(pending.words, words);
          pending.indices.delete(block);

          if (pending.indices.size === 1) {
            const remaining = pending.indices.values().next().value;
            this.byBlock.get(remaining)?.delete(pending);
            if (!this.solved[remaining]) queue.push([remaining, pending.words]);
          }
        }
      }
    }

    // Build result
    result() {
      if (!this.isComplete) return null;

      const output = new Uint8Array(this.totalLength);
      for (let block = 0; block < this.blockCount; block += 1) {
        const start = block * this.blockLength;
        const length = Math.min(this.blockLength, this.totalLength - start);
        if (length > 0) {
          output.set(new Uint8Array(this.solved[block].buffer, 0, length), start);
        }
      }
      return output;
    }
  }

  window.JamScanFountain = {
    Encoder,
    Decoder,
    splitmix32
  };
})();
