import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
});

const readerOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
};

self.onmessage = async (event) => {
  const { id, generation, buffer, width, height } = event.data;
  const started = performance.now();

  try {
    const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
    const output = [];
    const seen = new Set();

    // Decode the complete camera image first. This is the proven Standard path.
    const fullCode = await decodeOne(image);
    if (fullCode) {
      addCode(output, seen, fullCode);
      const channels = readChannelCount(fullCode);

      // Standard mode is complete after one valid QR.
      if (channels === 1) {
        postResult(id, generation, output, started);
        return;
      }
    }

    // Double and Quad use one normal QR decoder per overlapping crop.
    const regions = makeSearchRegions(width, height);
    for (const region of regions) {
      const cropped = cropImage(image, region);
      const code = await decodeOne(cropped);
      if (code) addCode(output, seen, code);
      if (output.length >= 4) break;
    }

    postResult(id, generation, output, started);
  } catch (error) {
    self.postMessage({
      id,
      generation,
      codes: [],
      elapsed: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function decodeOne(image) {
  const results = await readBarcodes(image, {
    ...readerOptions,
    maxNumberOfSymbols: 1,
  });
  const result = results.find((item) => item.isValid && item.bytes?.length > 0);
  return result ? new Uint8Array(result.bytes) : null;
}

function addCode(output, seen, code) {
  const key = byteKey(code);
  if (seen.has(key)) return;
  seen.add(key);
  output.push(code);
}

function byteKey(bytes) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index++) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length}:${hash >>> 0}`;
}

function readChannelCount(bytes) {
  // JamScan J3 stores the channel count in byte 20.
  if (bytes.length > 21 && bytes[0] === 0x4a && bytes[1] === 0x33) {
    return bytes[20] === 2 || bytes[20] === 4 ? bytes[20] : 1;
  }
  return 1;
}

function postResult(id, generation, codes, started) {
  const buffers = codes.map((code) => code.buffer);
  self.postMessage({
    id,
    generation,
    codes: buffers,
    elapsed: performance.now() - started,
  }, buffers);
}

function makeSearchRegions(width, height) {
  const overlapX = Math.round(width * 0.08);
  const overlapY = Math.round(height * 0.08);
  const halfWidth = Math.round(width / 2);
  const halfHeight = Math.round(height / 2);

  return [
    // Two-code horizontal layout.
    { x: 0, y: 0, width: halfWidth + overlapX, height },
    { x: halfWidth - overlapX, y: 0, width: width - halfWidth + overlapX, height },

    // Two-code vertical layout.
    { x: 0, y: 0, width, height: halfHeight + overlapY },
    { x: 0, y: halfHeight - overlapY, width, height: height - halfHeight + overlapY },

    // Four-code layout.
    { x: 0, y: 0, width: halfWidth + overlapX, height: halfHeight + overlapY },
    { x: halfWidth - overlapX, y: 0, width: width - halfWidth + overlapX, height: halfHeight + overlapY },
    { x: 0, y: halfHeight - overlapY, width: halfWidth + overlapX, height: height - halfHeight + overlapY },
    { x: halfWidth - overlapX, y: halfHeight - overlapY, width: width - halfWidth + overlapX, height: height - halfHeight + overlapY },
  ];
}

function cropImage(image, region) {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(region.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(region.y)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(region.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(region.height)));
  const output = new Uint8ClampedArray(width * height * 4);
  const sourceStride = image.width * 4;
  const targetStride = width * 4;

  for (let row = 0; row < height; row++) {
    const sourceStart = (y + row) * sourceStride + x * 4;
    output.set(image.data.subarray(sourceStart, sourceStart + targetStride), row * targetStride);
  }

  return new ImageData(output, width, height);
}

// Warm the decoder without filtering JamScan data inside the worker.
void readBarcodes(new ImageData(8, 8), {
  formats: ["QRCode"],
  maxNumberOfSymbols: 1,
})
  .catch(() => undefined)
  .then(() => self.postMessage({ id: -1, codes: [], elapsed: 0, ready: true }));
