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
  const MAX_PAYLOAD = 40;

  // Stable 64-tile mosaic settings
  const MOSAIC_SIDE = 8;
  const MOSAIC_COUNT = MOSAIC_SIDE * MOSAIC_SIDE;
  const MOSAIC_TILE = 28;
  const MOSAIC_MARGIN = 14;
  const MOSAIC_MARKER = 11;
  const MOSAIC_GRID = MOSAIC_MARGIN * 2 + MOSAIC_TILE * MOSAIC_SIDE;

  // Experimental dense mosaic settings
  const DENSE_GRID = 640;
  const DENSE_HEADER_SIDE = 16;
  const DENSE_HEADER_DRAW_SIZE = 24;
  const DENSE_HEADER_BYTES = 32;
  const DENSE_MARKER_SIZE = 28;
  const DENSE_VERSION = 5;
  const DENSE_PROFILES = Object.freeze({
    1024: Object.freeze({
      id: 1,
      name: "1024 experimental",
      count: 1024,
      columns: 32,
      rows: 32,
      tileSide: 15,
      blockSize: 24,
      canvasSize: 3072,
      dataX: 80,
      dataY: 80
    }),
    4028: Object.freeze({
      id: 2,
      name: "4028 experimental",
      count: 4028,
      columns: 64,
      rows: 63,
      tileSide: 9,
      blockSize: 8,
      canvasSize: 4096,
      dataX: 32,
      dataY: 36
    })
  });
  const DENSE_PROFILE_BY_ID = Object.freeze({
    1: DENSE_PROFILES[1024],
    2: DENSE_PROFILES[4028]
  });
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

  // Small tile checksum
  function crc16(bytes) {
    let current = 0xffff;

    for (const byte of bytes) {
      current ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        current = current & 0x8000 ? ((current << 1) ^ 0x1021) & 0xffff : (current << 1) & 0xffff;
      }
    }

    return current;
  }

  // Create stream
  function createStream(packageBytes, blockSize = MAX_PAYLOAD) {
    const safeBlockSize = Math.max(1, Math.min(65535, Number(blockSize) || MAX_PAYLOAD));
    const streamId = crypto.getRandomValues(new Uint32Array(1))[0];
    const encoder = new window.JamScanFountain.Encoder(packageBytes, safeBlockSize, streamId);

    return {
      streamId,
      total: encoder.blockCount,
      blockSize: safeBlockSize,
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

  // Mosaic corner marker
  function mosaicMarkerBit(x, y) {
    const edge = x < 2 || y < 2 || x >= MOSAIC_MARKER - 2 || y >= MOSAIC_MARKER - 2;
    const center = x >= 4 && x <= 6 && y >= 4 && y <= 6;
    return edge || center ? 1 : 0;
  }

  // Draw mosaic marker
  function drawMosaicMarker(context, left, top, moduleSize) {
    context.fillStyle = "#ffffff";
    context.fillRect(left, top, MOSAIC_MARKER * moduleSize, MOSAIC_MARKER * moduleSize);

    context.fillStyle = "#111111";
    for (let y = 0; y < MOSAIC_MARKER; y += 1) {
      for (let x = 0; x < MOSAIC_MARKER; x += 1) {
        if (!mosaicMarkerBit(x, y)) continue;
        context.fillRect(left + x * moduleSize, top + y * moduleSize, moduleSize, moduleSize);
      }
    }
  }

  // Draw one mosaic tile
  function drawMosaicTile(context, frame, left, top, moduleSize) {
    const packet = concatArrays([frame.header, frame.payload]);
    const bits = bytesToBits(packet);
    const random = xorshift((frame.streamId ^ frame.sequence ^ 0x6d6f7361) >>> 0);
    let bitIndex = 0;

    for (let y = 0; y < MOSAIC_TILE; y += 1) {
      for (let x = 0; x < MOSAIC_TILE; x += 1) {
        const bit = bitIndex < bits.length ? bits[bitIndex++] : random() > 0.5 ? 1 : 0;
        if (!bit) continue;
        context.fillStyle = "#111111";
        context.fillRect(left + x * moduleSize, top + y * moduleSize, moduleSize, moduleSize);
      }
    }
  }

  // Draw the seamless 64-tile mosaic
  function renderMosaicGrid(canvas, frames) {
    const context = canvas.getContext("2d", { alpha: false });
    const list = frames.filter(Boolean).slice(0, MOSAIC_COUNT);
    const shortSide = Math.min(canvas.width, canvas.height);
    const maximumCodeSide = Math.floor(shortSide * 0.94);
    const moduleSize = Math.max(1, Math.floor(maximumCodeSide / MOSAIC_GRID));
    const codeSide = moduleSize * MOSAIC_GRID;
    const left = Math.floor((canvas.width - codeSide) / 2);
    const top = Math.floor((canvas.height - codeSide) / 2);
    const tileStart = MOSAIC_MARGIN * moduleSize;
    const tileSize = MOSAIC_TILE * moduleSize;

    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < list.length; index += 1) {
      const column = index % MOSAIC_SIDE;
      const row = Math.floor(index / MOSAIC_SIDE);
      drawMosaicTile(
        context,
        list[index],
        left + tileStart + column * tileSize,
        top + tileStart + row * tileSize,
        moduleSize
      );
    }

    drawMosaicMarker(context, left, top, moduleSize);
    drawMosaicMarker(context, left + codeSide - MOSAIC_MARKER * moduleSize, top, moduleSize);
    drawMosaicMarker(context, left + codeSide - MOSAIC_MARKER * moduleSize, top + codeSide - MOSAIC_MARKER * moduleSize, moduleSize);
    drawMosaicMarker(context, left, top + codeSide - MOSAIC_MARKER * moduleSize, moduleSize);
  }

  // Find a transfer profile
  function getTransferProfile(mode) {
    const value = Number(mode);
    if (value === 1024 || value === 4028) return DENSE_PROFILES[value];
    return null;
  }

  // Dense tile positions
  const densePositionCache = new Map();
  function getDensePositions(profile) {
    if (densePositionCache.has(profile.count)) return densePositionCache.get(profile.count);

    const positions = [];
    for (let row = 0; row < profile.rows; row += 1) {
      for (let column = 0; column < profile.columns; column += 1) {
        const isCorner =
          (column === 0 || column === profile.columns - 1) &&
          (row === 0 || row === profile.rows - 1);
        if (profile.count === 4028 && isCorner) continue;
        positions.push({ column, row });
        if (positions.length >= profile.count) break;
      }
      if (positions.length >= profile.count) break;
    }

    densePositionCache.set(profile.count, positions);
    return positions;
  }

  // Dense header position
  function denseHeaderPosition(side) {
    const center = Math.floor((DENSE_GRID - DENSE_HEADER_DRAW_SIZE) / 2);
    const edge = 4;
    if (side === 0) return { x: center, y: edge };
    if (side === 1) return { x: DENSE_GRID - DENSE_HEADER_DRAW_SIZE - edge, y: center };
    if (side === 2) return { x: center, y: DENSE_GRID - DENSE_HEADER_DRAW_SIZE - edge };
    return { x: edge, y: center };
  }

  // Dense stream header
  function createDenseHeader(profile, stream, baseSequence, side) {
    const header = new Uint8Array(DENSE_HEADER_BYTES);
    header[0] = 0xd5;
    header[1] = 0x3a;
    header[2] = DENSE_VERSION;
    header[3] = profile.id;
    header[4] = side & 3;
    header[5] = 0;
    writeU32(header, 6, baseSequence >>> 0);
    writeU32(header, 10, stream.total >>> 0);
    header[14] = stream.blockSize & 255;
    header[15] = (stream.blockSize >>> 8) & 255;
    writeU32(header, 16, stream.packageLength >>> 0);
    writeU32(header, 20, stream.streamId >>> 0);
    writeU32(header, 24, stream.packageCRC >>> 0);
    writeU32(header, 28, crc32(header.slice(0, 28)));
    return header;
  }

  // Draw a matrix without separator lines
  function drawBitMatrix(context, bits, side, left, top, moduleSize, seed) {
    const random = xorshift(seed >>> 0);
    let bitIndex = 0;

    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const bit = bitIndex < bits.length ? bits[bitIndex++] : random() > 0.5 ? 1 : 0;
        if (!bit) continue;
        context.fillStyle = "#111111";
        context.fillRect(left + x * moduleSize, top + y * moduleSize, moduleSize, moduleSize);
      }
    }
  }

  // Draw a matrix inside a larger logical square
  function drawScaledBitMatrix(context, bits, bitSide, drawSide, left, top, moduleSize, seed) {
    const random = xorshift(seed >>> 0);
    const cell = (drawSide * moduleSize) / bitSide;
    let bitIndex = 0;

    for (let y = 0; y < bitSide; y += 1) {
      for (let x = 0; x < bitSide; x += 1) {
        const bit = bitIndex < bits.length ? bits[bitIndex++] : random() > 0.5 ? 1 : 0;
        if (!bit) continue;
        context.fillStyle = "#111111";
        context.fillRect(left + x * cell, top + y * cell, cell + 0.2, cell + 0.2);
      }
    }
  }

  // Draw a dense locator
  function drawDenseMarker(context, left, top, size) {
    const cell = size / MOSAIC_MARKER;
    context.fillStyle = "#ffffff";
    context.fillRect(left, top, size, size);
    context.fillStyle = "#111111";

    for (let y = 0; y < MOSAIC_MARKER; y += 1) {
      for (let x = 0; x < MOSAIC_MARKER; x += 1) {
        if (!mosaicMarkerBit(x, y)) continue;
        context.fillRect(left + x * cell, top + y * cell, cell + 0.35, cell + 0.35);
      }
    }
  }

  // Draw one compact repair tile
  function drawDenseTile(context, profile, stream, sequence, left, top, moduleSize) {
    const payload = stream.encoder.encode(sequence >>> 0);
    const checksum = crc16(payload);
    const packet = new Uint8Array(payload.length + 2);
    packet.set(payload, 0);
    packet[packet.length - 2] = (checksum >>> 8) & 255;
    packet[packet.length - 1] = checksum & 255;
    drawBitMatrix(
      context,
      bytesToBits(packet),
      profile.tileSide,
      left,
      top,
      moduleSize,
      stream.streamId ^ sequence ^ 0x64656e73
    );
  }

  // Draw one experimental dense mosaic
  function renderDenseMosaic(canvas, stream, baseSequence, mode) {
    const profile = getTransferProfile(mode);
    if (!profile) throw new Error("Unknown dense mosaic mode");

    if (canvas.width !== profile.canvasSize || canvas.height !== profile.canvasSize) {
      canvas.width = profile.canvasSize;
      canvas.height = profile.canvasSize;
    }

    const context = canvas.getContext("2d", { alpha: false });
    const maximumCodeSide = Math.floor(Math.min(canvas.width, canvas.height) * 0.98);
    const moduleSize = Math.max(1, Math.floor(maximumCodeSide / DENSE_GRID));
    const codeSide = moduleSize * DENSE_GRID;
    const left = Math.floor((canvas.width - codeSide) / 2);
    const top = Math.floor((canvas.height - codeSide) / 2);

    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const positions = getDensePositions(profile);
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index];
      drawDenseTile(
        context,
        profile,
        stream,
        (baseSequence + index) >>> 0,
        left + (profile.dataX + position.column * profile.tileSide) * moduleSize,
        top + (profile.dataY + position.row * profile.tileSide) * moduleSize,
        moduleSize
      );
    }

    for (let side = 0; side < 4; side += 1) {
      const position = denseHeaderPosition(side);
      const header = createDenseHeader(profile, stream, baseSequence, side);
      drawScaledBitMatrix(
        context,
        bytesToBits(header),
        DENSE_HEADER_SIDE,
        DENSE_HEADER_DRAW_SIZE,
        left + position.x * moduleSize,
        top + position.y * moduleSize,
        moduleSize,
        stream.streamId ^ baseSequence ^ side
      );
    }

    const markerSize = DENSE_MARKER_SIZE * moduleSize;
    drawDenseMarker(context, left, top, markerSize);
    drawDenseMarker(context, left + codeSide - markerSize, top, markerSize);
    drawDenseMarker(context, left + codeSide - markerSize, top + codeSide - markerSize, markerSize);
    drawDenseMarker(context, left, top + codeSide - markerSize, markerSize);
  }

  // Draw the selected transfer mode
  function renderTransfer(canvas, stream, baseSequence, mode) {
    const profile = getTransferProfile(mode);
    if (profile) {
      renderDenseMosaic(canvas, stream, baseSequence, mode);
      return;
    }

    if (canvas.width !== 1080 || canvas.height !== 1080) {
      canvas.width = 1080;
      canvas.height = 1080;
    }

    const count = Number(mode) === 1 ? 1 : MOSAIC_COUNT;
    const frames = [];
    for (let index = 0; index < count; index += 1) {
      frames.push(createFountainFrame(stream, (baseSequence + index) >>> 0));
    }
    renderFrameGrid(canvas, frames);
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
    const list = frames.filter(Boolean);

    if (list.length > 4) {
      renderMosaicGrid(canvas, list);
      return;
    }

    const context = canvas.getContext("2d", { alpha: false });
    const count = Math.max(1, list.length);
    const columns = count === 1 ? 1 : 2;
    const rows = count <= 2 ? 1 : 2;
    const shortSide = Math.min(canvas.width, canvas.height);
    const outerMargin = Math.max(16, Math.round(shortSide * 0.025));
    const gap = Math.max(18, Math.round(shortSide * 0.025));
    const usableWidth = canvas.width - outerMargin * 2 - gap * (columns - 1);
    const usableHeight = canvas.height - outerMargin * 2 - gap * (rows - 1);
    const cellWidth = usableWidth / columns;
    const cellHeight = usableHeight / rows;
    const side = Math.floor(Math.min(cellWidth, cellHeight));

    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < list.length; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellLeft = outerMargin + column * (cellWidth + gap);
      const cellTop = outerMargin + row * (cellHeight + gap);
      const left = Math.round(cellLeft + (cellWidth - side) / 2);
      const top = Math.round(cellTop + (cellHeight - side) / 2);
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

  // Read one complete frame packet
  function parseFramePacket(packet) {
    if (packet.length < FRAME_HEADER_BYTES) throw new Error("Incomplete frame");
    const header = packet.slice(0, FRAME_HEADER_BYTES);

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

    if (total < 1 || total > 10000000) throw new Error("Invalid block count");
    if (blockSize < 1 || blockSize > 1024) throw new Error("Invalid block size");
    if (packageLength < 1 || packageLength > MAX_SOURCE_SIZE + 2 * 1024 * 1024) {
      throw new Error("Invalid package length");
    }

    const payloadEnd = FRAME_HEADER_BYTES + blockSize;
    if (packet.length < payloadEnd) throw new Error("Incomplete frame");
    const payload = packet.slice(FRAME_HEADER_BYTES, payloadEnd);
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

  // Read grid packet
  function parseGridBits(bits) {
    if (verifyFinder(bits) < 0.78) throw new Error("Finder check failed");

    const dataBits = [];
    for (let y = 0; y < DATA_GRID; y += 1) {
      for (let x = 0; x < DATA_GRID; x += 1) {
        if (!isReserved(x, y)) dataBits.push(bits[y * DATA_GRID + x]);
      }
    }

    return parseFramePacket(bitsToBytes(dataBits));
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

  // Rotate any square grid
  function rotateSquareGrid(input, side) {
    const output = new Uint8Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        output[y * side + x] = input[(side - 1 - x) * side + y];
      }
    }
    return output;
  }

  // Mirror any square grid
  function mirrorSquareGrid(input, side) {
    const output = new Uint8Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        output[y * side + x] = input[y * side + (side - 1 - x)];
      }
    }
    return output;
  }

  // Decode one mosaic tile
  function decodeMosaicTile(bits) {
    let current = bits;

    for (let rotation = 0; rotation < 4; rotation += 1) {
      try {
        const frame = parseFramePacket(bitsToBytes(current));
        frame.rotation = rotation * 90;
        frame.mirrored = false;
        return frame;
      } catch {
        current = rotateSquareGrid(current, MOSAIC_TILE);
      }
    }

    current = mirrorSquareGrid(bits, MOSAIC_TILE);
    for (let rotation = 0; rotation < 4; rotation += 1) {
      try {
        const frame = parseFramePacket(bitsToBytes(current));
        frame.rotation = rotation * 90;
        frame.mirrored = true;
        return frame;
      } catch {
        current = rotateSquareGrid(current, MOSAIC_TILE);
      }
    }

    throw new Error("Frame damaged");
  }

  // Marker pattern score
  function mosaicMarkerScore(gray, width, height, box, threshold) {
    let matches = 0;
    let total = 0;
    const boxWidth = box.maxX - box.minX + 1;
    const boxHeight = box.maxY - box.minY + 1;

    for (let y = 0; y < MOSAIC_MARKER; y += 1) {
      for (let x = 0; x < MOSAIC_MARKER; x += 1) {
        const px = box.minX + ((x + 0.5) / MOSAIC_MARKER) * boxWidth;
        const py = box.minY + ((y + 0.5) / MOSAIC_MARKER) * boxHeight;
        const bit = sampleGray(gray, width, height, px, py) <= threshold ? 1 : 0;
        if (bit === mosaicMarkerBit(x, y)) matches += 1;
        total += 1;
      }
    }

    return matches / total;
  }

  // Find the four mosaic corner markers
  function findMosaicMarkerCandidates(gray, width, height, threshold) {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const candidates = [];
    const minimumSide = Math.max(8, Math.floor(Math.min(width, height) * 0.014));
    const maximumSide = Math.max(minimumSide + 1, Math.floor(Math.min(width, height) * 0.15));

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

        const neighbors = [point - 1, point + 1, point - width, point + width];
        for (let index = 0; index < neighbors.length; index += 1) {
          const next = neighbors[index];
          if (next < 0 || next >= gray.length || visited[next]) continue;
          const nx = next % width;
          const ny = Math.floor(next / width);
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
          if (gray[next] > threshold) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      if (boxWidth < minimumSide || boxHeight < minimumSide || boxWidth > maximumSide || boxHeight > maximumSide) continue;
      const ratio = boxWidth / boxHeight;
      if (ratio < 0.68 || ratio > 1.47) continue;
      const fill = area / (boxWidth * boxHeight);
      if (fill < 0.16 || fill > 0.76) continue;

      const box = { minX, minY, maxX, maxY };
      const pattern = mosaicMarkerScore(gray, width, height, box, threshold);
      if (pattern < 0.58) continue;

      candidates.push({
        area,
        pattern,
        score: pattern * pattern * area,
        box,
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        corners: [
          { x: tl % width, y: Math.floor(tl / width) },
          { x: tr % width, y: Math.floor(tr / width) },
          { x: br % width, y: Math.floor(br / width) },
          { x: bl % width, y: Math.floor(bl / width) }
        ]
      });
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates.slice(0, 40);
  }

  // Select one marker rectangle
  function selectMosaicCorners(candidates, width, height) {
    if (candidates.length < 4) throw new Error("Mosaic markers not found");
    let best = null;
    const list = candidates.slice(0, 20);

    for (let a = 0; a < list.length - 3; a += 1) {
      for (let b = a + 1; b < list.length - 2; b += 1) {
        for (let c = b + 1; c < list.length - 1; c += 1) {
          for (let d = c + 1; d < list.length; d += 1) {
            const group = [list[a], list[b], list[c], list[d]];
            const tl = group.reduce((bestItem, item) => item.center.x + item.center.y < bestItem.center.x + bestItem.center.y ? item : bestItem);
            const br = group.reduce((bestItem, item) => item.center.x + item.center.y > bestItem.center.x + bestItem.center.y ? item : bestItem);
            const tr = group.reduce((bestItem, item) => item.center.x - item.center.y > bestItem.center.x - bestItem.center.y ? item : bestItem);
            const bl = group.reduce((bestItem, item) => item.center.x - item.center.y < bestItem.center.x - bestItem.center.y ? item : bestItem);
            if (new Set([tl, tr, br, bl]).size !== 4) continue;

            const top = Math.hypot(tr.center.x - tl.center.x, tr.center.y - tl.center.y);
            const bottom = Math.hypot(br.center.x - bl.center.x, br.center.y - bl.center.y);
            const left = Math.hypot(bl.center.x - tl.center.x, bl.center.y - tl.center.y);
            const right = Math.hypot(br.center.x - tr.center.x, br.center.y - tr.center.y);
            if (Math.min(top, bottom, left, right) < Math.min(width, height) * 0.28) continue;

            const horizontal = (top + bottom) / 2;
            const vertical = (left + right) / 2;
            const aspect = horizontal / vertical;
            if (aspect < 0.55 || aspect > 1.8) continue;

            const sizeValues = group.map(item => Math.sqrt(item.area));
            const sizeRatio = Math.max(...sizeValues) / Math.max(1, Math.min(...sizeValues));
            if (sizeRatio > 2.2) continue;

            const areaScore = horizontal * vertical;
            const patternScore = group.reduce((sum, item) => sum + item.pattern, 0) / 4;
            const score = areaScore * patternScore * patternScore / sizeRatio;
            if (!best || score > best.score) best = { score, tl, tr, br, bl };
          }
        }
      }
    }

    if (!best) throw new Error("Mosaic shape not found");
    return [best.tl.corners[0], best.tr.corners[1], best.br.corners[2], best.bl.corners[3]];
  }

  // Parse one dense header
  function parseDenseHeader(bytes) {
    if (bytes.length < DENSE_HEADER_BYTES) throw new Error("Dense header incomplete");
    if (bytes[0] !== 0xd5 || bytes[1] !== 0x3a || bytes[2] !== DENSE_VERSION) {
      throw new Error("Dense header signature mismatch");
    }

    const profile = DENSE_PROFILE_BY_ID[bytes[3]];
    if (!profile) throw new Error("Unknown dense profile");
    const expectedCRC = readU32(bytes, 28);
    if (crc32(bytes.slice(0, 28)) !== expectedCRC) throw new Error("Dense header CRC mismatch");

    const blockSize = bytes[14] | (bytes[15] << 8);
    if (blockSize !== profile.blockSize) throw new Error("Dense block size mismatch");

    return {
      profile,
      side: bytes[4] & 3,
      baseSequence: readU32(bytes, 6),
      total: readU32(bytes, 10),
      blockSize,
      packageLength: readU32(bytes, 16),
      streamId: readU32(bytes, 20),
      packageCRC: readU32(bytes, 24)
    };
  }

  // Decode a dense header in any rotation
  function decodeDenseHeader(bits) {
    let current = bits;

    for (let rotation = 0; rotation < 4; rotation += 1) {
      try {
        return { header: parseDenseHeader(bitsToBytes(current)), bitRotation: rotation };
      } catch {
        current = rotateSquareGrid(current, DENSE_HEADER_SIDE);
      }
    }

    throw new Error("Dense header damaged");
  }

  // Rotate code coordinates into camera coordinates
  function rotateDenseUV(u, v, rotation) {
    if (rotation === 1) return { u: 1 - v, v: u };
    if (rotation === 2) return { u: 1 - u, v: 1 - v };
    if (rotation === 3) return { u: v, v: 1 - u };
    return { u, v };
  }

  // Sample one square bit matrix
  function sampleDenseMatrix(gray, width, height, map, x, y, side, rotation = 0, logicalSize = side) {
    const levels = new Uint8Array(side * side);
    const step = logicalSize / side;

    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        const codeU = (x + (column + 0.5) * step) / DENSE_GRID;
        const codeV = (y + (row + 0.5) * step) / DENSE_GRID;
        const rotated = rotateDenseUV(codeU, codeV, rotation);
        const point = projectPoint(map, rotated.u, rotated.v);
        levels[row * side + column] = Math.round(sampleGray(gray, width, height, point.x, point.y));
      }
    }

    return levels;
  }

  // Turn sampled levels into bits
  function levelsToBits(levels, threshold) {
    const bits = new Uint8Array(levels.length);
    for (let index = 0; index < levels.length; index += 1) bits[index] = levels[index] <= threshold ? 1 : 0;
    return bits;
  }

  // Find the dense header and orientation
  function readDenseHeader(gray, width, height, map) {
    const globalThreshold = getThreshold(gray);
    let lastError = new Error("Dense header not found");

    for (let imageSide = 0; imageSide < 4; imageSide += 1) {
      const position = denseHeaderPosition(imageSide);
      const levels = sampleDenseMatrix(gray, width, height, map, position.x, position.y, DENSE_HEADER_SIDE, 0, DENSE_HEADER_DRAW_SIZE);
      let minimum = 255;
      let maximum = 0;
      for (const value of levels) {
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
      const localThreshold = Math.round((minimum + maximum) / 2);
      const thresholds = [globalThreshold, localThreshold, globalThreshold - 10, globalThreshold + 10];

      for (const threshold of thresholds) {
        try {
          const decoded = decodeDenseHeader(levelsToBits(levels, threshold));
          const rotation = (imageSide - decoded.header.side + 4) % 4;
          return { ...decoded.header, rotation };
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError;
  }

  // Decode one compact tile
  function sampleDenseTile(gray, width, height, map, header, position, sequence, globalThreshold) {
    const profile = header.profile;
    const x = profile.dataX + position.column * profile.tileSide;
    const y = profile.dataY + position.row * profile.tileSide;
    const levels = sampleDenseMatrix(gray, width, height, map, x, y, profile.tileSide, header.rotation);
    let minimum = 255;
    let maximum = 0;
    for (const value of levels) {
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    if (maximum - minimum < 18) throw new Error("Low contrast");

    const localThreshold = Math.round((minimum + maximum) / 2);
    const thresholds = [globalThreshold, localThreshold, globalThreshold - 9, globalThreshold + 9];
    const needed = profile.blockSize + 2;
    let lastError = new Error("Dense tile damaged");

    for (const threshold of thresholds) {
      const bytes = bitsToBytes(levelsToBits(levels, threshold)).slice(0, needed);
      if (bytes.length < needed) continue;
      const payload = bytes.slice(0, profile.blockSize);
      const expected = (bytes[profile.blockSize] << 8) | bytes[profile.blockSize + 1];
      if (crc16(payload) !== expected) {
        lastError = new Error("Dense tile CRC mismatch");
        continue;
      }

      return {
        header: new Uint8Array(0),
        payload,
        type: FRAME_TYPE.FOUNTAIN,
        index: sequence >>> 0,
        total: header.total,
        streamId: header.streamId,
        cycle: 0,
        sequence: sequence >>> 0,
        packageLength: header.packageLength,
        packageCRC: header.packageCRC,
        blockSize: header.blockSize,
        densityMode: profile.count
      };
    }

    throw lastError;
  }

  // Expand locator corners from pixel centers to the outer code edge
  function expandDenseCorners(corners, pixels = 0.75) {
    const center = corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
    return corners.map(point => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const scale = (distance + pixels) / distance;
      return { x: center.x + dx * scale, y: center.y + dy * scale };
    });
  }

  // Read one dense mosaic
  function sampleDenseMosaic(gray, width, height, corners, maxFrames) {
    const adjustedCorners = expandDenseCorners(corners);
    const map = makeHomography(adjustedCorners);
    const header = readDenseHeader(gray, width, height, map);
    const positions = getDensePositions(header.profile);
    const globalThreshold = getThreshold(gray);
    const frames = [];
    const limit = Math.min(maxFrames, positions.length);

    for (let index = 0; index < limit; index += 1) {
      try {
        const frame = sampleDenseTile(
          gray,
          width,
          height,
          map,
          header,
          positions[index],
          (header.baseSequence + index) >>> 0,
          globalThreshold
        );
        frame.corners = adjustedCorners;
        frame.mosaicCorners = adjustedCorners;
        frames.push(frame);
      } catch {
        // Damaged compact tiles are skipped.
      }
    }

    if (!frames.length) throw new Error("Dense mosaic found but no clean tiles decoded");
    return frames;
  }

  // Find and read an experimental dense mosaic
  function sampleDenseMosaicFromImage(gray, width, height, hintCornerSets, maxFrames) {
    let hints = hintCornerSets;
    if (Array.isArray(hints) && hints.length === 4 && hints.every(point => point && Number.isFinite(point.x))) hints = [hints];

    if (Array.isArray(hints)) {
      for (const corners of hints.slice(0, 2)) {
        if (!Array.isArray(corners) || corners.length !== 4) continue;
        try {
          return sampleDenseMosaic(gray, width, height, corners, maxFrames);
        } catch {
          // Search for fresh markers when the lock moved.
        }
      }
    }

    const threshold = getThreshold(gray);
    const candidates = findMosaicMarkerCandidates(gray, width, height, threshold);
    const corners = selectMosaicCorners(candidates, width, height);
    return sampleDenseMosaic(gray, width, height, corners, maxFrames);
  }

  // Sample one tile from a locked mosaic
  function sampleMosaicTile(gray, width, height, map, column, row) {
    const levels = new Uint8Array(MOSAIC_TILE * MOSAIC_TILE);
    const tileX = MOSAIC_MARGIN + column * MOSAIC_TILE;
    const tileY = MOSAIC_MARGIN + row * MOSAIC_TILE;
    const offset = 0.16 / MOSAIC_GRID;

    for (let y = 0; y < MOSAIC_TILE; y += 1) {
      for (let x = 0; x < MOSAIC_TILE; x += 1) {
        const u = (tileX + x + 0.5) / MOSAIC_GRID;
        const v = (tileY + y + 0.5) / MOSAIC_GRID;
        const points = [
          projectPoint(map, u, v),
          projectPoint(map, u - offset, v),
          projectPoint(map, u + offset, v),
          projectPoint(map, u, v - offset),
          projectPoint(map, u, v + offset)
        ];
        let value = 0;
        for (const point of points) value += sampleGray(gray, width, height, point.x, point.y);
        levels[y * MOSAIC_TILE + x] = Math.round(value / points.length);
      }
    }

    const sorted = [...levels].sort((left, right) => left - right);
    const dark = sorted[Math.floor(sorted.length * 0.12)];
    const light = sorted[Math.floor(sorted.length * 0.88)];
    if (light - dark < 20) throw new Error("Low contrast");

    const baseThreshold = getThreshold(levels);
    const thresholds = [baseThreshold, Math.round((dark + light) / 2), baseThreshold - 7, baseThreshold + 7];
    let lastError = new Error("Frame damaged");

    for (const threshold of thresholds) {
      const bits = new Uint8Array(levels.length);
      for (let index = 0; index < levels.length; index += 1) bits[index] = levels[index] <= threshold ? 1 : 0;
      try {
        return decodeMosaicTile(bits);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  // Read all valid tiles from one mosaic
  function sampleMosaic(gray, width, height, corners, maxFrames = MOSAIC_COUNT) {
    const map = makeHomography(corners);
    const frames = [];
    const keys = new Set();

    for (let row = 0; row < MOSAIC_SIDE; row += 1) {
      for (let column = 0; column < MOSAIC_SIDE; column += 1) {
        if (frames.length >= maxFrames) break;
        try {
          const frame = sampleMosaicTile(gray, width, height, map, column, row);
          const key = `${frame.streamId}:${frame.sequence}`;
          if (keys.has(key)) continue;
          keys.add(key);
          frame.corners = corners;
          frame.mosaicCorners = corners;
          frame.tileColumn = column;
          frame.tileRow = row;
          frames.push(frame);
        } catch {
          // A damaged tile is skipped while other tiles continue.
        }
      }
    }

    if (!frames.length) throw new Error("Mosaic found but no clean tiles decoded");
    return frames;
  }

  // Find and read a 64-tile mosaic
  function sampleMosaicFromImage(gray, width, height, hintCornerSets, maxFrames) {
    let hints = hintCornerSets;
    if (Array.isArray(hints) && hints.length === 4 && hints.every(point => point && Number.isFinite(point.x))) hints = [hints];

    if (Array.isArray(hints)) {
      for (const corners of hints.slice(0, 2)) {
        if (!Array.isArray(corners) || corners.length !== 4) continue;
        try {
          return sampleMosaic(gray, width, height, corners, maxFrames);
        } catch {
          // Search for fresh markers when the saved lock moved.
        }
      }
    }

    const threshold = getThreshold(gray);
    const candidates = findMosaicMarkerCandidates(gray, width, height, threshold);
    const corners = selectMosaicCorners(candidates, width, height);
    return sampleMosaic(gray, width, height, corners, maxFrames);
  }

  // Read camera image
  function sampleFramesFromCanvas(canvas, hintCornerSets = [], maxFrames = 64) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const gray = makeGray(image);

    if (maxFrames > 4) {
      try {
        return sampleDenseMosaicFromImage(gray, canvas.width, canvas.height, hintCornerSets, maxFrames);
      } catch {
        // Try the stable 64-tile format next.
      }

      try {
        return sampleMosaicFromImage(gray, canvas.width, canvas.height, hintCornerSets, Math.min(maxFrames, MOSAIC_COUNT));
      } catch {
        // Legacy single-code search remains available as a fallback.
      }
    }

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
      for (const corners of hints.slice(0, Math.min(maxFrames, 4))) {
        if (!Array.isArray(corners) || corners.length !== 4) continue;
        try {
          addFrame(sampleCandidate(gray, canvas.width, canvas.height, makeHintCandidate(corners)));
        } catch (error) {
          lastError = error;
        }
      }
    }

    if (frames.length >= Math.min(maxFrames, 4)) return frames;

    const threshold = getThreshold(gray);
    const candidates = findBorderCandidates(gray, canvas.width, canvas.height, threshold);

    for (const candidate of candidates) {
      if (frames.length >= Math.min(maxFrames, 4)) break;
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
    MAX_PAYLOAD,
    MOSAIC_COUNT,
    MOSAIC_GRID,
    DENSE_PROFILES,
    DENSE_GRID,
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
    crc16,
    buildPackage,
    parsePackage,
    createStream,
    createFountainFrame,
    createCycleFrames,
    renderFrame,
    renderFrameGrid,
    renderMosaicGrid,
    renderDenseMosaic,
    renderTransfer,
    getTransferProfile,
    sampleFrameFromCanvas,
    sampleFramesFromCanvas
  };
})();
