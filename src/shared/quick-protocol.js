export const CHUNK_SIZE = 32 * 1024;
export const BUFFER_HIGH_WATER = 4 * 1024 * 1024;
export const BUFFER_LOW_WATER = 512 * 1024;
export const MAX_QUICK_FILE_SIZE = 256 * 1024 * 1024;

export function createTransferMeta(packageBytes, metadata) {
  return {
    type: "meta",
    protocol: 1,
    packageSize: packageBytes.length,
    originalSize: metadata.size,
    name: metadata.name,
    contentType: metadata.type,
    kind: metadata.kind,
    sha256: metadata.sha256,
  };
}

export function joinChunks(chunks, expectedLength) {
  const output = new Uint8Array(expectedLength);
  let offset = 0;
  for (const chunk of chunks) {
    const source = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (offset + source.length > expectedLength) throw new Error("Received more bytes than expected.");
    output.set(source, offset);
    offset += source.length;
  }
  if (offset !== expectedLength) throw new Error(`Transfer incomplete: received ${offset} of ${expectedLength} bytes.`);
  return output;
}

export function formatSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "-";
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 1) return "less than a second";
  if (seconds < 60) return `${Math.ceil(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.ceil(seconds % 60)}s`;
}
