"use strict";

// Browser globals
global.window = global;
if (!global.crypto) global.crypto = require("node:crypto").webcrypto;
require("../assets/js/fountain.js");
require("../assets/js/core.js");

const core = global.JamScanCore;
const fountain = global.JamScanFountain;

// Test canvas
class TestCanvas {
  constructor(width, height, background = 255) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.pixels.fill(background);
    this.context = new TestContext(this);
  }

  getContext() {
    return this.context;
  }
}

// Test context
class TestContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#ffffff";
    this.imageSmoothingEnabled = false;
  }

  fillRect(x, y, width, height) {
    const value = this.fillStyle === "#111111" ? 17 : this.fillStyle === "#e9e7e1" ? 233 : 255;
    const startX = Math.max(0, Math.floor(x));
    const startY = Math.max(0, Math.floor(y));
    const endX = Math.min(this.canvas.width, Math.ceil(x + width));
    const endY = Math.min(this.canvas.height, Math.ceil(y + height));

    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        this.canvas.pixels[py * this.canvas.width + px] = value;
      }
    }
  }

  getImageData() {
    const data = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);

    for (let index = 0; index < this.canvas.pixels.length; index += 1) {
      const value = this.canvas.pixels[index];
      const target = index * 4;
      data[target] = value;
      data[target + 1] = value;
      data[target + 2] = value;
      data[target + 3] = 255;
    }

    return { width: this.canvas.width, height: this.canvas.height, data };
  }
}

// Paste image
function pasteRotated(source, target, centerX, centerY, size, angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(-radians);
  const sine = Math.sin(-radians);
  const half = size / 2;
  const radius = Math.ceil(size * 0.75);

  for (let y = Math.max(0, Math.floor(centerY - radius)); y < Math.min(target.height, Math.ceil(centerY + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - radius)); x < Math.min(target.width, Math.ceil(centerX + radius)); x += 1) {
      const localX = x - centerX;
      const localY = y - centerY;
      const sourceX = (localX * cosine - localY * sine + half) * source.width / size;
      const sourceY = (localX * sine + localY * cosine + half) * source.height / size;

      if (sourceX < 0 || sourceY < 0 || sourceX >= source.width || sourceY >= source.height) continue;
      target.pixels[y * target.width + x] = source.pixels[Math.floor(sourceY) * source.width + Math.floor(sourceX)];
    }
  }
}

// Compare bytes
function equalBytes(left, right) {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}


// Fixed test stream
function createTestStream(packageBytes, streamId) {
  const blockSize = core.MAX_PAYLOAD;
  const encoder = new fountain.Encoder(packageBytes, blockSize, streamId);

  return {
    streamId: streamId >>> 0,
    total: encoder.blockCount,
    blockSize,
    packageLength: packageBytes.length,
    packageCRC: core.crc32(packageBytes),
    encoder
  };
}

// Run tests
(async () => {
  const payload = core.textEncoder.encode("JamScan protocol test ".repeat(80));
  const built = await core.buildPackage(payload, "test.txt", "text/plain");
  const stream = createTestStream(built.bytes, 0x5a17c0de);

  for (const angle of [0, 5, -7, 90]) {
    const frame = core.createFountainFrame(stream, 7);
    const source = new TestCanvas(720, 720);
    core.renderFrame(source, frame);
    const camera = new TestCanvas(480, 360, 216);
    pasteRotated(source, camera, 240, 180, 288, angle);
    const decoded = core.sampleFrameFromCanvas(camera);
    if (decoded.streamId !== frame.streamId || decoded.sequence !== frame.sequence) {
      throw new Error(`Single-code mismatch at ${angle} degrees`);
    }
    console.log(`PASS single angle=${angle}`);
  }

  const mosaicFrames = Array.from(
    { length: core.MOSAIC_COUNT },
    (_, sequence) => core.createFountainFrame(stream, sequence)
  );
  const mosaicSource = new TestCanvas(1080, 1080);
  core.renderFrameGrid(mosaicSource, mosaicFrames);

  const edgePoints = [
    0,
    mosaicSource.width - 1,
    (mosaicSource.height - 1) * mosaicSource.width,
    mosaicSource.width * mosaicSource.height - 1
  ];
  if (edgePoints.some(index => mosaicSource.pixels[index] !== 255)) {
    throw new Error("Mosaic display edge is not fully white");
  }
  console.log("PASS mosaic has a clear white outer margin");

  for (const angle of [0, 2, -2]) {
    const mosaicCamera = new TestCanvas(1400, 1000, 225);
    pasteRotated(mosaicSource, mosaicCamera, 700, 500, 900, angle);
    const decodedFrames = core.sampleFramesFromCanvas(mosaicCamera, [], 64);
    const decodedSequences = new Set(decodedFrames.map(frame => frame.sequence));
    const minimum = angle === 0 ? 60 : 40;
    if (decodedSequences.size < minimum) {
      throw new Error(`Only ${decodedSequences.size} mosaic tiles decoded at ${angle} degrees`);
    }
    console.log(`PASS 64-tile mosaic angle=${angle} decoded=${decodedSequences.size}`);
  }

  const lowResolutionCamera = new TestCanvas(640, 480, 225);
  pasteRotated(mosaicSource, lowResolutionCamera, 320, 240, 430, 0);
  const lowResolutionFrames = core.sampleFramesFromCanvas(lowResolutionCamera, [], 64);
  if (lowResolutionFrames.length < 12) {
    throw new Error(`Low-resolution mosaic decoded only ${lowResolutionFrames.length} tiles`);
  }
  console.log(`PASS low-resolution mobile-style capture decoded=${lowResolutionFrames.length}`);

  const largePayload = new Uint8Array(100000);
  for (let index = 0; index < largePayload.length; index += 1) largePayload[index] = (index * 37 + 19) & 255;
  const largeBuilt = await core.buildPackage(largePayload, "large-test.bin", "application/octet-stream");
  const largeStream = createTestStream(largeBuilt.bytes, 0x12345678);
  const decoder = new fountain.Decoder(
    largeStream.total,
    largeStream.blockSize,
    largeStream.streamId,
    largeStream.packageLength
  );

  let sequence = 0;
  let received = 0;
  while (!decoder.isComplete && sequence < largeStream.total * 10 + 1000) {
    const frame = core.createFountainFrame(largeStream, sequence);
    if (((sequence * 1103515245) >>> 0) % 100 >= 35) {
      decoder.addFrame(frame.sequence, frame.payload);
      received += 1;
    }
    sequence += 1;
  }

  const recovered = decoder.result();
  if (!equalBytes(recovered, largeBuilt.bytes)) throw new Error("Fountain recovery failed after dropped frames");
  console.log(`PASS fountain recovery for ${largeStream.total} blocks with 35 percent simulated loss: ${received} received from ${sequence} transmitted codes`);

  const parsed = await core.parsePackage(recovered);
  if (!parsed.hashOK || !equalBytes(parsed.payload, largePayload)) throw new Error("Package verification failed");

  console.log("ALL TESTS PASSED");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
