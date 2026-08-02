import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { LTDecoder, LTEncoder } from "../src/shared/fountain.js";
import { fnv1a, packFrame, parseFrame } from "../src/shared/protocol.js";
import { buildPackage, parsePackage } from "../src/shared/package.js";
import { chooseTransferPlan } from "../src/shared/transfer-plan.js";

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

const directSource = new Uint8Array(4096);
for (let i = 0; i < directSource.length; i++) directSource[i] = (i * 13 + 9) & 255;
const directEncoder = new LTEncoder(directSource, 512, 77);
const directDecoder = new LTDecoder(directEncoder.k, 512, 77, directSource.length);
for (let seq = 0; seq < directEncoder.k; seq++) directDecoder.addFrame(seq, directEncoder.encode(seq));
assert(directDecoder.isComplete, "systematic source frames did not complete in k frames");
assert.deepEqual(directDecoder.assemble(), directSource);

const packageBuilt = await buildPackage(new TextEncoder().encode("JamScan protocol test"), "test.txt", "text/plain");
const packageParsed = await parsePackage(packageBuilt.bytes);
assert.equal(packageParsed.hashOk, true);
assert.equal(new TextDecoder().decode(packageParsed.payload), "JamScan protocol test");

const tinyBuilt = await buildPackage(new TextEncoder().encode("hi"), "message.txt", "text/plain");
const tinyPlan = chooseTransferPlan(tinyBuilt.bytes.length, "reliable");
assert.equal(tinyPlan.staticQr, true);
assert.equal(tinyPlan.blockLen, tinyBuilt.bytes.length);
const tinyEncoder = new LTEncoder(tinyBuilt.bytes, tinyPlan.blockLen, 123);
assert.equal(tinyEncoder.k, 1);
const tinyBlock = tinyEncoder.encode(0);
const tinyFrame = packFrame({
  sessionId: 123,
  seq: 0,
  k: 1,
  blockLen: tinyPlan.blockLen,
  totalLen: tinyBuilt.bytes.length,
  payloadFnv: fnv1a(tinyBuilt.bytes),
}, tinyBlock);
assert(tinyFrame.length < 750, `tiny text frame is still too large: ${tinyFrame.length} bytes`);
const tinyDecoder = new LTDecoder(1, tinyPlan.blockLen, 123, tinyBuilt.bytes.length);
tinyDecoder.addFrame(0, tinyBlock);
assert(tinyDecoder.isComplete);
assert.deepEqual(tinyDecoder.assemble(), tinyBuilt.bytes);

console.log(`PASS fountain recovery: ${encoder.k} source blocks, ${accepted} accepted frames, ${sequence - accepted} dropped positions`);
console.log(`PASS systematic transfer: ${directEncoder.k} source blocks completed in ${directEncoder.k} frames`);
console.log(`PASS tiny text static QR: package=${tinyBuilt.bytes.length} bytes, frame=${tinyFrame.length} bytes`);
console.log("PASS frame protocol and checksum");
console.log("PASS .jscan package and SHA-256");
