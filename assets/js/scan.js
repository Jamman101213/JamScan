(() => {
  "use strict";

  // Scan state
  const state = {
    stream: null,
    cameras: [],
    cameraIndex: 0,
    loopId: null,
    loopMode: null,
    loopGeneration: 0,
    running: false,
    busy: false,
    session: null,
    valid: 0,
    rejected: 0,
    duplicates: 0,
    lastDecodeMs: 0,
    lastLockTime: 0,
    lockCorners: [],
    lockFailures: 0,
    cameraRate: 0,
    complete: false,
    codesLast: 0,
    sequenceHoles: new Set(),
    largeGapCount: 0,
    lastRejectTime: 0
  };

  const core = window.JamScanCore;
  const ui = window.JamScanUI;
  const viewer = window.JamScanViewer;
  const FountainDecoder = window.JamScanFountain.Decoder;

  // Find element
  function element(id) {
    return document.getElementById(id);
  }

  // Missing blocks
  function getMissingCount() {
    if (!state.session) return 0;
    return Math.max(0, state.session.total - state.session.decoder.solvedCount);
  }

  // Sequence gaps
  function getGapCount() {
    return state.sequenceHoles.size + state.largeGapCount;
  }

  // Progress display
  function updateScanUI() {
    const total = state.session ? state.session.total : 0;
    const solved = state.session ? state.session.decoder.solvedCount : 0;
    const collected = state.session ? state.session.decoder.framesNew : 0;
    const estimatedCodes = total ? Math.ceil(total * 1.2) : 0;
    const percent = state.complete
      ? 100
      : estimatedCodes
        ? Math.min(99, Math.round((collected / estimatedCodes) * 100))
        : 0;

    element("scanProgress").style.width = `${percent}%`;
    element("scanPercent").textContent = `${percent}%`;
    element("scanFrameCount").textContent = estimatedCodes
      ? `${collected.toLocaleString()} / about ${estimatedCodes.toLocaleString()} codes`
      : "0 / 0 codes";
    element("validFrames").textContent = state.valid.toLocaleString();
    element("badFrames").textContent = state.rejected.toLocaleString();
    element("missedFlashes").textContent = getGapCount().toLocaleString();
    element("missingFrames").textContent = getMissingCount().toLocaleString();
    element("decodeTime").textContent = state.lastDecodeMs ? `${state.lastDecodeMs.toFixed(1)} ms` : "-";
    element("cycleCount").textContent = String(state.codesLast);
    element("cameraRate").textContent = state.cameraRate ? `${state.cameraRate.toFixed(0)} fps` : "-";

    if (state.complete) {
      element("scanState").textContent = "Complete";
    } else if (!state.session) {
      element("scanState").textContent = "Searching";
    } else {
      element("scanState").textContent = "Receiving";
    }

    if (!state.session) {
      element("scanMessage").textContent = "Point the camera at the complete 64-tile JamScan mosaic.";
    } else if (getMissingCount()) {
      element("scanMessage").textContent = `Receiving stream ${state.session.streamId.toString(16).padStart(8, "0")}. Repair frames can replace missed flashes.`;
    } else {
      element("scanMessage").textContent = "All source blocks recovered. Verifying the package.";
    }
  }

  // New stream
  function createSession(frame) {
    return {
      streamId: frame.streamId,
      total: frame.total,
      packageLength: frame.packageLength,
      packageCRC: frame.packageCRC,
      blockSize: frame.blockSize,
      decoder: new FountainDecoder(
        frame.total,
        frame.blockSize,
        frame.streamId,
        frame.packageLength
      ),
      maxSequence: null
    };
  }

  // Reset stream counters
  function beginSession(frame) {
    state.session = createSession(frame);
    state.valid = 0;
    state.duplicates = 0;
    state.sequenceHoles.clear();
    state.largeGapCount = 0;
    state.complete = false;
    element("scanPreviewHost").innerHTML = "";
    element("scanBadge").textContent = "Stream locked";
  }

  // Track skipped sequence numbers
  function trackSequence(sequence) {
    if (!state.session) return;

    if (state.session.maxSequence === null) {
      state.session.maxSequence = sequence;
      return;
    }

    if (state.sequenceHoles.delete(sequence)) return;
    if (sequence <= state.session.maxSequence) return;

    const gap = sequence - state.session.maxSequence - 1;
    if (gap > 0) {
      const stored = Math.min(gap, 4096);
      for (let value = state.session.maxSequence + 1; value <= state.session.maxSequence + stored; value += 1) {
        state.sequenceHoles.add(value >>> 0);
      }
      if (gap > stored) state.largeGapCount += gap - stored;
    }

    state.session.maxSequence = sequence;
  }

  // Receive code
  async function processFrame(frame, deferUI = false) {
    const newStream = !state.session || state.session.streamId !== frame.streamId;
    if (newStream) beginSession(frame);

    const metadataChanged =
      state.session.total !== frame.total ||
      state.session.packageLength !== frame.packageLength ||
      state.session.packageCRC !== frame.packageCRC ||
      state.session.blockSize !== frame.blockSize;

    if (metadataChanged) {
      state.rejected += 1;
      element("scanBadge").textContent = "Stream metadata changed";
      if (!deferUI) updateScanUI();
      return false;
    }

    trackSequence(frame.sequence);
    const before = state.session.decoder.framesNew;
    state.session.decoder.addFrame(frame.sequence, frame.payload);

    if (state.session.decoder.framesNew === before) {
      state.duplicates += 1;
      element("scanBadge").textContent = `Duplicate code ${frame.sequence}`;
      if (!deferUI) updateScanUI();
      return false;
    }

    state.valid += 1;
    element("scanBadge").textContent = `Code ${frame.sequence} received`;
    if (!deferUI) updateScanUI();

    if (state.session.decoder.isComplete) await finishScan();
    return true;
  }

  // Finish package
  async function finishScan() {
    if (!state.session || state.complete) return;

    state.complete = true;
    element("scanBadge").textContent = "Complete - verifying";
    updateScanUI();

    try {
      const bytes = state.session.decoder.result();
      if (!bytes) throw new Error("Fountain recovery did not finish.");
      if (bytes.length !== state.session.packageLength) throw new Error("Package length check failed.");
      if (core.crc32(bytes) !== state.session.packageCRC) throw new Error("Package CRC check failed.");

      const parsed = await core.parsePackage(bytes);
      stopScanLoop();
      element("scanBadge").textContent = "Complete";
      element("scanMessage").textContent = `Received ${parsed.meta.name}.`;
      updateScanUI();
      viewer.showWarning(parsed, "scanPreviewHost");
    } catch (error) {
      state.complete = false;
      element("scanBadge").textContent = "Package check failed";
      element("scanMessage").textContent = error.message;
      updateScanUI();
    }
  }

  // Camera image
  function drawCameraImage() {
    const video = element("cameraVideo");
    const canvas = element("sampleCanvas");

    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;

    const maximumSide = 1280;
    const scale = Math.min(1, maximumSide / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      state.lockCorners = [];
    }

    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(video, 0, 0, width, height);
    return true;
  }

  // Match preview to the real camera shape
  function updateCameraAspect() {
    const video = element("cameraVideo");
    const shell = video.parentElement;
    if (!video.videoWidth || !video.videoHeight) return;
    shell.style.setProperty("--camera-ratio", `${video.videoWidth} / ${video.videoHeight}`);
  }

  // Code outlines are disabled so nothing covers the camera preview.
  function drawLocks() {
    state.lastLockTime = performance.now();
  }

  // No preview overlay is used.
  function clearOldLocks() {
    return;
  }

  // Count only confirmed damage after a stream has been found.
  function countConfirmedReject() {
    const now = performance.now();
    if (!state.session && !state.lockCorners.length) return;
    if (now - state.lastRejectTime < 750) return;
    state.lastRejectTime = now;
    state.rejected += 1;
  }

  // Scan camera frame
  async function scanTick() {
    if (state.busy || !state.stream || state.complete) return;
    state.busy = true;

    try {
      if (drawCameraImage()) {
        const started = performance.now();
        const frames = core.sampleFramesFromCanvas(element("sampleCanvas"), state.lockCorners, 64);
        state.lastDecodeMs = performance.now() - started;
        state.lockCorners = frames[0]?.mosaicCorners
          ? [frames[0].mosaicCorners]
          : frames.map(frame => frame.corners);
        state.lockFailures = 0;
        state.codesLast = frames.length;
        drawLocks(frames);

        let added = 0;
        for (const frame of frames) {
          if (await processFrame(frame, true)) added += 1;
          if (state.complete) break;
        }

        if (!state.complete) {
          element("scanBadge").textContent = added
            ? `${added} new codes received from this mosaic`
            : "Mosaic locked - waiting for new codes";
          updateScanUI();
        }
      }
    } catch (error) {
      state.lockFailures += 1;
      state.codesLast = 0;
      if (state.lockFailures >= 3) state.lockCorners = [];
      clearOldLocks();

      if (["CRC mismatch", "Header CRC mismatch", "Frame damaged"].includes(error.message)) {
        element("scanBadge").textContent = state.session ? "Waiting for a clean repeat" : "Searching for a clean code";
      } else if (error.message === "Low contrast") {
        element("scanBadge").textContent = "Increase screen brightness";
      } else if (error.message === "Code not found") {
        element("scanBadge").textContent = "Keep all codes in view";
      } else {
        element("scanBadge").textContent = "Looking for JamScan codes";
      }

      updateScanUI();
    } finally {
      state.busy = false;
    }
  }

  // Next camera frame
  function scheduleScan(generation) {
    if (!state.running || generation !== state.loopGeneration) return;

    const video = element("cameraVideo");

    if (typeof video.requestVideoFrameCallback === "function") {
      state.loopMode = "video";
      state.loopId = video.requestVideoFrameCallback(async () => {
        if (generation !== state.loopGeneration) return;
        await scanTick();
        scheduleScan(generation);
      });
    } else {
      state.loopMode = "animation";
      state.loopId = requestAnimationFrame(async () => {
        if (generation !== state.loopGeneration) return;
        await scanTick();
        scheduleScan(generation);
      });
    }
  }

  // Start scan loop
  function startScanLoop() {
    stopScanLoop();
    state.running = true;
    state.loopGeneration += 1;
    scheduleScan(state.loopGeneration);
  }

  // Stop scan loop
  function stopScanLoop() {
    const video = element("cameraVideo");
    state.running = false;
    state.loopGeneration += 1;

    if (state.loopMode === "video" && typeof video.cancelVideoFrameCallback === "function" && state.loopId !== null) {
      video.cancelVideoFrameCallback(state.loopId);
    }

    if (state.loopMode === "animation" && state.loopId !== null) cancelAnimationFrame(state.loopId);
    state.loopId = null;
    state.loopMode = null;
  }

  // Camera list
  async function loadCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter(device => device.kind === "videoinput");
    element("switchCameraButton").disabled = state.cameras.length < 2;
  }

  // Camera request
  async function requestCamera(deviceId) {
    if (deviceId) {
      return navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, min: 24 }
        },
        audio: false
      });
    }

    const base = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    };

    const attempts = [
      { ...base, frameRate: { exact: 60 } },
      { ...base, frameRate: { ideal: 60, min: 24 } },
      base
    ];

    let lastError;
    for (const video of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Camera could not start.");
  }

  // Camera focus
  async function setContinuousFocus(track) {
    try {
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    } catch {
      // Focus setting is optional
    }
  }

  // Start camera
  async function startCamera(deviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera scanning is not supported in this browser.");
    }

    stopCamera();
    state.stream = await requestCamera(deviceId);
    const track = state.stream.getVideoTracks()[0];
    await setContinuousFocus(track);

    const settings = track.getSettings ? track.getSettings() : {};
    state.cameraRate = Number(settings.frameRate) || 0;

    element("cameraVideo").srcObject = state.stream;
    await element("cameraVideo").play();
    updateCameraAspect();

    element("cameraPlaceholder").classList.add("hidden");
    element("cameraButton").textContent = "Stop camera";
    element("scanBadge").textContent = "Find the complete JamScan mosaic";

    await loadCameras();
    updateScanUI();
    startScanLoop();
  }

  // Stop camera
  function stopCamera() {
    stopScanLoop();

    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
    state.cameraRate = 0;

    element("cameraVideo").srcObject = null;
    element("cameraVideo").parentElement.style.removeProperty("--camera-ratio");
    element("cameraPlaceholder").classList.remove("hidden");
    element("cameraButton").textContent = "Start camera";
    element("scanBadge").textContent = "Ready to scan";
    drawLocks([]);
    updateScanUI();
  }

  // Reset scan
  function resetScan() {
    state.session = null;
    state.valid = 0;
    state.rejected = 0;
    state.duplicates = 0;
    state.lastDecodeMs = 0;
    state.lockCorners = [];
    state.lockFailures = 0;
    state.complete = false;
    state.codesLast = 0;
    state.sequenceHoles.clear();
    state.largeGapCount = 0;
    state.lastRejectTime = 0;
    element("scanPreviewHost").innerHTML = "";
    updateScanUI();
    element("scanBadge").textContent = state.stream ? "Find the complete JamScan mosaic" : "Ready to scan";

    if (state.stream && !state.running) startScanLoop();
  }

  // Image frame test
  async function readFrameImage(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = element("sampleCanvas");
    const maximumSide = 1280;
    const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const started = performance.now();
    const frames = core.sampleFramesFromCanvas(canvas, state.lockCorners, 64);
    state.lastDecodeMs = performance.now() - started;
    state.lockCorners = frames[0]?.mosaicCorners
      ? [frames[0].mosaicCorners]
      : frames.map(frame => frame.corners);
    state.lockFailures = 0;
    state.codesLast = frames.length;
    drawLocks(frames);

    let added = 0;
    for (const frame of frames) if (await processFrame(frame, true)) added += 1;
    updateScanUI();
    ui.showToast(`${added} new code${added === 1 ? "" : "s"} read from ${frames.length} visible tiles`);
  }

  // Start page
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
        element("scanBadge").textContent = "Camera unavailable";
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
    window.addEventListener("resize", updateCameraAspect);
    window.addEventListener("orientationchange", updateCameraAspect);
    window.addEventListener("beforeunload", stopCamera);
  }

  document.addEventListener("DOMContentLoaded", startPage);
})();
