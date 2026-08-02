import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { parseFrame } from "./shared/protocol.js";

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
  tryDownscale: true,
};

self.onmessage = async (event) => {
  const { id, generation, buffer, width, height } = event.data;
  const started = performance.now();
  try {
    const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
    const codes = [];
    const seen = new Set();
    let expected = 1;

    await decodeImage(image, 4, codes, seen, (channels) => { expected = Math.max(expected, channels); });

    if (codes.length < expected || (codes.length === 0 && id % 3 === 0)) {
      const regions = makeSearchRegions(width, height);
      for (const region of regions) {
        const cropped = cropImage(image, region);
        await decodeImage(cropped, 1, codes, seen, (channels) => { expected = Math.max(expected, channels); });
        if (codes.length >= expected && codes.length > 0) break;
      }
    }

    const buffers = codes.slice(0, 4).map((code) => code.buffer);
    self.postMessage({ id, generation, codes: buffers, elapsed: performance.now() - started }, buffers);
  } catch {
    self.postMessage({ id, generation, codes: [], elapsed: performance.now() - started });
  }
};

async function decodeImage(image, maxNumberOfSymbols, output, seen, onChannels) {
  const results = await readBarcodes(image, { ...readerOptions, maxNumberOfSymbols });
  for (const item of results) {
    if (!item.isValid || !item.bytes.length) continue;
    const code = new Uint8Array(item.bytes);
    const parsed = parseFrame(code);
    if (!parsed) continue;
    const key = `${parsed.header.sessionId}:${parsed.header.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    onChannels(parsed.header.channels);
    output.push(code);
    if (output.length >= 4) break;
  }
}

function makeSearchRegions(width, height) {
  const wide = Math.round(width * 0.62);
  const tall = Math.round(height * 0.62);
  const right = width - wide;
  const bottom = height - tall;
  return [
    { x: 0, y: 0, width: wide, height: tall },
    { x: right, y: 0, width: wide, height: tall },
    { x: 0, y: bottom, width: wide, height: tall },
    { x: right, y: bottom, width: wide, height: tall },
    { x: 0, y: 0, width: wide, height },
    { x: right, y: 0, width: wide, height },
    { x: 0, y: 0, width, height: tall },
    { x: 0, y: bottom, width, height: tall },
  ];
}

function cropImage(image, region) {
  const x = Math.max(0, Math.min(image.width - 1, region.x));
  const y = Math.max(0, Math.min(image.height - 1, region.y));
  const width = Math.max(1, Math.min(image.width - x, region.width));
  const height = Math.max(1, Math.min(image.height - y, region.height));
  const output = new Uint8ClampedArray(width * height * 4);
  const sourceStride = image.width * 4;
  const targetStride = width * 4;
  for (let row = 0; row < height; row++) {
    const sourceStart = (y + row) * sourceStride + x * 4;
    output.set(image.data.subarray(sourceStart, sourceStart + targetStride), row * targetStride);
  }
  return new ImageData(output, width, height);
}

void readBarcodes(new ImageData(8, 8), { formats: ["QRCode"], maxNumberOfSymbols: 4 })
  .catch(() => undefined)
  .then(() => self.postMessage({ id: -1, codes: [], elapsed: 0 }));
