import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { LTDecoder, LTEncoder } from "../src/shared/fountain.js";
import { fnv1a, packFrame, parseFrame } from "../src/shared/protocol.js";
import { buildPackage, parsePackage } from "../src/shared/package.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const source = new Uint8Array(180000);
for (let i = 0; i < source.length; i++) source[i] = (i * 31 + 17) & 255;

const blockLen = 1445;
const sessionId = 2201;
const encoder = new LTEncoder(source, blockLen, sessionId);
const decoder = new LTDecoder(encoder.k, blockLen, sessionId, source.length);
const checksum = fnv1a(source);

let sequence = 0;
let accepted = 0;
while (!decoder.isComplete && sequence < encoder.k * 5) {
  const block = encoder.encode(sequence);
  const frame = packFrame({ sessionId, seq: sequence, k: encoder.k, blockLen, totalLen: source.length, payloadFnv: checksum }, block);
  const parsed = parseFrame(frame);
  assert(parsed);
  if (sequence % 10 !== 2 && sequence % 10 !== 7 && sequence % 10 !== 9) {
    decoder.addFrame(parsed.header.seq, parsed.block);
    accepted++;
  }
  sequence++;
}

assert(decoder.isComplete, "fountain decoder did not recover after dropped frames");
assert.deepEqual(decoder.assemble(), source);

const packageBuilt = await buildPackage(new TextEncoder().encode("JamScan protocol test"), "test.txt", "text/plain");
const packageParsed = await parsePackage(packageBuilt.bytes);
assert.equal(packageParsed.hashOk, true);
assert.equal(new TextDecoder().decode(packageParsed.payload), "JamScan protocol test");

console.log(`PASS fountain recovery: ${encoder.k} source blocks, ${accepted} accepted frames, ${sequence - accepted} dropped positions`);
console.log("PASS frame protocol and checksum");
console.log("PASS .jscan package and SHA-256");
