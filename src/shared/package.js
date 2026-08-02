const MAGIC = new TextEncoder().encode("JSCAN2");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function classify(type = "", name = "") {
  const mime = type.toLowerCase();
  const file = name.toLowerCase();
  if (mime === "image/gif" || file.endsWith(".gif")) return "gif";
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || /\.(txt|md|csv|json|xml|log)$/i.test(file)) return "text";
  return "file";
}

export function kindLabel(kind) {
  return ({ photo: "Photo", gif: "Animated GIF", video: "Video", audio: "Audio", text: "Text", file: "File" })[kind] || "File";
}

export function formatBytes(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= 1024; i++) {
    size /= 1024;
    unit = units[i];
  }
  return `${size < 10 ? size.toFixed(2) : size.toFixed(1)} ${unit}`;
}

export function safeName(name) {
  return (name || "shared-file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180);
}

export async function sha256Hex(bytes) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const hash = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gzip(bytes) {
  if (!("CompressionStream" in globalThis)) return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  if (!("DecompressionStream" in globalThis)) throw new Error("This browser cannot decompress the package.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildPackage(payload, name, type) {
  const original = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const compressed = await gzip(original).catch(() => null);
  const useGzip = compressed && compressed.length + 64 < original.length;
  const stored = useGzip ? compressed : original;
  const metadata = {
    app: "JamScan",
    version: 2,
    name: safeName(name),
    type: type || "application/octet-stream",
    kind: classify(type, name),
    size: original.length,
    storedSize: stored.length,
    compression: useGzip ? "gzip" : "none",
    created: new Date().toISOString(),
    sha256: await sha256Hex(original),
  };
  const header = encoder.encode(JSON.stringify(metadata));
  const output = new Uint8Array(MAGIC.length + 4 + header.length + stored.length);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(MAGIC.length, header.length, true);
  output.set(header, MAGIC.length + 4);
  output.set(stored, MAGIC.length + 4 + header.length);
  return { bytes: output, metadata };
}

export async function parsePackage(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < MAGIC.length + 4) throw new Error("The package is too small.");
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("This is not a JamScan 2 package.");
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.length, 4).getUint32(0, true);
  const headerStart = MAGIC.length + 4;
  const payloadStart = headerStart + headerLength;
  if (headerLength < 2 || payloadStart > bytes.length) throw new Error("The package metadata is damaged.");
  let metadata;
  try {
    metadata = JSON.parse(decoder.decode(bytes.subarray(headerStart, payloadStart)));
  } catch {
    throw new Error("The package metadata cannot be read.");
  }
  const stored = bytes.subarray(payloadStart);
  if (metadata.storedSize !== stored.length) throw new Error("The package is incomplete.");
  const payload = metadata.compression === "gzip" ? await gunzip(stored) : stored.slice();
  if (metadata.size !== payload.length) throw new Error("The original size check failed.");
  const digest = await sha256Hex(payload);
  return { metadata, payload, hashOk: digest === metadata.sha256, packageBytes: bytes };
}
