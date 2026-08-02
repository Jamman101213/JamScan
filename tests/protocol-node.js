"use strict";

// Browser globals
global.window = global;
if (!global.crypto) global.crypto = require("crypto").webcrypto;
require("../assets/js/core.js");

// Pixel canvas
class TestCanvas {
  constructor(width, height, background = 255) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);

    for (let index = 0; index < this.data.length; index += 4) {
      this.data[index] = background;
      this.data[index + 1] = background;
      this.data[index + 2] = background;
      this.data[index + 3] = 255;
    }

    this.context = new TestContext(this);
  }

  getContext() {
    return this.context;
  }
}

// Canvas context
class TestContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#000000";
    this.imageSmoothingEnabled = false;
  }

  getColor() {
    if (this.fillStyle === "#ffffff") return 255;
    if (this.fillStyle === "#111111") return 17;
    return 0;
  }

  fillRect(x, y, width, height) {
    const color = this.getColor();
    const startX = Math.max(0, Math.floor(x));
    const startY = Math.max(0, Math.floor(y));
    const endX = Math.min(this.canvas.width, Math.ceil(x + width));
    const endY = Math.min(this.canvas.height, Math.ceil(y + height));

    for (let pixelY = startY; pixelY < endY; pixelY += 1) {
      for (let pixelX = startX; pixelX < endX; pixelX += 1) {
        const index = (pixelY * this.canvas.width + pixelX) * 4;
        this.canvas.data[index] = color;
        this.canvas.data[index + 1] = color;
        this.canvas.data[index + 2] = color;
        this.canvas.data[index + 3] = 255;
      }
    }
  }

  getImageData() {
    return { data: this.canvas.data };
  }
}

// Image transform
function transformCanvas(source, rotation, mirror) {
  const output = new TestCanvas(source.width, source.height);
  const size = source.width;

  for (let sourceY = 0; sourceY < size; sourceY += 1) {
    for (let sourceX = 0; sourceX < size; sourceX += 1) {
      let x = mirror ? size - 1 - sourceX : sourceX;
      let y = sourceY;
      let destinationX = x;
      let destinationY = y;

      if (rotation === 1) {
        destinationX = size - 1 - y;
        destinationY = x;
      } else if (rotation === 2) {
        destinationX = size - 1 - x;
        destinationY = size - 1 - y;
      } else if (rotation === 3) {
        destinationX = y;
        destinationY = size - 1 - x;
      }

      const sourceIndex = (sourceY * size + sourceX) * 4;
      const destinationIndex = (destinationY * size + destinationX) * 4;
      output.data[destinationIndex] = source.data[sourceIndex];
      output.data[destinationIndex + 1] = source.data[sourceIndex + 1];
      output.data[destinationIndex + 2] = source.data[sourceIndex + 2];
      output.data[destinationIndex + 3] = 255;
    }
  }

  return output;
}

// Scaled camera view
function placeCanvas(source, scale, offsetX = 0, offsetY = 0, background = 140) {
  const output = new TestCanvas(source.width, source.height, background);
  const size = source.width;
  const targetSize = Math.round(size * scale);
  const startX = Math.round((size - targetSize) / 2 + offsetX * size);
  const startY = Math.round((size - targetSize) / 2 + offsetY * size);

  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sourceX = Math.min(size - 1, Math.floor((x / targetSize) * size));
      const sourceY = Math.min(size - 1, Math.floor((y / targetSize) * size));
      const destinationX = startX + x;
      const destinationY = startY + y;

      if (destinationX < 0 || destinationY < 0 || destinationX >= size || destinationY >= size) continue;

      const sourceIndex = (sourceY * size + sourceX) * 4;
      const destinationIndex = (destinationY * size + destinationX) * 4;
      output.data[destinationIndex] = source.data[sourceIndex];
      output.data[destinationIndex + 1] = source.data[sourceIndex + 1];
      output.data[destinationIndex + 2] = source.data[sourceIndex + 2];
      output.data[destinationIndex + 3] = 255;
    }
  }

  return output;
}

// Test helper
function check(name, value) {
  if (!value) throw new Error(`Failed: ${name}`);
  console.log(`PASS ${name}`);
}

// Protocol tests
async function run() {
  const core = global.JamScanCore;
  const payload = core.textEncoder.encode("JamScan protocol test");
  const built = await core.buildPackage(payload, "test.txt", "text/plain");
  const parsed = await core.parsePackage(built.bytes);

  check("package hash", parsed.hashOK);
  check("package payload", core.textDecoder.decode(parsed.payload) === "JamScan protocol test");

  const stream = core.createStream(built.bytes);
  const firstCycle = core.createCycleFrames(stream, 0);
  const dataFrame = firstCycle.find(frame => frame.type === core.FRAME_TYPE.DATA);
  const canvas = new TestCanvas(720, 720);
  core.renderFrame(canvas, dataFrame);

  const decoded = core.sampleFrameFromCanvas(canvas);
  check("exact visual frame", decoded.streamId === dataFrame.streamId && decoded.index === dataFrame.index);

  for (const mirror of [false, true]) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const transformed = transformCanvas(canvas, rotation, mirror);
      const result = core.sampleFrameFromCanvas(transformed);
      check(`orientation ${mirror ? "mirror" : "normal"} ${rotation}`, result.streamId === dataFrame.streamId);
    }
  }

  for (const settings of [
    [0.95, 0, 0, 255],
    [0.85, 0, 0, 140],
    [0.75, 0, 0, 140],
    [0.7, 0.04, -0.03, 140]
  ]) {
    const cameraView = placeCanvas(canvas, ...settings);
    const result = core.sampleFrameFromCanvas(cameraView);
    check(`camera crop ${settings.slice(0, 3).join(" ")}`, result.streamId === dataFrame.streamId);
  }

  const chunks = new Map();
  firstCycle.forEach((frame, index) => {
    if (frame.type === core.FRAME_TYPE.DATA && index % 3 !== 0) chunks.set(frame.index, frame.payload);
  });

  core.createCycleFrames(stream, 1).forEach(frame => {
    if (frame.type === core.FRAME_TYPE.DATA) chunks.set(frame.index, frame.payload);
  });

  check("later loop recovery", chunks.size === stream.total);
  console.log("ALL TESTS PASSED");
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
