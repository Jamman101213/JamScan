(() => {
  "use strict";

  // Format settings
  const DATA_GRID = 56;
  const FINDER = 8;
  const QUIET = 4;
  const BORDER = 2;
  const SEPARATOR = 2;
  const CODE_GRID = DATA_GRID + (QUIET + BORDER + SEPARATOR) * 2;
  const INNER_GRID = DATA_GRID + (BORDER + SEPARATOR) * 2;
  const FRAME_HEADER_BYTES = 36;
  const MAX_PAYLOAD = 320;
  const MAX_SOURCE_SIZE = 256 * 1024 * 1024;
  const FRAME_VERSION = 4;
  const MAGIC = new Uint8Array([0x4a, 0x53, 0x43, 0x41, 0x4e, 0x01]);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // Frame types
  const FRAME_TYPE = Object.freeze({
    START: 0,
    DATA: 1,
    END: 2,
    FOUNTAIN: 3
  });

  // Grid areas
  function isReserved(x, y) {
    return (
      (x < FINDER && y < FINDER) ||
      (x >= DATA_GRID - FINDER && y < FINDER) ||
      (x < FINDER && y >= DATA_GRID - FINDER) ||
      (x >= DATA_GRID - FINDER && y >= DATA_GRID - FINDER)
    );
  }

  // Corner marker
  function finderBit(x, y) {
    const localX = x >= DATA_GRID - FINDER ? x - (DATA_GRID - FINDER) : x;
    const localY = y >= DATA_GRID - FINDER ? y - (DATA_GRID - FINDER) : y;

    if (localX === 0 || localY === 0 || localX === FINDER - 1 || localY === FINDER - 1) return 1;
    if (localX === 1 || localY === 1 || localX === FINDER - 2 || localY === FINDER - 2) return 0;
    return 1;
  }

  // File size text
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "-";
    if (bytes < 1024) return `${bytes} B`;

    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = units[0];

    for (let index = 1; index < units.length && value >= 1024; index += 1) {
      value /= 1024;
      unit = units[index];
    }

    return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${unit}`;
  }

  // Time text
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "-";
    if (seconds < 60) return `${Math.ceil(seconds)} sec`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.ceil(seconds % 60);

    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  // Safe file name
  function safeName(name) {
    return (name || "shared-file")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 180);
  }

  // Content type
  function classify(type = "", name = "") {
    const mime = type.toLowerCase();
    const fileName = name.toLowerCase();

    if (mime === "image/gif" || fileName.endsWith(".gif")) return "gif";
    if (/^image\/(png|jpeg|webp|bmp|avif)$/.test(mime) || /\.(png|jpe?g|webp|bmp|avif)$/.test(fileName)) return "photo";
    if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/.test(fileName)) return "video";
    if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(fileName)) return "audio";
    if (mime.startsWith("text/") || /\.(txt|md|csv|json|xml|log|js|css|html?)$/.test(fileName)) return "text";
    return "file";
  }

  // Type label
  function kindLabel(kind) {
    const labels = {
      photo: "Photo or image",
      gif: "Animated GIF",
      video: "Video",
      audio: "Audio",
      text: "Text",
      file: "File or unknown"
    };

    return labels[kind] || "Unknown";
  }

  // Short type label
  function shortKind(kind) {
    const labels = {
      photo: "IMG",
      gif: "GIF",
      video: "VID",
      audio: "AUD",
      text: "TXT",
      file: "FILE"
    };

    return labels[kind] || "FILE";
  }

  // Frame type label
  function frameTypeLabel(type) {
    if (type === FRAME_TYPE.START) return "Start";
    if (type === FRAME_TYPE.DATA) return "Data";
    if (type === FRAME_TYPE.END) return "End";
    if (type === FRAME_TYPE.FOUNTAIN) return "Repair";
    return "Unknown";
  }

  // File MIME guess
  function mimeForName(name) {
    const extension = (name.split(".").pop() || "").toLowerCase();
    const types = {
      txt: "text/plain",
      md: "text/markdown",
      csv: "text/csv",
      json: "application/json",
      html: "text/html",
      htm: "text/html",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      webm: "video/webm",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg"
    };

    return types[extension] || "application/octet-stream";
  }

  // SHA-256 hash
  async function sha256Hex(bytes) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const hash = await crypto.subtle.digest("SHA-256", copy);

    return [...new Uint8Array(hash)]
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  // Join arrays
  function concatArrays(arrays) {
    const length = arrays.reduce((total, array) => total + array.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;

    for (const array of arrays) {
      output.set(array, offset);
      offset += array.length;
    }

    return output;
  }

  // Number helpers
  function u32le(value) {
    const array = new Uint8Array(4);
    new DataView(array.buffer).setUint32(0, value, true);
    return array;
  }

  function readU32le(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  }

  function writeU24(array, offset, value) {
    array[offset] = value & 255;
    array[offset + 1] = (value >>> 8) & 255;
    array[offset + 2] = (value >>> 16) & 255;
  }

  function readU24(array, offset) {
    return array[offset] | (array[offset + 1] << 8) | (array[offset + 2] << 16);
  }

  function writeU32(array, offset, value) {
    array[offset] = value & 255;
    array[offset + 1] = (value >>> 8) & 255;
    array[offset + 2] = (value >>> 16) & 255;
    array[offset + 3] = (value >>> 24) & 255;
  }

  function readU32(array, offset) {
    return (
      array[offset] |
      (array[offset + 1] << 8) |
      (array[offset + 2] << 16) |
      (array[offset + 3] << 24)
    ) >>> 0;
  }

  // Build package
  async function buildPackage(payload, name, type) {
    const hash = await sha256Hex(payload);
    const metadata = {
      app: "JamScan",
      version: 1,
      name: safeName(name),
      type: type || mimeForName(name),
      kind: classify(type, name),
      size: payload.length,
      created: new Date().toISOString(),
      sha256: hash
    };

    const header = textEncoder.encode(JSON.stringify(metadata));
    if (header.length > 1024 * 1024) throw new Error("Metadata is too large.");

    return {
      bytes: concatArrays([MAGIC, u32le(header.length), header, payload]),
      meta: metadata
    };
  }

  // Read package
  async function parsePackage(bytes) {
    if (bytes.length < MAGIC.length + 4) {
      throw new Error("This file is too small to be a JamScan package.");
    }

    for (let index = 0; index < MAGIC.length; index += 1) {
      if (bytes[index] !== MAGIC[index]) throw new Error("Invalid .jscan signature.");
    }

    const headerLength = readU32le(bytes, MAGIC.length);
    const headerStart = MAGIC.length + 4;
    const headerEnd = headerStart + headerLength;

    if (headerLength < 2 || headerEnd > bytes.length) {
      throw new Error("Damaged JamScan metadata.");
    }

    let meta;

    try {
      meta = JSON.parse(textDecoder.decode(bytes.slice(headerStart, headerEnd)));
    } catch {
      throw new Error("Unreadable JamScan metadata.");
    }

    const payload = bytes.slice(headerEnd);
    if (meta.size !== payload.length) {
      throw new Error("Size check failed. The package may be incomplete.");
    }

    const hash = await sha256Hex(payload);

    return {
      meta,
      payload,
      hashOK: hash === meta.sha256
    };
  }

  // CRC table
  const crcTable = (() => {
    const table = new Uint32Array(256);

    for (let number = 0; number < 256; number += 1) {
      let current = number;
      for (let bit = 0; bit < 8; bit += 1) {
        current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
      }
      table[number] = current >>> 0;
    }

    return table;
  })();

  // CRC check
  function crc32(bytes) {
    let current = 0xffffffff;

    for (const byte of bytes) {
      current = crcTable[(current ^ byte) & 255] ^ (current >>> 8);
    }

    return (current ^ 0xffffffff) >>> 0;
  }

  // Create stream
  function createStream(packageBytes) {
    const streamId = crypto.getRandomValues(new Uint32Array(1))[0];
    const encoder = new window.JamScanFountain.Encoder(packageBytes, MAX_PAYLOAD, streamId);

    return {
      streamId,
      total: encoder.blockCount,
      blockSize: MAX_PAYLOAD,
      packageLength: packageBytes.length,
      packageCRC: crc32(packageBytes),
      encoder
    };
  }

  // Create fountain frame
  function createFountainFrame(stream, sequence) {
    const payload = stream.encoder.encode(sequence >>> 0);
    const header = new Uint8Array(FRAME_HEADER_BYTES);

    header[0] = 0xa5;
    header[1] = 0x5a;
    header[2] = FRAME_VERSION;
    header[3] = FRAME_TYPE.FOUNTAIN;
    writeU32(header, 4, sequence >>> 0);
    writeU32(header, 8, stream.total >>> 0);
    header[12] = stream.blockSize & 255;
    header[13] = (stream.blockSize >>> 8) & 255;
    header[14] = 0;
    header[15] = 0;
    writeU32(header, 16, stream.packageLength >>> 0);
    writeU32(header, 20, stream.streamId >>> 0);
    writeU32(header, 24, stream.packageCRC >>> 0);
    writeU32(header, 28, crc32(payload));
    writeU32(header, 32, crc32(header.slice(0, 32)));

    return {
      header,
      payload,
      type: FRAME_TYPE.FOUNTAIN,
      index: sequence >>> 0,
      total: stream.total,
      streamId: stream.streamId,
      cycle: 0,
      sequence: sequence >>> 0,
      packageLength: stream.packageLength,
      packageCRC: stream.packageCRC,
      blockSize: stream.blockSize
    };
  }

  // Create test frames
  function createCycleFrames(stream, cycle, options = {}) {
    const count = Math.max(1, Number(options.count) || stream.total);
    const offset = Math.max(0, cycle) * count;
    const frames = [];

    for (let index = 0; index < count; index += 1) {
      frames.push(createFountainFrame(stream, offset + index));
    }

    return frames;
  }

  // Byte bits
  function bytesToBits(bytes) {
    const bits = [];

    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit -= 1) {
        bits.push((byte >>> bit) & 1);
      }
    }

    return bits;
  }

  function bitsToBytes(bits) {
    const output = new Uint8Array(Math.floor(bits.length / 8));

    for (let index = 0; index < output.length; index += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        byte = (byte << 1) | bits[index * 8 + bit];
      }
      output[index] = byte;
    }

    return output;
  }

  // Frame filler
  function xorshift(seed) {
    let value = seed || 0x13579bdf;

    return () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 4294967296;
    };
  }

  // Draw one code
  function drawFrame(context, frame, left, top, width, height) {
    const moduleWidth = width / CODE_GRID;
    const moduleHeight = height / CODE_GRID;
    const packet = concatArrays([frame.header, frame.payload]);
    const bits = bytesToBits(packet);
    const random = xorshift((frame.streamId ^ frame.sequence ^ 0x9e3779b9) >>> 0);
    let bitIndex = 0;

    context.fillStyle = "#ffffff";
    context.fillRect(left, top, width, height);

    for (let y = 0; y < CODE_GRID; y += 1) {
      for (let x = 0; x < CODE_GRID; x += 1) {
        const innerX = x - QUIET;
        const innerY = y - QUIET;
        let bit = 0;

        if (innerX >= 0 && innerY >= 0 && innerX < INNER_GRID && innerY < INNER_GRID) {
          const inBorder =
            innerX < BORDER ||
            innerY < BORDER ||
            innerX >= INNER_GRID - BORDER ||
            innerY >= INNER_GRID - BORDER;

          const dataStart = BORDER + SEPARATOR;
          const dataEnd = dataStart + DATA_GRID;

          if (inBorder) {
            bit = 1;
          } else if (innerX >= dataStart && innerY >= dataStart && innerX < dataEnd && innerY < dataEnd) {
            const dataX = innerX - dataStart;
            const dataY = innerY - dataStart;
            bit = isReserved(dataX, dataY)
              ? finderBit(dataX, dataY)
              : bitIndex < bits.length
                ? bits[bitIndex++]
                : random() > 0.5
                  ? 1
                  : 0;
          }
        }

        if (!bit) continue;
        context.fillStyle = "#111111";
        context.fillRect(
          left + Math.floor(x * moduleWidth),
          top + Math.floor(y * moduleHeight),
          Math.ceil(moduleWidth),
          Math.ceil(moduleHeight)
        );
      }
    }
  }

  // Draw one frame
  function renderFrame(canvas, frame) {
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawFrame(context, frame, 0, 0, canvas.width, canvas.height);
  }

  // Draw several codes in one flash
  function renderFrameGrid(canvas, frames) {
    const context = canvas.getContext("2d", { alpha: false });
    const list = frames.filter(Boolean).slice(0, 4);
    const count = Math.max(1, list.length);
    const columns = count === 1 ? 1 : 2;
    const rows = count <= 2 ? 1 : 2;
    const gap = Math.max(10, Math.round(Math.min(canvas.width, canvas.height) * 0.018));
    const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
    const cellHeight = (canvas.height - gap * (rows + 1)) / rows;
    const side = Math.floor(Math.min(cellWidth, cellHeight));

    context.imageSmoothingEnabled = false;
    context.fillStyle = "#e9e7e1";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < list.length; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = Math.round(gap + column * (cellWidth + gap) + (cellWidth - side) / 2);
      const top = Math.round(gap + row * (cellHeight + gap) + (cellHeight - side) / 2);
      drawFrame(context, list[index], left, top, side, side);
    }
  }

  // Marker check
  function verifyFinder(samples) {
    let matches = 0;
    let total = 0;

    for (let y = 0; y < DATA_GRID; y += 1) {
      for (let x = 0; x < DATA_GRID; x += 1) {
        if (!isReserved(x, y)) continue;
        total += 1;
        if (samples[y * DATA_GRID + x] === finderBit(x, y)) matches += 1;
      }
    }

    return matches / total;
  }

  // Grid rotation
  function rotateGrid(input) {
    const output = new Uint8Array(DATA_GRID * DATA_GRID);

    for (let y = 0; y < DATA_GRID; y += 1) {
      for (let x = 0; x < DATA_GRID; x += 1) {
        output[y * DATA_GRID + x] = input[(DATA_GRID - 1 - x) * DATA_GRID + y];
      }
    }

    return output;
  }

  // Grid mirror
  function mirrorGrid(input) {
    const output = new Uint8Array(DATA_GRID * DATA_GRID);

    for (let y = 0; y < DATA_GRID; y += 1) {
      for (let x = 0; x < DATA_GRID; x += 1) {
        output[y * DATA_GRID + x] = input[y * DATA_GRID + (DATA_GRID - 1 - x)];
      }
    }

    return output;
  }

  // Read grid packet
  function parseGridBits(bits) {
    if (verifyFinder(bits) < 0.78) throw new Error("Finder check failed");

    const dataBits = [];
    for (let y = 0; y < DATA_GRID; y += 1) {
      for (let x = 0; x < DATA_GRID; x += 1) {
        if (!isReserved(x, y)) dataBits.push(bits[y * DATA_GRID + x]);
      }
    }

    const headerBitCount = FRAME_HEADER_BYTES * 8;
    const header = bitsToBytes(dataBits.slice(0, headerBitCount));

    if (header[0] !== 0xa5 || header[1] !== 0x5a || header[2] !== FRAME_VERSION) {
      throw new Error("Not a JamScan frame");
    }

    if (header[3] !== FRAME_TYPE.FOUNTAIN) throw new Error("Unsupported frame type");
    if (crc32(header.slice(0, 32)) !== readU32(header, 32)) throw new Error("Header CRC mismatch");

    const sequence = readU32(header, 4);
    const total = readU32(header, 8);
    const blockSize = header[12] | (header[13] << 8);
    const packageLength = readU32(header, 16);
    const streamId = readU32(header, 20);
    const packageCRC = readU32(header, 24);
    const expectedCRC = readU32(header, 28);

    if (total < 1 || total > 1000000) throw new Error("Invalid block count");
    if (blockSize < 1 || blockSize > MAX_PAYLOAD) throw new Error("Invalid block size");
    if (packageLength < 1 || packageLength > MAX_SOURCE_SIZE + 2 * 1024 * 1024) {
      throw new Error("Invalid package length");
    }

    const payloadBits = dataBits.slice(headerBitCount, headerBitCount + blockSize * 8);
    if (payloadBits.length < blockSize * 8) throw new Error("Incomplete frame");

    const payload = bitsToBytes(payloadBits);
    if (crc32(payload) !== expectedCRC) throw new Error("CRC mismatch");

    return {
      type: FRAME_TYPE.FOUNTAIN,
      index: sequence,
      total,
      length: blockSize,
      streamId,
      cycle: 0,
      sequence,
      payload,
      packageLength,
      packageCRC,
      blockSize
    };
  }

  // Try grid directions
  function decodeGrid(bits) {
    let current = bits;

    for (let rotation = 0; rotation < 4; rotation += 1) {
      try {
        const frame = parseGridBits(current);
        frame.rotation = rotation * 90;
        frame.mirrored = false;
        return frame;
      } catch {
        current = rotateGrid(current);
      }
    }

    current = mirrorGrid(bits);

    for (let rotation = 0; rotation < 4; rotation += 1) {
      try {
        const frame = parseGridBits(current);
        frame.rotation = rotation * 90;
        frame.mirrored = true;
        return frame;
      } catch {
        current = rotateGrid(current);
      }
    }

    throw new Error("Frame damaged");
  }

  // Otsu threshold
  function getThreshold(gray) {
    const histogram = new Uint32Array(256);
    for (const value of gray) histogram[value] += 1;

    let totalSum = 0;
    for (let value = 0; value < 256; value += 1) totalSum += value * histogram[value];

    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 128;
    const total = gray.length;

    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;

      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;

      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;

      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = value;
      }
    }

    return threshold;
  }

  // Gray image
  function makeGray(imageData) {
    const gray = new Uint8Array(imageData.width * imageData.height);
    const source = imageData.data;

    for (let index = 0, pixel = 0; index < source.length; index += 4, pixel += 1) {
      gray[pixel] = Math.round(
        0.2126 * source[index] +
        0.7152 * source[index + 1] +
        0.0722 * source[index + 2]
      );
    }

    return gray;
  }

  // Component candidates
  function findBorderCandidates(gray, width, height, threshold) {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const candidates = [];
    const minimumSide = Math.max(44, Math.floor(Math.min(width, height) * 0.12));

    for (let start = 0; start < gray.length; start += 1) {
      if (visited[start] || gray[start] > threshold) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;

      let area = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let tl = start;
      let tr = start;
      let br = start;
      let bl = start;
      let minSum = Infinity;
      let maxSum = -Infinity;
      let minDiff = Infinity;
      let maxDiff = -Infinity;

      while (head < tail) {
        const point = queue[head++];
        const x = point % width;
        const y = Math.floor(point / width);
        area += 1;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const sum = x + y;
        const diff = x - y;
        if (sum < minSum) { minSum = sum; tl = point; }
        if (sum > maxSum) { maxSum = sum; br = point; }
        if (diff > maxDiff) { maxDiff = diff; tr = point; }
        if (diff < minDiff) { minDiff = diff; bl = point; }

        const left = point - 1;
        const right = point + 1;
        const up = point - width;
        const down = point + width;

        if (x > 0 && !visited[left] && gray[left] <= threshold) {
          visited[left] = 1;
          queue[tail++] = left;
        }
        if (x + 1 < width && !visited[right] && gray[right] <= threshold) {
          visited[right] = 1;
          queue[tail++] = right;
        }
        if (y > 0 && !visited[up] && gray[up] <= threshold) {
          visited[up] = 1;
          queue[tail++] = up;
        }
        if (y + 1 < height && !visited[down] && gray[down] <= threshold) {
          visited[down] = 1;
          queue[tail++] = down;
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      if (boxWidth < minimumSide || boxHeight < minimumSide) continue;

      const ratio = boxWidth / boxHeight;
      if (ratio < 0.55 || ratio > 1.8) continue;

      const fill = area / (boxWidth * boxHeight);
      if (fill < 0.025 || fill > 0.5) continue;

      const squareScore = Math.min(ratio, 1 / ratio);
      const ringScore = Math.max(0.15, 1 - Math.abs(fill - 0.12) * 3.2);
      const score = area * squareScore * ringScore;

      candidates.push({
        area,
        score,
        fill,
        box: { minX, minY, maxX, maxY },
        corners: [
          { x: tl % width, y: Math.floor(tl / width) },
          { x: tr % width, y: Math.floor(tr / width) },
          { x: br % width, y: Math.floor(br / width) },
          { x: bl % width, y: Math.floor(bl / width) }
        ]
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 12);
  }

  // Projective map
  function makeHomography(corners) {
    const [p0, p1, p2, p3] = corners;
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const dy3 = p0.y - p1.y + p2.y - p3.y;
    const denominator = dx1 * dy2 - dx2 * dy1;

    if (Math.abs(denominator) < 0.0001) throw new Error("Invalid code shape");

    const g = (dx3 * dy2 - dx2 * dy3) / denominator;
    const h = (dx1 * dy3 - dx3 * dy1) / denominator;

    return {
      a: p1.x - p0.x + g * p1.x,
      b: p3.x - p0.x + h * p3.x,
      c: p0.x,
      d: p1.y - p0.y + g * p1.y,
      e: p3.y - p0.y + h * p3.y,
      f: p0.y,
      g,
      h
    };
  }

  // Project point
  function projectPoint(map, u, v) {
    const denominator = map.g * u + map.h * v + 1;
    return {
      x: (map.a * u + map.b * v + map.c) / denominator,
      y: (map.d * u + map.e * v + map.f) / denominator
    };
  }

  // Pixel sample
  function sampleGray(gray, width, height, x, y) {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    return gray[py * width + px];
  }

  // Median value
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // Candidate grid
  function sampleCandidate(gray, width, height, candidate) {
    const cornerSets = [
      candidate.corners,
      [
        { x: candidate.box.minX, y: candidate.box.minY },
        { x: candidate.box.maxX, y: candidate.box.minY },
        { x: candidate.box.maxX, y: candidate.box.maxY },
        { x: candidate.box.minX, y: candidate.box.maxY }
      ]
    ];

    let lastError = new Error("Frame damaged");

    for (const corners of cornerSets) {
      try {
        const map = makeHomography(corners);
        const blackSamples = [];
        const whiteSamples = [];

        for (let step = 5; step <= INNER_GRID - 5; step += 4) {
          const along = step / INNER_GRID;
          const blackOffset = 0.75 / INNER_GRID;
          const whiteOffset = (BORDER + SEPARATOR / 2) / INNER_GRID;

          for (const point of [
            projectPoint(map, along, blackOffset),
            projectPoint(map, along, 1 - blackOffset),
            projectPoint(map, blackOffset, along),
            projectPoint(map, 1 - blackOffset, along)
          ]) {
            blackSamples.push(sampleGray(gray, width, height, point.x, point.y));
          }

          for (const point of [
            projectPoint(map, along, whiteOffset),
            projectPoint(map, along, 1 - whiteOffset),
            projectPoint(map, whiteOffset, along),
            projectPoint(map, 1 - whiteOffset, along)
          ]) {
            whiteSamples.push(sampleGray(gray, width, height, point.x, point.y));
          }
        }

        const black = median(blackSamples);
        const white = median(whiteSamples);
        if (white - black < 24) throw new Error("Low contrast");

        const threshold = (black + white) / 2;
        const bits = new Uint8Array(DATA_GRID * DATA_GRID);
        const dataStart = BORDER + SEPARATOR;
        const cellOffset = 0.16 / INNER_GRID;

        for (let y = 0; y < DATA_GRID; y += 1) {
          for (let x = 0; x < DATA_GRID; x += 1) {
            const u = (dataStart + x + 0.5) / INNER_GRID;
            const v = (dataStart + y + 0.5) / INNER_GRID;
            const points = [
              projectPoint(map, u, v),
              projectPoint(map, u - cellOffset, v),
              projectPoint(map, u + cellOffset, v),
              projectPoint(map, u, v - cellOffset),
              projectPoint(map, u, v + cellOffset)
            ];
            let level = 0;

            for (const point of points) {
              level += sampleGray(gray, width, height, point.x, point.y);
            }

            bits[y * DATA_GRID + x] = level / points.length < threshold ? 1 : 0;
          }
        }

        const frame = decodeGrid(bits);
        frame.corners = corners;
        frame.sourceWidth = width;
        frame.sourceHeight = height;
        frame.contrast = white - black;
        frame.finderScore = verifyFinder(bits);
        return frame;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  // Corner hint
  function makeHintCandidate(corners) {
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);

    return {
      corners,
      box: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      }
    };
  }

  // Read camera image
  function sampleFramesFromCanvas(canvas, hintCornerSets = [], maxFrames = 4) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const gray = makeGray(image);
    const frames = [];
    const keys = new Set();
    let lastError = new Error("Code not found");

    const addFrame = frame => {
      const key = `${frame.streamId}:${frame.sequence}`;
      if (keys.has(key)) return;
      keys.add(key);
      frames.push(frame);
    };

    let hints = hintCornerSets;
    if (Array.isArray(hints) && hints.length === 4 && hints.every(point => point && Number.isFinite(point.x))) {
      hints = [hints];
    }

    if (Array.isArray(hints)) {
      for (const corners of hints.slice(0, maxFrames)) {
        if (!Array.isArray(corners) || corners.length !== 4) continue;
        try {
          addFrame(sampleCandidate(gray, canvas.width, canvas.height, makeHintCandidate(corners)));
        } catch (error) {
          lastError = error;
        }
      }
    }

    // Skip the full image search when every locked code decoded.
    if (frames.length >= maxFrames) return frames;

    const threshold = getThreshold(gray);
    const candidates = findBorderCandidates(gray, canvas.width, canvas.height, threshold);

    for (const candidate of candidates) {
      if (frames.length >= maxFrames) break;
      try {
        addFrame(sampleCandidate(gray, canvas.width, canvas.height, candidate));
      } catch (error) {
        lastError = error;
      }
    }

    if (!frames.length) throw lastError;
    return frames;
  }

  // Read one code
  function sampleFrameFromCanvas(canvas, hintCorners = null) {
    return sampleFramesFromCanvas(canvas, hintCorners ? [hintCorners] : [], 1)[0];
  }

  window.JamScanCore = {
    DATA_GRID,
    CODE_GRID,
    MAX_SOURCE_SIZE,
    FRAME_TYPE,
    textEncoder,
    textDecoder,
    formatBytes,
    formatDuration,
    safeName,
    classify,
    kindLabel,
    shortKind,
    frameTypeLabel,
    mimeForName,
    concatArrays,
    crc32,
    buildPackage,
    parsePackage,
    createStream,
    createFountainFrame,
    createCycleFrames,
    renderFrame,
    renderFrameGrid,
    sampleFrameFromCanvas,
    sampleFramesFromCanvas
  };
})();
