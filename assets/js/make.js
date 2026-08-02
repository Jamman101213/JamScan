(() => {
  "use strict";

  // Page state
  const state = {
    mode: "file",
    file: null,
    packageBytes: null,
    packageMeta: null,
    stream: null,
    sequence: 0,
    playing: false,
    animationId: null,
    lastFrameTime: 0,
    measuredFps: 0,
    measuredFrames: 0,
    measuredStarted: 0,
    wakeLock: null
  };

  const core = window.JamScanCore;
  const ui = window.JamScanUI;

  // Find element
  function element(id) {
    return document.getElementById(id);
  }

  // Select content type
  function setMode(mode) {
    state.mode = mode;
    element("fileModeButton").classList.toggle("active", mode === "file");
    element("textModeButton").classList.toggle("active", mode === "text");
    element("fileMode").classList.toggle("hidden", mode !== "file");
    element("textMode").classList.toggle("hidden", mode !== "text");
  }

  // Select file
  function setSourceFile(file) {
    if (file.size > core.MAX_SOURCE_SIZE) {
      ui.setStatus("buildStatus", "This version supports files up to 256 MB.", "bad");
      return;
    }

    state.file = file;
    const kind = core.classify(file.type, file.name);

    element("sourceFileRow").classList.remove("hidden");
    element("sourceKind").textContent = core.shortKind(kind);
    element("sourceName").textContent = file.name;
    element("sourceDetails").textContent = `${file.type || "Unknown type"} - ${core.formatBytes(file.size)}`;
    ui.setStatus("buildStatus", "File selected. Select Build JamScan.");
  }

  // Clear file
  function clearSourceFile() {
    state.file = null;
    element("sourceFileRow").classList.add("hidden");
    ui.setStatus("buildStatus", "Choose content, then build the package.");
  }

  // Stream settings
  function getDelay() {
    return Number(element("speedSelect").value);
  }

  function getCodesPerFlash() {
    return Number(element("codeCountSelect").value);
  }

  function getEstimatedFps() {
    const delay = getDelay();
    if (delay <= 1) return state.measuredFps || 60;
    return 1000 / delay;
  }

  // Current frames
  function currentFrames() {
    if (!state.stream) return [];

    const count = getCodesPerFlash();
    const frames = [];
    for (let index = 0; index < count; index += 1) {
      frames.push(core.createFountainFrame(state.stream, state.sequence + index));
    }
    return frames;
  }

  // Stream metrics
  function updateMetrics() {
    const blockCount = state.stream ? state.stream.total : 0;
    const codes = getCodesPerFlash();
    const estimatedFps = getEstimatedFps();
    const estimatedFrames = blockCount ? Math.ceil(blockCount * 1.35) : 0;
    const codeRate = estimatedFps * codes;

    element("metricFrames").textContent = blockCount ? blockCount.toLocaleString() : "-";
    element("metricCurrent").textContent = state.stream
      ? codes === 1
        ? String(state.sequence)
        : `${state.sequence}-${state.sequence + codes - 1}`
      : "-";
    element("metricSize").textContent = state.packageBytes ? core.formatBytes(state.packageBytes.length) : "-";
    element("metricTime").textContent = estimatedFrames
      ? core.formatDuration(estimatedFrames / Math.max(1, codeRate))
      : "-";
    element("metricRate").textContent = state.playing && state.measuredFps
      ? `${Math.round(state.measuredFps * codes)} codes/s`
      : getDelay() <= 1
        ? `Up to refresh x ${codes}`
        : `${Math.round(codeRate)} codes/s`;
    element("metricCycle").textContent = state.stream ? "Continuous" : "-";
    element("metricStart").textContent = state.stream ? "Any frame" : "-";
    element("metricCodes").textContent = state.stream ? String(codes) : "-";
  }

  // Draw flash
  function showFlash() {
    if (!state.stream) return;
    core.renderFrameGrid(element("streamCanvas"), currentFrames());
    updateMetrics();
  }

  // Wake lock
  async function requestWakeLock() {
    try {
      state.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      state.wakeLock = null;
    }
  }

  // Stop playback
  function stopPlayback() {
    state.playing = false;
    element("playButton").textContent = "Play";

    if (state.animationId !== null) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    state.lastFrameTime = 0;
    state.wakeLock?.release?.().catch(() => undefined);
    state.wakeLock = null;
    updateMetrics();
  }

  // Playback frame
  function playbackStep(time) {
    if (!state.playing) return;

    const delay = getDelay();
    const ready = !state.lastFrameTime || time - state.lastFrameTime >= delay;

    if (ready) {
      state.lastFrameTime = time;
      state.sequence = (state.sequence + getCodesPerFlash()) >>> 0;
      showFlash();
      state.measuredFrames += 1;

      if (!state.measuredStarted) state.measuredStarted = time;
      const measuredTime = time - state.measuredStarted;

      if (measuredTime >= 1000) {
        state.measuredFps = (state.measuredFrames * 1000) / measuredTime;
        state.measuredFrames = 0;
        state.measuredStarted = time;
        updateMetrics();
      }
    }

    state.animationId = requestAnimationFrame(playbackStep);
  }

  // Playback toggle
  function togglePlayback() {
    if (!state.stream) return;

    if (state.playing) {
      stopPlayback();
      return;
    }

    state.playing = true;
    state.measuredFrames = 0;
    state.measuredStarted = 0;
    state.measuredFps = 0;
    element("playButton").textContent = "Pause";
    requestWakeLock();
    state.animationId = requestAnimationFrame(playbackStep);
  }

  // Build package
  async function buildFromPage() {
    try {
      element("buildButton").disabled = true;
      ui.setStatus("buildStatus", "Building package and calculating SHA-256.");

      let payload;
      let name;
      let type;

      if (state.mode === "file") {
        if (!state.file) throw new Error("Choose a file first.");

        payload = new Uint8Array(await state.file.arrayBuffer());
        name = state.file.name;
        type = state.file.type || core.mimeForName(name);
      } else {
        const text = element("textInput").value;
        if (!text.trim()) throw new Error("Enter some text first.");

        payload = core.textEncoder.encode(text);
        name = core.safeName(`${element("textName").value.trim() || "JamScan message"}.txt`);
        type = "text/plain;charset=utf-8";
      }

      const built = await core.buildPackage(payload, name, type);
      state.packageBytes = built.bytes;
      state.packageMeta = built.meta;
      state.stream = core.createStream(built.bytes);
      state.sequence = 0;

      element("streamEmpty").classList.add("hidden");
      element("downloadButton").disabled = false;
      element("playButton").disabled = false;
      element("restartButton").disabled = false;
      element("fullscreenButton").disabled = false;

      stopPlayback();
      showFlash();

      ui.setStatus(
        "buildStatus",
        `${core.kindLabel(built.meta.kind)} ready: ${built.meta.name} - ${core.formatBytes(payload.length)} - ${state.stream.total.toLocaleString()} source blocks.`,
        "good"
      );
      ui.showToast("JamScan package ready");
    } catch (error) {
      ui.setStatus("buildStatus", error.message || "Could not build the package.", "bad");
    } finally {
      element("buildButton").disabled = false;
    }
  }

  // Save package
  function downloadPackage() {
    if (!state.packageBytes || !state.packageMeta) return;

    const base = state.packageMeta.name.replace(/\.[^.]+$/, "") || "shared";
    ui.downloadBytes(
      state.packageBytes,
      `${core.safeName(base)}.jscan`,
      "application/x-jamscan"
    );
  }

  // Update stream settings
  function streamSettingChanged() {
    state.measuredFps = 0;
    if (state.stream) showFlash();
    updateMetrics();
  }

  // Start page
  function startPage() {
    ui.bindDropZone(element("sourceDrop"), element("sourceFile"), setSourceFile);

    // Default mosaic mode
    element("codeCountSelect").value = "64";

    element("fileModeButton").addEventListener("click", () => setMode("file"));
    element("textModeButton").addEventListener("click", () => setMode("text"));
    element("removeSourceButton").addEventListener("click", clearSourceFile);
    element("buildButton").addEventListener("click", buildFromPage);
    element("downloadButton").addEventListener("click", downloadPackage);
    element("playButton").addEventListener("click", togglePlayback);

    element("restartButton").addEventListener("click", () => {
      if (!state.stream) return;
      state.sequence = 0;
      showFlash();
    });

    element("fullscreenButton").addEventListener("click", async () => {
      try {
        await element("canvasShell").requestFullscreen();
      } catch {
        ui.showToast("Fullscreen was blocked");
      }
    });

    element("speedSelect").addEventListener("change", streamSettingChanged);
    element("codeCountSelect").addEventListener("change", streamSettingChanged);

    updateMetrics();
    window.addEventListener("beforeunload", stopPlayback);
  }

  document.addEventListener("DOMContentLoaded", startPage);
})();
