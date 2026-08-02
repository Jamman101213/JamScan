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
    waitingForStart: true,
    session: null,
    valid: 0,
    rejected: 0,
    missedFlashes: 0,
    ignoredBeforeStart: 0,
    duplicates: 0,
    lastDecodeMs: 0,
    lastFrameKey: "",
    lastLockTime: 0,
    lockCorners: null,
    lockFailures: 0,
    cameraRate: 0,
    complete: false
  };

  const core = window.JamScanCore;
  const ui = window.JamScanUI;
  const viewer = window.JamScanViewer;

  // Elements
  function element(id) {
    return document.getElementById(id);
  }

  // Missing data
  function getMissingCount() {
    if (!state.session) return 0;
    return Math.max(0, state.session.total - state.session.chunks.size);
  }

  // Progress display
  function updateScanUI() {
    const total = state.session ? state.session.total : 0;
    const count = state.session ? state.session.chunks.size : 0;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const missing = total ? getMissingCount() : 0;

    element("scanProgress").style.width = `${percent}%`;
    element("scanPercent").textContent = `${percent}%`;
    element("scanFrameCount").textContent = `${count.toLocaleString()} / ${total.toLocaleString()} data frames`;
    element("validFrames").textContent = state.valid.toLocaleString();
    element("badFrames").textContent = state.rejected.toLocaleString();
    element("missedFlashes").textContent = state.missedFlashes.toLocaleString();
    element("missingFrames").textContent = missing.toLocaleString();
    element("decodeTime").textContent = state.lastDecodeMs ? `${state.lastDecodeMs.toFixed(2)} ms` : "-";
    element("cycleCount").textContent = state.session ? state.session.cycles.toLocaleString() : "0";
    element("cameraRate").textContent = state.cameraRate ? `${Math.round(state.cameraRate)} fps` : "-";

    if (state.complete) {
      element("scanState").textContent = "Complete";
    } else if (state.waitingForStart) {
      element("scanState").textContent = "Waiting for start";
    } else {
      element("scanState").textContent = "Receiving";
    }

    if (!state.session) {
      element("scanMessage").textContent = state.ignoredBeforeStart
        ? "A stream was found. JamScan is waiting for the next start marker."
        : "No stream started yet.";
    } else if (state.waitingForStart && missing) {
      element("scanMessage").textContent = `Cycle ended with ${missing.toLocaleString()} data frames still missing. Waiting for the next start marker.`;
    } else if (missing) {
      element("scanMessage").textContent = `Receiving stream ${state.session.streamId.toString(16).padStart(8, "0")}. ${missing.toLocaleString()} data frames remain.`;
    } else {
      element("scanMessage").textContent = "All data frames received. Verifying the package.";
    }
  }

  // New session
  function createSession(frame) {
    return {
      streamId: frame.streamId,
      total: frame.total,
      packageLength: frame.packageLength,
      packageCRC: frame.packageCRC,
      blockSize: frame.blockSize,
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
        state.session.packageCRC !== frame.packageCRC ||
        state.session.blockSize !== frame.blockSize;

      if (metadataChanged) {
        state.rejected += 1;
        element("scanBadge").textContent = "Stream metadata changed";
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
    element("scanBadge").textContent = "Start marker locked";
    updateScanUI();
  }

  // Data frame
  async function processData(frame) {
    if (!state.session || state.waitingForStart || state.session.streamId !== frame.streamId) {
      state.ignoredBeforeStart += 1;
      state.waitingForStart = true;
      element("scanBadge").textContent = "Stream found - waiting for start";
      updateScanUI();
      return;
    }

    if (frame.cycle !== state.session.cycle) {
      state.waitingForStart = true;
      state.ignoredBeforeStart += 1;
      element("scanBadge").textContent = "New cycle found - waiting for start";
      updateScanUI();
      return;
    }

    trackSequence(frame);

    if (state.session.chunks.has(frame.index)) {
      state.duplicates += 1;
      element("scanBadge").textContent = `Duplicate data frame ${frame.index + 1}`;
      updateScanUI();
      return;
    }

    state.session.chunks.set(frame.index, frame.payload);
    state.valid += 1;
    element("scanBadge").textContent = `Data frame ${frame.index + 1} received`;
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
    element("scanBadge").textContent = `Cycle ended - ${getMissingCount()} data frames missing`;
    updateScanUI();
  }

  // Receive frame
  async function processFrame(frame) {
    const key = `${frame.streamId}:${frame.cycle}:${frame.sequence}`;
    if (key === state.lastFrameKey) return;
    state.lastFrameKey = key;

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
    element("scanBadge").textContent = "Complete - verifying";
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

    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
    return true;
  }

  // Code outline
  function drawLock(frame) {
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
    if (!frame || !frame.corners) return;

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
    state.lastLockTime = performance.now();
  }

  // Clear outline
  function clearOldLock() {
    if (performance.now() - state.lastLockTime < 300) return;
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
        const frame = core.sampleFrameFromCanvas(element("sampleCanvas"), state.lockCorners);
        state.lastDecodeMs = performance.now() - started;
        state.lockCorners = frame.corners;
        state.lockFailures = 0;
        drawLock(frame);
        await processFrame(frame);
      }
    } catch (error) {
      state.lockFailures += 1;
      if (state.lockFailures >= 3) state.lockCorners = null;
      clearOldLock();

      if (["CRC mismatch", "Header CRC mismatch", "Frame damaged"].includes(error.message)) {
        state.rejected += 1;
        element("scanBadge").textContent = "Damaged flash skipped";
      } else if (error.message === "Low contrast") {
        element("scanBadge").textContent = "Increase screen brightness";
      } else if (error.message === "Code not found") {
        element("scanBadge").textContent = state.waitingForStart ? "Find the square" : "Keep the square in view";
      } else {
        element("scanBadge").textContent = state.waitingForStart ? "Looking for start marker" : "Looking for frames";
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

  // Scan loop
  function startScanLoop() {
    stopScanLoop();
    state.running = true;
    state.loopGeneration += 1;
    scheduleScan(state.loopGeneration);
  }

  function stopScanLoop() {
    const video = element("cameraVideo");
    state.running = false;
    state.loopGeneration += 1;

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

  // Camera request
  async function requestCamera(deviceId) {
    if (deviceId) {
      return navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    }

    const attempts = [
      {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { exact: 60 }
      },
      {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 24 }
      },
      {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
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
    element("scanBadge").textContent = "Find the JamScan square";

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
    drawLock(null);
    updateScanUI();
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
    state.lastFrameKey = "";
    state.lockCorners = null;
    state.lockFailures = 0;
    state.complete = false;
    element("scanPreviewHost").innerHTML = "";
    updateScanUI();
    element("scanBadge").textContent = state.stream ? "Find the JamScan square" : "Ready to scan";

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
    const frame = core.sampleFrameFromCanvas(canvas, state.lockCorners);
    state.lastDecodeMs = performance.now() - started;
    state.lockCorners = frame.corners;
    state.lockFailures = 0;
    drawLock(frame);
    await processFrame(frame);
    updateScanUI();
    ui.showToast(`${core.frameTypeLabel(frame.type)} frame read`);
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
