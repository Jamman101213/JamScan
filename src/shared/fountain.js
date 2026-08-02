// Adapted from Decimen Optical Transfer under the MIT License.

import { splitmix32 } from "./protocol.js";

const LN2 = 0.6931471805599453;
const SOLITON_C = 0.1;
const SOLITON_DELTA = 0.5;

function deterministicLog(value) {
  let exponent = 0;
  let mantissa = value;
  while (mantissa >= 1.5) {
    mantissa /= 2;
    exponent++;
  }
  while (mantissa < 0.75) {
    mantissa *= 2;
    exponent--;
  }
  const z = (mantissa - 1) / (mantissa + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let n = 1; n <= 21; n += 2) {
    sum += term / n;
    term *= z2;
  }
  return exponent * LN2 + 2 * sum;
}

function solitonCdf(k) {
  const cdf = new Float64Array(k);
  if (k === 1) {
    cdf[0] = 1;
    return cdf;
  }
  const r = Math.max(1, SOLITON_C * deterministicLog(k / SOLITON_DELTA) * Math.sqrt(k));
  const spike = Math.min(k, Math.ceil(k / r));
  let total = 0;
  for (let degree = 1; degree <= k; degree++) {
    const rho = degree === 1 ? 1 / k : 1 / (degree * (degree - 1));
    let tau = 0;
    if (degree < spike) tau = r / (degree * k);
    else if (degree === spike) tau = (r * Math.max(0, deterministicLog(r / SOLITON_DELTA))) / k;
    total += rho + tau;
    cdf[degree - 1] = total;
  }
  for (let i = 0; i < k; i++) cdf[i] /= total;
  cdf[k - 1] = 1;
  return cdf;
}

function frameSeed(sessionId, seq) {
  let hash = (Math.imul(sessionId + 1, 0x9e3779b1) ^ (seq + 0x85ebca6b)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) | 0;
}

function frameIndices(k, cdf, sessionId, seq) {
  // Send source blocks directly at the start of every cycle.
  const repairCount = Math.max(4, Math.ceil(k * 0.35));
  const cycleLength = k + repairCount;
  const cyclePosition = seq % cycleLength;
  if (cyclePosition < k) return [cyclePosition];

  const random = splitmix32(frameSeed(sessionId, seq));
  const sample = random() * 2 ** -32;
  let low = 0;
  let high = k - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cdf[middle] >= sample) high = middle;
    else low = middle + 1;
  }
  const degree = Math.min(k, low + 1);
  if (degree > k >> 3) {
    const scratch = new Uint32Array(k);
    for (let i = 0; i < k; i++) scratch[i] = i;
    const output = new Array(degree);
    for (let i = 0; i < degree; i++) {
      const j = i + (random() % (k - i));
      const temp = scratch[i];
      scratch[i] = scratch[j];
      scratch[j] = temp;
      output[i] = scratch[i];
    }
    return output;
  }
  const output = new Set();
  while (output.size < degree) output.add(random() % k);
  return [...output];
}

function xorInto(target, source) {
  for (let i = 0; i < target.length; i++) target[i] = (target[i] ^ source[i]) >>> 0;
}

export class LTEncoder {
  constructor(payload, blockLen, sessionId) {
    this.blockLen = blockLen;
    this.sessionId = sessionId;
    this.k = Math.max(1, Math.ceil(payload.length / blockLen));
    this.words = Math.ceil(blockLen / 4);
    this.blocks = new Uint32Array(this.k * this.words);
    const bytes = new Uint8Array(this.blocks.buffer);
    for (let block = 0; block < this.k; block++) {
      const source = payload.subarray(block * blockLen, Math.min((block + 1) * blockLen, payload.length));
      bytes.set(source, block * this.words * 4);
    }
    this.cdf = solitonCdf(this.k);
  }

  encode(seq) {
    const indices = frameIndices(this.k, this.cdf, this.sessionId, seq);
    const output = new Uint32Array(this.words);
    for (const block of indices) {
      const offset = block * this.words;
      for (let word = 0; word < this.words; word++) {
        output[word] = (output[word] ^ this.blocks[offset + word]) >>> 0;
      }
    }
    return new Uint8Array(output.buffer, 0, this.blockLen);
  }
}

export class LTDecoder {
  constructor(k, blockLen, sessionId, totalLen) {
    this.k = k;
    this.blockLen = blockLen;
    this.sessionId = sessionId;
    this.totalLen = totalLen;
    this.words = Math.ceil(blockLen / 4);
    this.cdf = solitonCdf(k);
    this.solved = new Array(k).fill(null);
    this.byBlock = new Map();
    this.seen = new Set();
    this.solvedCount = 0;
    this.framesNew = 0;
    this.framesDup = 0;
  }

  get isComplete() {
    return this.solvedCount >= this.k;
  }

  addFrame(seq, block) {
    if (this.seen.has(seq)) {
      this.framesDup++;
      return;
    }
    this.seen.add(seq);
    this.framesNew++;
    if (this.isComplete) return;
    const indices = new Set(frameIndices(this.k, this.cdf, this.sessionId, seq));
    const words = new Uint32Array(this.words);
    new Uint8Array(words.buffer).set(block.subarray(0, this.blockLen));
    for (const index of [...indices]) {
      const solved = this.solved[index];
      if (solved) {
        xorInto(words, solved);
        indices.delete(index);
      }
    }
    if (indices.size === 0) return;
    if (indices.size === 1) {
      this.resolve(indices.values().next().value, words);
      return;
    }
    const pending = { indices, words };
    for (const index of indices) {
      let set = this.byBlock.get(index);
      if (!set) {
        set = new Set();
        this.byBlock.set(index, set);
      }
      set.add(pending);
    }
  }

  resolve(firstBlock, firstWords) {
    const queue = [[firstBlock, firstWords]];
    while (queue.length) {
      const [block, words] = queue.pop();
      if (this.solved[block]) continue;
      this.solved[block] = words;
      this.solvedCount++;
      const waiting = this.byBlock.get(block);
      if (!waiting) continue;
      this.byBlock.delete(block);
      for (const pending of waiting) {
        xorInto(pending.words, words);
        pending.indices.delete(block);
        if (pending.indices.size === 1) {
          const remaining = pending.indices.values().next().value;
          this.byBlock.get(remaining)?.delete(pending);
          if (!this.solved[remaining]) queue.push([remaining, pending.words]);
        }
      }
    }
  }

  assemble() {
    if (!this.isComplete) return null;
    const output = new Uint8Array(this.totalLen);
    for (let block = 0; block < this.k; block++) {
      const start = block * this.blockLen;
      const length = Math.min(this.blockLen, this.totalLen - start);
      if (length > 0) output.set(new Uint8Array(this.solved[block].buffer, 0, length), start);
    }
    return output;
  }
}
