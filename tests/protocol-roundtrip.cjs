"use strict";

// Browser globals
global.window = global;
require("../assets/js/core.js");

const core = global.JamScanCore;

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
    const value = this.fillStyle === "#111111" ? 17 : 255;
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

// Paste frame
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

// Test frame
function testFrame(frame, angle) {
  const source = new TestCanvas(720, 720);
  core.renderFrame(source, frame);

  const camera = new TestCanvas(480, 360, 216);
  pasteRotated(source, camera, 240, 180, 288, angle);

  const decoded = core.sampleFrameFromCanvas(camera);
  if (decoded.streamId !== frame.streamId) throw new Error(`Stream ID mismatch at ${angle} degrees`);
  if (decoded.sequence !== frame.sequence) throw new Error(`Sequence mismatch at ${angle} degrees`);
  if (decoded.type !== frame.type) throw new Error(`Frame type mismatch at ${angle} degrees`);
}

// Run tests
(async () => {
  const payload = core.textEncoder.encode("JamScan protocol test ".repeat(40));
  const built = await core.buildPackage(payload, "test.txt", "text/plain");
  const stream = core.createStream(built.bytes);
  const frames = core.createCycleFrames(stream, 0, {
    startRepeats: 4,
    endRepeats: 2,
    dataRepeats: 1
  });
  const selected = [frames[0], frames.find(frame => frame.type === core.FRAME_TYPE.DATA)];

  for (const frame of selected) {
    for (const angle of [0, 5, -7, 90]) {
      testFrame(frame, angle);
      console.log(`PASS type=${frame.type} angle=${angle}`);
    }
  }

  const parsed = await core.parsePackage(built.bytes);
  if (!parsed.hashOK) throw new Error("Package hash failed");
  if (core.textDecoder.decode(parsed.payload) !== core.textDecoder.decode(payload)) {
    throw new Error("Package payload mismatch");
  }

  console.log("ALL TESTS PASSED");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
