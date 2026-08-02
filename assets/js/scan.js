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
    largeGapCount: 0
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
      element("scanMessage").textContent = "Point the camera at one or more JamScan codes.";
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
  async function processFrame(frame) {
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
      updateScanUI();
      return;
    }

    trackSequence(frame.sequence);
    const before = state.session.decoder.framesNew;
    state.session.decoder.addFrame(frame.sequence, frame.payload);

    if (state.session.decoder.framesNew === before) {
      state.duplicates += 1;
      element("scanBadge").textContent = `Duplicate code ${frame.sequence}`;
      updateScanUI();
      return;
    }

    state.valid += 1;
    element("scanBadge").textContent = `Code ${frame.sequence} received`;
    updateScanUI();

    if (state.session.decoder.isComplete) await finishScan();
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
    const context = canvas.getContext("2d", { alpha: false });

    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;

    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
    return true;
  }

  // Code outlines
  function drawLocks(frames) {
    const overlay = element("scanOverlay");
    const shell = overlay.parentElement;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(shell.clientWidth * ratio));
    const height = Math.max(1, Math.round(shell.clientHeight * ratio));

    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }

    const context = overlay.getContext("2d");
    context.clearRect(0, 0, width, height);
    if (!frames || !frames.length) return;

    for (const frame of frames) {
      if (!frame.corners) continue;
      const scaleX = width / frame.sourceWidth;
      const scaleY = height / frame.sourceHeight;
      context.strokeStyle = "#f5b942";
      context.lineWidth = Math.max(3, ratio * 2);
      context.beginPath();

      frame.corners.forEach((point, index) => {
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });

      context.closePath();
      context.stroke();
    }

    state.lastLockTime = performance.now();
  }

  // Clear old outlines
  function clearOldLocks() {
    if (performance.now() - state.lastLockTime < 250) return;
    const overlay = element("scanOverlay");
    overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  }

  // Scan camera frame
  async function scanTick() {
    if (state.busy || !state.stream || state.complete) return;
    state.busy = true;

    try {
      if (drawCameraImage()) {
        const started = performance.now();
        const frames = core.sampleFramesFromCanvas(element("sampleCanvas"), state.lockCorners, 4);
        state.lastDecodeMs = performance.now() - started;
        state.lockCorners = frames.map(frame => frame.corners);
        state.lockFailures = 0;
        state.codesLast = frames.length;
        drawLocks(frames);

        for (const frame of frames) {
          await processFrame(frame);
          if (state.complete) break;
        }
      }
    } catch (error) {
      state.lockFailures += 1;
      state.codesLast = 0;
      if (state.lockFailures >= 3) state.lockCorners = [];
      clearOldLocks();

      if (["CRC mismatch", "Header CRC mismatch", "Frame damaged"].includes(error.message)) {
        state.rejected += 1;
        element("scanBadge").textContent = "Damaged code skipped";
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

    element("cameraPlaceholder").classList.add("hidden");
    element("cameraButton").textContent = "Stop camera";
    element("scanBadge").textContent = "Find the JamScan codes";

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
    element("scanPreviewHost").innerHTML = "";
    updateScanUI();
    element("scanBadge").textContent = state.stream ? "Find the JamScan codes" : "Ready to scan";

    if (state.stream && !state.running) startScanLoop();
  }

  // Image frame test
  async function readFrameImage(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = element("sampleCanvas");
    const context = canvas.getContext("2d", { alpha: false });
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    context.fillStyle = "#eeeeee";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
    bitmap.close();

    const started = performance.now();
    const frames = core.sampleFramesFromCanvas(canvas, state.lockCorners, 4);
    state.lastDecodeMs = performance.now() - started;
    state.lockCorners = frames.map(frame => frame.corners);
    state.lockFailures = 0;
    state.codesLast = frames.length;
    drawLocks(frames);

    for (const frame of frames) await processFrame(frame);
    updateScanUI();
    ui.showToast(`${frames.length} code${frames.length === 1 ? "" : "s"} read`);
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
    window.addEventListener("beforeunload", stopCamera);
  }

  document.addEventListener("DOMContentLoaded", startPage);
})();
