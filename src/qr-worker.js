import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
});

self.onmessage = async (event) => {
  const { id, generation, buffer, width, height } = event.data;
  const started = performance.now();
  try {
    const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
    const results = await readBarcodes(image, { formats: ["QRCode"], maxNumberOfSymbols: 1 });
    const result = results.find((item) => item.isValid && item.bytes.length > 0);
    const bytes = result ? new Uint8Array(result.bytes) : null;
    self.postMessage({ id, generation, bytes, elapsed: performance.now() - started }, bytes ? [bytes.buffer] : []);
  } catch {
    self.postMessage({ id, generation, bytes: null, elapsed: performance.now() - started });
  }
};

void readBarcodes(new ImageData(8, 8), { formats: ["QRCode"] })
  .catch(() => undefined)
  .then(() => self.postMessage({ id: -1, bytes: null, elapsed: 0 }));
