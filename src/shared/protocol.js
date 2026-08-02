// Adapted from Decimen Optical Transfer under the MIT License.

export const HEADER_LEN = 21;
const MAGIC0 = 0x4a;
const MAGIC1 = 0x33;

export function packFrame(header, block) {
  const out = new Uint8Array(HEADER_LEN + block.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, MAGIC0);
  view.setUint8(1, MAGIC1);
  view.setUint16(2, header.sessionId, true);
  view.setUint32(4, header.seq, true);
  view.setUint16(8, header.k, true);
  view.setUint16(10, header.blockLen, true);
  view.setUint32(12, header.totalLen, true);
  view.setUint32(16, header.payloadFnv, true);
  view.setUint8(20, normalizeChannels(header.channels));
  out.set(block, HEADER_LEN);
  return out;
}

export function parseFrame(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length <= HEADER_LEN) return null;
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = {
    sessionId: view.getUint16(2, true),
    seq: view.getUint32(4, true),
    k: view.getUint16(8, true),
    blockLen: view.getUint16(10, true),
    totalLen: view.getUint32(12, true),
    payloadFnv: view.getUint32(16, true),
    channels: normalizeChannels(view.getUint8(20)),
  };
  if (!header.k || !header.blockLen || !header.totalLen) return null;
  if (header.k > 65535 || header.blockLen > 4096 || header.totalLen > 70 * 1024 * 1024) return null;
  if (bytes.length !== HEADER_LEN + header.blockLen) return null;
  return { header, block: bytes.subarray(HEADER_LEN) };
}

function normalizeChannels(value) {
  return value === 2 || value === 4 ? value : 1;
}

export function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function splitmix32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let value = state ^ (state >>> 16);
    value = Math.imul(value, 0x21f0aaad);
    value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97);
    value ^= value >>> 15;
    return value >>> 0;
  };
}
