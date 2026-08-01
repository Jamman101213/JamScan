(() => {
  "use strict";

  // Format settings
  const GRID = 64;
  const FINDER = 8;
  const FRAME_HEADER_BYTES = 28;
  const MAX_PAYLOAD = 448;
  const MAX_SOURCE_SIZE = 256 * 1024 * 1024;
  const FRAME_VERSION = 2;
  const MAGIC = new Uint8Array([0x4a, 0x53, 0x43, 0x41, 0x4e, 0x01]);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // Frame types
  const FRAME_TYPE = Object.freeze({
    START: 0,
    DATA: 1,
    END: 2
  });

  // Grid areas
  function isReserved(x, y) {
    return (
      (x < FINDER && y < FINDER) ||
      (x >= GRID - FINDER && y < FINDER) ||
      (x < FINDER && y >= GRID - FINDER) ||
      (x >= GRID - FINDER && y >= GRID - FINDER)
    );
  }

  // Corner marker
  function finderBit(x, y) {
    const localX = x >= GRID - FINDER ? x - (GRID - FINDER) : x;
    const localY = y >= GRID - FINDER ? y - (GRID - FINDER) : y;

    if (localX === 0 || localY === 0 || localX === 7 || localY === 7) return 1;
    if (localX === 1 || localY === 1 || localX === 6 || localY === 6) return 0;
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
    const total = Math.max(1, Math.ceil(packageBytes.length / MAX_PAYLOAD));
    const streamId = crypto.getRandomValues(new Uint32Array(1))[0];
    const chunks = [];

    for (let index = 0; index < total; index += 1) {
      chunks.push(packageBytes.slice(index * MAX_PAYLOAD, (index + 1) * MAX_PAYLOAD));
    }

    return {
      streamId,
      total,
      packageLength: packageBytes.length,
      packageCRC: crc32(packageBytes),
      chunks
    };
  }

  // Create frame
  function createFrame(stream, type, index, cycle, sequence, payload) {
    const header = new Uint8Array(FRAME_HEADER_BYTES);

    header[0] = 0xa5;
    header[1] = 0x5a;
    header[2] = FRAME_VERSION;
    header[3] = type;
    writeU24(header, 4, index);
    writeU24(header, 7, stream.total);
    header[10] = payload.length & 255;
    header[11] = (payload.length >>> 8) & 255;
    writeU32(header, 12, stream.streamId);
    writeU32(header, 16, cycle);
    writeU32(header, 20, sequence);
    writeU32(header, 24, crc32(payload));

    return {
      header,
      payload,
      type,
      index,
      total: stream.total,
      streamId: stream.streamId,
      cycle,
      sequence
    };
  }

  // Create loop frames
  function createCycleFrames(stream, cycle) {
    const frames = [];
    const markerPayload = new Uint8Array(8);
    writeU32(markerPayload, 0, stream.packageLength);
    writeU32(markerPayload, 4, stream.packageCRC);

    const startRepeats = 3 + (cycle % 3);
    const endRepeats = 2 + (cycle % 2);
    let sequence = 0;

    for (let repeat = 0; repeat < startRepeats; repeat += 1) {
      frames.push(createFrame(stream, FRAME_TYPE.START, 0, cycle, sequence, markerPayload));
      sequence += 1;
    }

    const offset = stream.total ? (cycle * 17) % stream.total : 0;

    for (let position = 0; position < stream.total; position += 1) {
      const index = (offset + position) % stream.total;
      frames.push(createFrame(stream, FRAME_TYPE.DATA, index, cycle, sequence, stream.chunks[index]));
      sequence += 1;
    }

    for (let repeat = 0; repeat < endRepeats; repeat += 1) {
      frames.push(createFrame(stream, FRAME_TYPE.END, stream.total, cycle, sequence, markerPayload));
      sequence += 1;
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

  // Draw frame
  function renderFrame(canvas, frame) {
    const context = canvas.getContext("2d", { alpha: false });
    const size = canvas.width;
    const cell = size / GRID;
    const packet = concatArrays([frame.header, frame.payload]);
    const bits = bytesToBits(packet);
    const random = xorshift((frame.streamId ^ frame.index ^ frame.cycle ^ 0x9e3779b9) >>> 0);
    let bitIndex = 0;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const bit = isReserved(x, y)
          ? finderBit(x, y)
          : bitIndex < bits.length
            ? bits[bitIndex++]
            : random() > 0.5
              ? 1
              : 0;

        context.fillStyle = bit ? "#111111" : "#ffffff";
        context.fillRect(
          Math.floor(x * cell),
          Math.floor(y * cell),
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }

    context.strokeStyle = "#111111";
    context.lineWidth = Math.max(2, size / 320);
    context.strokeRect(1, 1, size - 2, size - 2);
  }

  // Marker check
  function verifyFinder(samples) {
    let matches = 0;
    let total = 0;

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (!isReserved(x, y)) continue;
        total += 1;
        if (samples[y * GRID + x] === finderBit(x, y)) matches += 1;
      }
    }

    return matches / total;
  }

  // Pixel light level
  function getLight(data, width, x, y) {
    const index = (y * width + x) * 4;
    return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }

  // Read frame image
  function sampleFrameFromCanvas(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    const cellWidth = width / GRID;
    const cellHeight = height / GRID;
    const offsetX = Math.max(1, Math.floor(cellWidth * 0.14));
    const offsetY = Math.max(1, Math.floor(cellHeight * 0.14));
    const luminance = new Float32Array(GRID * GRID);
    let sampleIndex = 0;

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const centerX = Math.min(width - 1, Math.max(0, Math.floor((x + 0.5) * cellWidth)));
        const centerY = Math.min(height - 1, Math.max(0, Math.floor((y + 0.5) * cellHeight)));
        const left = Math.max(0, centerX - offsetX);
        const right = Math.min(width - 1, centerX + offsetX);
        const top = Math.max(0, centerY - offsetY);
        const bottom = Math.min(height - 1, centerY + offsetY);

        luminance[sampleIndex] = (
          getLight(data, width, centerX, centerY) +
          getLight(data, width, left, centerY) +
          getLight(data, width, right, centerY) +
          getLight(data, width, centerX, top) +
          getLight(data, width, centerX, bottom)
        ) / 5;

        sampleIndex += 1;
      }
    }

    const sorted = Array.from(luminance).sort((a, b) => a - b);
    const dark = sorted[Math.floor(sorted.length * 0.12)];
    const light = sorted[Math.floor(sorted.length * 0.88)];

    if (light - dark < 42) throw new Error("Low contrast");

    const threshold = (dark + light) / 2;
    const bits = Array.from(luminance, value => (value < threshold ? 1 : 0));

    if (verifyFinder(bits) < 0.8) throw new Error("Finder not aligned");

    const dataBits = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (!isReserved(x, y)) dataBits.push(bits[y * GRID + x]);
      }
    }

    const headerBitCount = FRAME_HEADER_BYTES * 8;
    const header = bitsToBytes(dataBits.slice(0, headerBitCount));

    if (header[0] !== 0xa5 || header[1] !== 0x5a || header[2] !== FRAME_VERSION) {
      throw new Error("Not a JamScan frame");
    }

    const type = header[3];
    const index = readU24(header, 4);
    const total = readU24(header, 7);
    const length = header[10] | (header[11] << 8);
    const streamId = readU32(header, 12);
    const cycle = readU32(header, 16);
    const sequence = readU32(header, 20);
    const expectedCRC = readU32(header, 24);

    if (![FRAME_TYPE.START, FRAME_TYPE.DATA, FRAME_TYPE.END].includes(type)) {
      throw new Error("Invalid frame type");
    }

    if (total < 1 || length < 1 || length > MAX_PAYLOAD) {
      throw new Error("Invalid frame header");
    }

    if (type === FRAME_TYPE.DATA && index >= total) {
      throw new Error("Invalid data index");
    }

    const payloadBits = dataBits.slice(headerBitCount, headerBitCount + length * 8);
    if (payloadBits.length < length * 8) throw new Error("Incomplete frame");

    const payload = bitsToBytes(payloadBits);
    if (crc32(payload) !== expectedCRC) throw new Error("CRC mismatch");

    let packageLength = null;
    let packageCRC = null;

    if ((type === FRAME_TYPE.START || type === FRAME_TYPE.END) && payload.length >= 8) {
      packageLength = readU32(payload, 0);
      packageCRC = readU32(payload, 4);
    }

    return {
      type,
      index,
      total,
      length,
      streamId,
      cycle,
      sequence,
      payload,
      packageLength,
      packageCRC
    };
  }

  window.JamScanCore = {
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
    createCycleFrames,
    renderFrame,
    sampleFrameFromCanvas
  };
})();
