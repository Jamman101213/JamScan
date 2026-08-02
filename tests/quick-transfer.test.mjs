import assert from "node:assert/strict";
import { CHUNK_SIZE, createTransferMeta, joinChunks } from "../src/shared/quick-protocol.js";
import { sha256HexFallback } from "../src/shared/sha256.js";

const source = new Uint8Array(CHUNK_SIZE * 3 + 777);
for (let index = 0; index < source.length; index++) source[index] = (index * 29 + 17) & 255;
const chunks = [];
for (let offset = 0; offset < source.length; offset += CHUNK_SIZE) chunks.push(source.slice(offset, offset + CHUNK_SIZE));
const joined = joinChunks(chunks, source.length);
assert.deepEqual(joined, source);

const meta = createTransferMeta(source, {
  size: 6_000_000,
  name: "video.mp4",
  type: "video/mp4",
  kind: "video",
  sha256: "abc",
});
assert.equal(meta.packageSize, source.length);
assert.equal(meta.originalSize, 6_000_000);
assert.equal(meta.name, "video.mp4");
assert.throws(() => joinChunks(chunks.slice(0, -1), source.length), /incomplete/i);
console.log("PASS quick transfer chunk reassembly and metadata");

assert.equal(sha256HexFallback(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
console.log("PASS SHA-256 fallback");
