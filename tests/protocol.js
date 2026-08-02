(() => {
  "use strict";

  // Test runner
  async function run() {
    const core = window.JamScanCore;
    const lines = [];

    function check(name, value) {
      if (!value) throw new Error(`Failed: ${name}`);
      lines.push(`PASS ${name}`);
    }

    const payload = core.textEncoder.encode("JamScan camera test data");
    const built = await core.buildPackage(payload, "test.txt", "text/plain");
    const parsed = await core.parsePackage(built.bytes);
    check("package round trip", core.textDecoder.decode(parsed.payload) === "JamScan camera test data");
    check("package hash", parsed.hashOK === true);

    const stream = core.createStream(built.bytes);
    const frames = core.createCycleFrames(stream, 0);
    const dataFrame = frames.find(frame => frame.type === core.FRAME_TYPE.DATA);
    const source = document.getElementById("source");
    core.renderFrame(source, dataFrame);

    const decoded = core.sampleFrameFromCanvas(source);
    check("exact frame decode", decoded.index === dataFrame.index && decoded.streamId === dataFrame.streamId);
    check("exact payload", core.crc32(decoded.payload) === core.crc32(dataFrame.payload));

    const rotated = document.getElementById("rotated");
    const context = rotated.getContext("2d");
    context.save();
    context.translate(rotated.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(source, 0, 0);
    context.restore();
    const rotatedDecoded = core.sampleFrameFromCanvas(rotated);
    check("rotated frame decode", rotatedDecoded.streamId === dataFrame.streamId);

    context.clearRect(0, 0, rotated.width, rotated.height);
    context.save();
    context.translate(rotated.width, 0);
    context.scale(-1, 1);
    context.drawImage(source, 0, 0);
    context.restore();
    const mirroredDecoded = core.sampleFrameFromCanvas(rotated);
    check("mirrored frame decode", mirroredDecoded.streamId === dataFrame.streamId);

    const firstCycle = core.createCycleFrames(stream, 0);
    const secondCycle = core.createCycleFrames(stream, 1);
    const chunks = new Map();

    firstCycle.forEach((frame, index) => {
      if (frame.type === core.FRAME_TYPE.DATA && index % 3 !== 0) chunks.set(frame.index, frame.payload);
    });
    secondCycle.forEach(frame => {
      if (frame.type === core.FRAME_TYPE.DATA) chunks.set(frame.index, frame.payload);
    });
    check("later loop recovery", chunks.size === stream.total);

    document.getElementById("results").textContent = lines.join("\n") + "\nALL TESTS PASSED";
    document.body.dataset.result = "passed";
  }

  document.addEventListener("DOMContentLoaded", () => {
    run().catch(error => {
      document.getElementById("results").textContent = error.stack || error.message;
      document.body.dataset.result = "failed";
    });
  });
})();
