(() => {
  "use strict";

  // Format settings
  const GRID = 48;
  const FINDER = 8;
  const DISPLAY_GRID = 60;
  const DATA_OFFSET = 6;
  const FRAME_HEADER_BYTES = 28;
  const MAX_PAYLOAD = 224;
  const MAX_SOURCE_SIZE = 256 * 1024 * 1024;
  const FRAME_VERSION = 3;
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
    if (localX === 2 || localY === 2 || localX === 5 || localY === 5) return 1;
    return 0;
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

    const startRepeats = 3;
    const dataRepeats = 2;
    const endRepeats = 2;
    let sequence = 0;

    for (let repeat = 0; repeat < startRepeats; repeat += 1) {
      frames.push(createFrame(stream, FRAME_TYPE.START, 0, cycle, sequence, markerPayload));
      sequence += 1;
    }

    const offset = stream.total ? (cycle * 11) % stream.total : 0;

    for (let position = 0; position < stream.total; position += 1) {
      const index = (offset + position) % stream.total;
      for (let repeat = 0; repeat < dataRepeats; repeat += 1) {
        frames.push(createFrame(stream, FRAME_TYPE.DATA, index, cycle, sequence, stream.chunks[index]));
        sequence += 1;
      }
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
    const cell = size / DISPLAY_GRID;
    const packet = concatArrays([frame.header, frame.payload]);
    const bits = bytesToBits(packet);
    const random = xorshift((frame.streamId ^ frame.index ^ frame.cycle ^ 0x9e3779b9) >>> 0);
    let bitIndex = 0;

    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);

    // Locator border
    context.fillStyle = "#111111";
    context.fillRect(2 * cell, 2 * cell, (DISPLAY_GRID - 4) * cell, 2 * cell);
    context.fillRect(2 * cell, (DISPLAY_GRID - 4) * cell, (DISPLAY_GRID - 4) * cell, 2 * cell);
    context.fillRect(2 * cell, 2 * cell, 2 * cell, (DISPLAY_GRID - 4) * cell);
    context.fillRect((DISPLAY_GRID - 4) * cell, 2 * cell, 2 * cell, (DISPLAY_GRID - 4) * cell);

    // Data grid
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
          Math.floor((x + DATA_OFFSET) * cell),
          Math.floor((y + DATA_OFFSET) * cell),
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }
  }

  // Pixel light level
  function getLight(data, width, x, y) {
    const index = (y * width + x) * 4;
    return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }

  // Matrix transform
  function transformPoint(x, y, rotation, mirror) {
    let tx = mirror ? GRID - 1 - x : x;
    let ty = y;

    if (rotation === 1) return [GRID - 1 - ty, tx];
    if (rotation === 2) return [GRID - 1 - tx, GRID - 1 - ty];
    if (rotation === 3) return [ty, GRID - 1 - tx];
    return [tx, ty];
  }

  // Marker check
  function verifyFinder(matrix, rotation, mirror) {
    let matches = 0;
    let total = 0;

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (!isReserved(x, y)) continue;
        const [sourceX, sourceY] = transformPoint(x, y, rotation, mirror);
        total += 1;
        if (matrix[sourceY * GRID + sourceX] === finderBit(x, y)) matches += 1;
      }
    }

    return matches / total;
  }

  // Decode transformed grid
  function decodeGrid(matrix, rotation, mirror) {
    if (verifyFinder(matrix, rotation, mirror) < 0.86) {
      throw new Error("Finder not aligned");
    }

    const dataBits = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (isReserved(x, y)) continue;
        const [sourceX, sourceY] = transformPoint(x, y, rotation, mirror);
        dataBits.push(matrix[sourceY * GRID + sourceX]);
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
      packageCRC,
      rotation,
      mirrored: mirror
    };
  }

  // Percentile value
  function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * fraction)))];
  }

  // Find locator border
  function locateDisplay(data, width, height) {
    const sampleStep = Math.max(2, Math.floor(Math.min(width, height) / 180));
    const lightSamples = [];

    for (let y = Math.floor(sampleStep / 2); y < height; y += sampleStep) {
      for (let x = Math.floor(sampleStep / 2); x < width; x += sampleStep) {
        lightSamples.push(getLight(data, width, x, y));
      }
    }

    const darkLevel = percentile(lightSamples, 0.12);
    const lightLevel = percentile(lightSamples, 0.88);
    if (lightLevel - darkLevel < 32) throw new Error("Low contrast");
    const threshold = (darkLevel + lightLevel) / 2;

    function lineScores(length, otherLength, vertical) {
      const scores = new Float32Array(length);

      for (let line = 0; line < length; line += 1) {
        let darkCount = 0;
        let count = 0;

        for (let other = 0; other < otherLength; other += sampleStep) {
          const x = vertical ? line : other;
          const y = vertical ? other : line;
          if (getLight(data, width, x, y) < threshold) darkCount += 1;
          count += 1;
        }

        scores[line] = count ? darkCount / count : 0;
      }

      return scores;
    }

    function findBands(scores) {
      const bands = [];
      const minimumLength = Math.max(2, Math.floor(scores.length / 260));
      const maximumLength = Math.max(minimumLength + 1, Math.floor(scores.length * 0.13));
      let start = -1;

      for (let index = 0; index <= scores.length; index += 1) {
        const active = index < scores.length && scores[index] >= 0.55;

        if (active && start < 0) start = index;
        if ((!active || index === scores.length) && start >= 0) {
          const end = index - 1;
          const length = end - start + 1;

          if (length >= minimumLength && length <= maximumLength) {
            let total = 0;
            for (let value = start; value <= end; value += 1) total += scores[value];
            bands.push({
              start,
              end,
              center: (start + end) / 2,
              score: total / length
            });
          }

          start = -1;
        }
      }

      return bands;
    }

    function chooseBand(bands, length, nearStart) {
      const candidates = bands.filter(band => {
        const ratio = band.center / length;
        return nearStart ? ratio > 0.015 && ratio < 0.46 : ratio > 0.54 && ratio < 0.985;
      });

      if (!candidates.length) return null;

      candidates.sort((a, b) => {
        const scoreDifference = b.score - a.score;
        if (Math.abs(scoreDifference) > 0.035) return scoreDifference;
        return nearStart ? a.center - b.center : b.center - a.center;
      });

      return candidates[0];
    }

    const columnBands = findBands(lineScores(width, height, true));
    const rowBands = findBands(lineScores(height, width, false));
    const left = chooseBand(columnBands, width, true);
    const right = chooseBand(columnBands, width, false);
    const top = chooseBand(rowBands, height, true);
    const bottom = chooseBand(rowBands, height, false);

    if (!left || !right || !top || !bottom) throw new Error("Locator not found");

    const moduleWidth = (right.end + 1 - left.start) / (DISPLAY_GRID - 4);
    const moduleHeight = (bottom.end + 1 - top.start) / (DISPLAY_GRID - 4);
    const startX = left.start - 2 * moduleWidth;
    const startY = top.start - 2 * moduleHeight;
    const ratio = moduleWidth / moduleHeight;

    if (
      moduleWidth < 2 ||
      moduleHeight < 2 ||
      ratio < 0.72 ||
      ratio > 1.38 ||
      startX < -width * 0.12 ||
      startY < -height * 0.12 ||
      startX + DISPLAY_GRID * moduleWidth > width * 1.12 ||
      startY + DISPLAY_GRID * moduleHeight > height * 1.12
    ) {
      throw new Error("Locator not found");
    }

    return { startX, startY, moduleWidth, moduleHeight };
  }

  // Read frame image
  function sampleFrameFromCanvas(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    let geometry;

    try {
      geometry = locateDisplay(data, width, height);
    } catch (error) {
      if (error.message === "Low contrast") throw error;
      geometry = {
        startX: 0,
        startY: 0,
        moduleWidth: width / DISPLAY_GRID,
        moduleHeight: height / DISPLAY_GRID
      };
    }

    const luminance = new Float32Array(GRID * GRID);
    const locatorDark = [];
    const locatorLight = [];
    let sampleIndex = 0;

    function sampleModule(moduleX, moduleY) {
      const centerX = Math.min(width - 1, Math.max(0, Math.floor(geometry.startX + (moduleX + 0.5) * geometry.moduleWidth)));
      const centerY = Math.min(height - 1, Math.max(0, Math.floor(geometry.startY + (moduleY + 0.5) * geometry.moduleHeight)));
      const dx = Math.max(1, Math.floor(geometry.moduleWidth * 0.15));
      const dy = Math.max(1, Math.floor(geometry.moduleHeight * 0.15));

      return (
        getLight(data, width, centerX, centerY) +
        getLight(data, width, Math.max(0, centerX - dx), centerY) +
        getLight(data, width, Math.min(width - 1, centerX + dx), centerY) +
        getLight(data, width, centerX, Math.max(0, centerY - dy)) +
        getLight(data, width, centerX, Math.min(height - 1, centerY + dy))
      ) / 5;
    }

    // Locator samples
    for (let module = 6; module < DISPLAY_GRID - 6; module += 6) {
      for (const border of [2, 3, DISPLAY_GRID - 4, DISPLAY_GRID - 3]) {
        locatorDark.push(sampleModule(module, border));
        locatorDark.push(sampleModule(border, module));
      }

      for (const separator of [4, 5, DISPLAY_GRID - 6, DISPLAY_GRID - 5]) {
        locatorLight.push(sampleModule(module, separator));
        locatorLight.push(sampleModule(separator, module));
      }
    }

    const darkAverage = locatorDark.reduce((sum, value) => sum + value, 0) / locatorDark.length;
    const lightAverage = locatorLight.reduce((sum, value) => sum + value, 0) / locatorLight.length;

    if (lightAverage - darkAverage < 30) {
      throw new Error("Locator not found");
    }

    // Data samples
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        luminance[sampleIndex] = sampleModule(x + DATA_OFFSET, y + DATA_OFFSET);
        sampleIndex += 1;
      }
    }

    const dark = percentile(luminance, 0.12);
    const light = percentile(luminance, 0.88);

    if (light - dark < 34) throw new Error("Low contrast");

    const threshold = (dark + light) / 2;
    const matrix = Array.from(luminance, value => (value < threshold ? 1 : 0));
    let lastError = new Error("Not a JamScan frame");

    for (const mirror of [false, true]) {
      for (let rotation = 0; rotation < 4; rotation += 1) {
        try {
          return decodeGrid(matrix, rotation, mirror);
        } catch (error) {
          if (error.message === "CRC mismatch") lastError = error;
          else if (lastError.message !== "CRC mismatch") lastError = error;
        }
      }
    }

    throw lastError;
  }

  window.JamScanCore = {
    GRID,
    DISPLAY_GRID,
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
