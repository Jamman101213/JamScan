(() => {
  "use strict";

  // Scan state
  const state = {
    stream: null,
    cameras: [],
    cameraIndex: 0,
    loopId: null,
    loopMode: null,
    running: false,
    busy: false,
    waitingForStart: true,
    session: null,
    valid: 0,
    rejected: 0,
    missedFlashes: 0,
    ignoredBeforeStart: 0,
    duplicates: 0,
    lastDecodeMs: 0,
    complete: false,
    frameCounter: 0,
    lastCrop: null,
    lastCropFailures: 0,
    lastSeenKey: "",
    lockCount: 0
  };

  const core = window.JamScanCore;
  const ui = window.JamScanUI;
  const viewer = window.JamScanViewer;

  // Elements
  function element(id) {
    return document.getElementById(id);
  }

  // Scanner label
  function setBadge(message, tone = "") {
    const badge = element("scanBadge");
    badge.textContent = message;
    badge.dataset.tone = tone;
  }

  // Missing data
  function getMissingIndexes() {
    if (!state.session) return [];

    const missing = [];
    for (let index = 0; index < state.session.total; index += 1) {
      if (!state.session.chunks.has(index)) missing.push(index);
    }
    return missing;
  }

  function getMissingCount() {
    return getMissingIndexes().length;
  }

  // Progress display
  function updateScanUI() {
    const total = state.session ? state.session.total : 0;
    const count = state.session ? state.session.chunks.size : 0;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const missingIndexes = total ? getMissingIndexes() : [];
    const missing = missingIndexes.length;

    element("scanProgress").style.width = `${percent}%`;
    const progressTrack = element("scanProgress").parentElement;
    if (progressTrack) progressTrack.setAttribute("aria-valuenow", String(percent));
    element("scanPercent").textContent = `${percent}%`;
    element("scanFrameCount").textContent = `${count.toLocaleString()} / ${total.toLocaleString()} data frames`;
    element("validFrames").textContent = state.valid.toLocaleString();
    element("badFrames").textContent = state.rejected.toLocaleString();
    element("missedFlashes").textContent = state.missedFlashes.toLocaleString();
    element("missingFrames").textContent = missing.toLocaleString();
    element("duplicateFrames").textContent = state.duplicates.toLocaleString();
    element("decodeTime").textContent = state.lastDecodeMs ? `${state.lastDecodeMs.toFixed(2)} ms` : "-";
    element("cycleCount").textContent = state.session ? state.session.cycles.toLocaleString() : "0";
    element("lockStatus").textContent = state.lastCrop ? "Locked" : "Searching";

    if (state.complete) {
      element("scanState").textContent = "Complete";
    } else if (state.waitingForStart) {
      element("scanState").textContent = "Waiting for start";
    } else {
      element("scanState").textContent = "Receiving";
    }

    if (!state.session) {
      element("scanMessage").textContent = state.ignoredBeforeStart
        ? "JamScan saw data from the middle of a loop and is waiting for the next start marker."
        : "Point the camera at the full square. JamScan will lock automatically.";
    } else if (state.waitingForStart && missing) {
      const sample = missingIndexes.slice(0, 8).map(index => index + 1).join(", ");
      const extra = missing > 8 ? ` and ${missing - 8} more` : "";
      element("scanMessage").textContent = `The loop ended with ${missing.toLocaleString()} data frames missing. Waiting for the next start marker. Missing: ${sample}${extra}.`;
    } else if (missing) {
      element("scanMessage").textContent = `Receiving stream ${state.session.streamId.toString(16).padStart(8, "0")}. ${missing.toLocaleString()} data frames remain.`;
    } else {
      element("scanMessage").textContent = "All data frames were received. Verifying the package.";
    }
  }

  // New session
  function createSession(frame) {
    return {
      streamId: frame.streamId,
      total: frame.total,
      packageLength: frame.packageLength,
      packageCRC: frame.packageCRC,
      chunks: new Map(),
      cycle: frame.cycle,
      lastSequence: frame.sequence,
      cycles: 1
    };
  }

  // Sequence check
  function trackSequence(frame) {
    if (!state.session) return;

    const last = state.session.lastSequence;
    if (Number.isInteger(last) && frame.sequence > last + 1) {
      state.missedFlashes += frame.sequence - last - 1;
    }

    if (!Number.isInteger(last) || frame.sequence > last) {
      state.session.lastSequence = frame.sequence;
    }
  }

  // Start marker
  function processStart(frame) {
    const isNewStream = !state.session || state.session.streamId !== frame.streamId;

    if (isNewStream) {
      state.session = createSession(frame);
      state.valid = 0;
      state.missedFlashes = 0;
      state.duplicates = 0;
    } else {
      const metadataChanged =
        state.session.total !== frame.total ||
        state.session.packageLength !== frame.packageLength ||
        state.session.packageCRC !== frame.packageCRC;

      if (metadataChanged) {
        state.rejected += 1;
        setBadge("Stream metadata changed", "bad");
        return;
      }

      if (state.session.cycle !== frame.cycle) {
        state.session.cycle = frame.cycle;
        state.session.lastSequence = frame.sequence;
        state.session.cycles += 1;
      } else {
        trackSequence(frame);
      }
    }

    state.waitingForStart = false;
    setBadge("Start marker found", "good");
    updateScanUI();
  }

  // Data frame
  async function processData(frame) {
    if (!state.session || state.waitingForStart || state.session.streamId !== frame.streamId) {
      state.ignoredBeforeStart += 1;
      state.waitingForStart = true;
      setBadge("Middle of loop found. Waiting for start", "wait");
      updateScanUI();
      return;
    }

    if (frame.cycle !== state.session.cycle) {
      state.waitingForStart = true;
      state.ignoredBeforeStart += 1;
      setBadge("New loop found. Waiting for start", "wait");
      updateScanUI();
      return;
    }

    trackSequence(frame);

    if (state.session.chunks.has(frame.index)) {
      state.duplicates += 1;
      setBadge(`Repeated data frame ${frame.index + 1}`, "good");
      updateScanUI();
      return;
    }

    state.session.chunks.set(frame.index, frame.payload);
    state.valid += 1;
    setBadge(`Data frame ${frame.index + 1} received`, "good");
    updateScanUI();

    if (state.session.chunks.size === state.session.total) {
      await finishScan();
    }
  }

  // End marker
  async function processEnd(frame) {
    if (!state.session || state.waitingForStart || state.session.streamId !== frame.streamId) return;
    if (frame.cycle !== state.session.cycle) return;

    trackSequence(frame);

    if (state.session.chunks.size === state.session.total) {
      await finishScan();
      return;
    }

    state.waitingForStart = true;
    setBadge(`Loop ended. ${getMissingCount()} data frames missing`, "wait");
    updateScanUI();
  }

  // Receive frame
  async function processFrame(frame) {
    const key = `${frame.streamId}:${frame.cycle}:${frame.sequence}`;
    if (key === state.lastSeenKey) return;
    state.lastSeenKey = key;

    if (frame.type === core.FRAME_TYPE.START) {
      processStart(frame);
      return;
    }

    if (frame.type === core.FRAME_TYPE.DATA) {
      await processData(frame);
      return;
    }

    if (frame.type === core.FRAME_TYPE.END) {
      await processEnd(frame);
    }
  }

  // Finish package
  async function finishScan() {
    if (!state.session || state.complete) return;

    state.complete = true;
    setBadge("Complete. Verifying package", "good");
    updateScanUI();

    const arrays = [];
    for (let index = 0; index < state.session.total; index += 1) {
      const part = state.session.chunks.get(index);
      if (!part) {
        state.complete = false;
        return;
      }
      arrays.push(part);
    }

    try {
      let bytes = core.concatArrays(arrays);

      if (state.session.packageLength && bytes.length >= state.session.packageLength) {
        bytes = bytes.slice(0, state.session.packageLength);
      }

      if (bytes.length !== state.session.packageLength) {
        throw new Error("Package length check failed.");
      }

      if (core.crc32(bytes) !== state.session.packageCRC) {
        throw new Error("Package CRC check failed.");
      }

      const parsed = await core.parsePackage(bytes);
      stopScanLoop();
      setBadge("Complete", "good");
      element("scanMessage").textContent = `Received ${parsed.meta.name}.`;
      updateScanUI();
      viewer.showWarning(parsed, "scanPreviewHost");
    } catch (error) {
      state.complete = false;
      setBadge("Package check failed", "bad");
      element("scanMessage").textContent = error.message;
      updateScanUI();
    }
  }

  // Crop candidates
  function getCropCandidates(video) {
    const candidates = [];
    const keys = new Set();

    function add(scale, offsetX = 0, offsetY = 0) {
      const key = `${scale.toFixed(3)}:${offsetX.toFixed(3)}:${offsetY.toFixed(3)}`;
      if (keys.has(key)) return;
      keys.add(key);
      candidates.push({ scale, offsetX, offsetY });
    }

    if (state.lastCrop) {
      add(state.lastCrop.scale, state.lastCrop.offsetX, state.lastCrop.offsetY);
      add(state.lastCrop.scale * 0.97, state.lastCrop.offsetX, state.lastCrop.offsetY);
      add(state.lastCrop.scale * 1.03, state.lastCrop.offsetX, state.lastCrop.offsetY);
    }

    [0.98, 0.94, 0.9, 0.86, 0.84, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62].forEach(scale => add(scale));

    if (!state.lastCrop || state.lastCropFailures >= 2 || state.frameCounter % 5 === 0) {
      const offsets = [-0.08, 0, 0.08];
      for (const scale of [0.72, 0.8, 0.88]) {
        for (const offsetY of offsets) {
          for (const offsetX of offsets) add(scale, offsetX, offsetY);
        }
      }
    }

    return candidates.filter(candidate => {
      const side = Math.min(video.videoWidth, video.videoHeight) * candidate.scale;
      const sourceX = (video.videoWidth - side) / 2 + candidate.offsetX * Math.min(video.videoWidth, video.videoHeight);
      const sourceY = (video.videoHeight - side) / 2 + candidate.offsetY * Math.min(video.videoWidth, video.videoHeight);
      return sourceX >= 0 && sourceY >= 0 && sourceX + side <= video.videoWidth && sourceY + side <= video.videoHeight;
    });
  }

  // Draw camera crop
  function drawCrop(video, candidate) {
    const canvas = element("sampleCanvas");
    const context = canvas.getContext("2d", { alpha: false });
    const minimum = Math.min(video.videoWidth, video.videoHeight);
    const side = minimum * candidate.scale;
    const sourceX = (video.videoWidth - side) / 2 + candidate.offsetX * minimum;
    const sourceY = (video.videoHeight - side) / 2 + candidate.offsetY * minimum;

    context.imageSmoothingEnabled = true;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, sourceX, sourceY, side, side, 0, 0, canvas.width, canvas.height);
  }

  // Find frame in camera image
  function findCameraFrame() {
    const video = element("cameraVideo");
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new Error("Camera not ready");
    }

    const candidates = getCropCandidates(video);
    let bestError = new Error("Locator not found");

    for (const candidate of candidates) {
      drawCrop(video, candidate);

      try {
        const frame = core.sampleFrameFromCanvas(element("sampleCanvas"));
        state.lastCrop = candidate;
        state.lastCropFailures = 0;
        state.lockCount += 1;
        return frame;
      } catch (error) {
        if (error.message === "CRC mismatch") bestError = error;
        else if (bestError.message !== "CRC mismatch") bestError = error;
      }
    }

    state.lastCropFailures += 1;
    if (state.lastCropFailures >= 4) state.lastCrop = null;
    throw bestError;
  }

  // Scan camera frame
  async function scanTick() {
    if (state.busy || !state.stream || state.complete) return;
    state.busy = true;
    state.frameCounter += 1;

    try {
      const started = performance.now();
      const frame = findCameraFrame();
      state.lastDecodeMs = performance.now() - started;
      await processFrame(frame);
    } catch (error) {
      if (error.message === "CRC mismatch") state.rejected += 1;

      if (error.message === "Locator not found" || error.message === "Finder not aligned") {
        setBadge("Fit the full bordered square inside the guide", "wait");
      } else if (error.message === "Low contrast") {
        setBadge("Increase the other screen brightness", "wait");
      } else if (error.message === "CRC mismatch") {
        setBadge("Damaged camera frame skipped", "bad");
      } else if (error.message !== "Camera not ready") {
        setBadge(state.waitingForStart ? "Looking for start marker" : "Looking for data frames", "wait");
      }

      updateScanUI();
    } finally {
      state.busy = false;
    }
  }

  // Next camera frame
  function scheduleScan() {
    if (!state.running) return;

    const video = element("cameraVideo");

    if (typeof video.requestVideoFrameCallback === "function") {
      state.loopMode = "video";
      state.loopId = video.requestVideoFrameCallback(async () => {
        await scanTick();
        scheduleScan();
      });
    } else {
      state.loopMode = "animation";
      state.loopId = requestAnimationFrame(async () => {
        await scanTick();
        scheduleScan();
      });
    }
  }

  // Scan loop
  function startScanLoop() {
    stopScanLoop();
    state.running = true;
    scheduleScan();
  }

  function stopScanLoop() {
    const video = element("cameraVideo");
    state.running = false;

    if (state.loopMode === "video" && typeof video.cancelVideoFrameCallback === "function" && state.loopId !== null) {
      video.cancelVideoFrameCallback(state.loopId);
    }

    if (state.loopMode === "animation" && state.loopId !== null) {
      cancelAnimationFrame(state.loopId);
    }

    state.loopId = null;
    state.loopMode = null;
  }

  // Camera list
  async function loadCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter(device => device.kind === "videoinput");
    element("switchCameraButton").disabled = state.cameras.length < 2;
  }

  // Camera tuning
  async function tuneCamera(track) {
    if (!track || typeof track.applyConstraints !== "function") return;

    try {
      const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
      const advanced = {};

      if (capabilities.focusMode && capabilities.focusMode.includes("continuous")) advanced.focusMode = "continuous";
      if (capabilities.exposureMode && capabilities.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes("continuous")) advanced.whiteBalanceMode = "continuous";

      if (Object.keys(advanced).length) {
        await track.applyConstraints({ advanced: [advanced] });
      }
    } catch {
      // Camera controls are optional
    }
  }

  // Start camera
  async function startCamera(deviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera scanning is not supported in this browser.");
    }

    if (state.stream) state.stream.getTracks().forEach(track => track.stop());

    const video = deviceId
      ? { deviceId: { exact: deviceId } }
      : {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, min: 24 }
        };

    state.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const track = state.stream.getVideoTracks()[0];
    await tuneCamera(track);

    element("cameraVideo").srcObject = state.stream;
    await element("cameraVideo").play();

    state.lastCrop = null;
    state.lastCropFailures = 0;
    element("cameraPlaceholder").classList.add("hidden");
    element("cameraButton").textContent = "Stop camera";
    setBadge("Looking for the bordered square", "wait");

    await loadCameras();
    startScanLoop();
  }

  // Stop camera
  function stopCamera() {
    stopScanLoop();

    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;

    element("cameraVideo").srcObject = null;
    element("cameraPlaceholder").classList.remove("hidden");
    element("cameraButton").textContent = "Start camera";
    setBadge("Ready to scan");
  }

  // Reset scan
  function resetScan() {
    state.waitingForStart = true;
    state.session = null;
    state.valid = 0;
    state.rejected = 0;
    state.missedFlashes = 0;
    state.ignoredBeforeStart = 0;
    state.duplicates = 0;
    state.lastDecodeMs = 0;
    state.complete = false;
    state.lastSeenKey = "";
    state.lastCrop = null;
    state.lastCropFailures = 0;
    element("scanPreviewHost").innerHTML = "";
    updateScanUI();
    setBadge(state.stream ? "Looking for the bordered square" : "Ready to scan", state.stream ? "wait" : "");

    if (state.stream && !state.running) startScanLoop();
  }

  // Decode image crop
  function findFrameInImage(source) {
    const canvas = element("sampleCanvas");
    const context = canvas.getContext("2d", { alpha: false });
    const width = source.width;
    const height = source.height;
    const minimum = Math.min(width, height);
    const candidates = [1, 0.98, 0.94, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.66];
    let lastError = new Error("Locator not found");

    for (const scale of candidates) {
      const side = minimum * scale;
      const sourceX = (width - side) / 2;
      const sourceY = (height - side) / 2;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, sourceX, sourceY, side, side, 0, 0, canvas.width, canvas.height);

      try {
        return core.sampleFrameFromCanvas(canvas);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  // Image frame test
  async function readFrameImage(file) {
    const bitmap = await createImageBitmap(file);
    const started = performance.now();

    try {
      const frame = findFrameInImage(bitmap);
      state.lastDecodeMs = performance.now() - started;
      await processFrame(frame);
      updateScanUI();
      ui.showToast(`${core.frameTypeLabel(frame.type)} frame read`);
    } finally {
      bitmap.close();
    }
  }

  // Page events
  function startPage() {
    element("cameraButton").addEventListener("click", async () => {
      if (state.stream) {
        stopCamera();
        return;
      }

      try {
        await startCamera();
      } catch (error) {
        ui.showToast(error.message);
        setBadge("Camera unavailable", "bad");
      }
    });

    element("switchCameraButton").addEventListener("click", async () => {
      if (!state.cameras.length) return;

      state.cameraIndex = (state.cameraIndex + 1) % state.cameras.length;

      try {
        await startCamera(state.cameras[state.cameraIndex].deviceId);
      } catch (error) {
        ui.showToast(error.message);
      }
    });

    element("resetScanButton").addEventListener("click", resetScan);
    element("frameImageButton").addEventListener("click", () => element("frameImageInput").click());

    element("frameImageInput").addEventListener("change", async () => {
      const file = element("frameImageInput").files[0];
      if (!file) return;

      try {
        await readFrameImage(file);
      } catch (error) {
        ui.showToast(`Could not decode: ${error.message}`);
      }

      element("frameImageInput").value = "";
    });

    updateScanUI();
    window.addEventListener("beforeunload", stopCamera);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.stream) stopCamera();
    });
  }

  document.addEventListener("DOMContentLoaded", startPage);
})();
