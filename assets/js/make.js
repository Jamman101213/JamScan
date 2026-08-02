(() => {
  "use strict";

  // Page state
  const state = {
    mode: "file",
    file: null,
    packageBytes: null,
    packageMeta: null,
    stream: null,
    frames: [],
    frameIndex: 0,
    cycle: 0,
    playing: false,
    animationId: null,
    lastFrameTime: 0,
    measuredFps: 0,
    measuredFrames: 0,
    measuredStarted: 0
  };

  const core = window.JamScanCore;
  const ui = window.JamScanUI;

  // Elements
  function element(id) {
    return document.getElementById(id);
  }

  // Select mode
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

  // Speed setting
  function getDelay() {
    return Number(element("speedSelect").value);
  }

  function getEstimatedFps() {
    const delay = getDelay();
    if (delay <= 1) return state.measuredFps || 60;
    return 1000 / delay;
  }

  // Start marker length
  function getCycleOptions() {
    const fps = Math.max(5, Math.min(120, getEstimatedFps()));
    return {
      startRepeats: Math.ceil(fps * 0.7),
      endRepeats: Math.ceil(fps * 0.22),
      dataRepeats: state.stream && state.stream.total <= 10 ? 2 : 1
    };
  }

  // Stream metrics
  function updateMetrics() {
    const dataFrames = state.stream ? state.stream.total : 0;
    const current = state.frames[state.frameIndex];
    const estimatedFps = getEstimatedFps();

    element("metricFrames").textContent = dataFrames ? dataFrames.toLocaleString() : "-";
    element("metricCurrent").textContent = current
      ? current.type === core.FRAME_TYPE.DATA
        ? `Data ${current.index + 1}`
        : core.frameTypeLabel(current.type)
      : "-";
    element("metricSize").textContent = state.packageBytes ? core.formatBytes(state.packageBytes.length) : "-";
    element("metricTime").textContent = state.frames.length
      ? core.formatDuration(state.frames.length / estimatedFps)
      : "-";
    element("metricRate").textContent = state.playing && state.measuredFps
      ? `${state.measuredFps.toFixed(0)} fps`
      : getDelay() <= 1
        ? "Refresh limit"
        : `${estimatedFps.toFixed(0)} fps`;
    element("metricCycle").textContent = state.stream ? String(state.cycle + 1) : "-";
    element("metricStart").textContent = state.frames.length
      ? `${(getCycleOptions().startRepeats / estimatedFps).toFixed(1)} sec`
      : "-";
  }

  // Current frame
  function showFrame() {
    if (!state.frames.length) return;

    state.frameIndex = Math.max(0, Math.min(state.frameIndex, state.frames.length - 1));
    core.renderFrame(element("streamCanvas"), state.frames[state.frameIndex]);
    updateMetrics();
  }

  // New cycle
  function loadCycle(cycle) {
    state.cycle = cycle;
    state.frames = core.createCycleFrames(state.stream, state.cycle, getCycleOptions());
    state.frameIndex = 0;
  }

  // Playback stop
  function stopPlayback() {
    state.playing = false;
    element("playButton").textContent = "Play";

    if (state.animationId !== null) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    state.lastFrameTime = 0;
    updateMetrics();
  }

  // Playback frame
  function playbackStep(time) {
    if (!state.playing) return;

    const delay = getDelay();
    const ready = !state.lastFrameTime || time - state.lastFrameTime >= delay;

    if (ready) {
      state.lastFrameTime = time;
      state.frameIndex += 1;

      if (state.frameIndex >= state.frames.length) {
        loadCycle(state.cycle + 1);
      }

      showFrame();
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
    if (!state.frames.length) return;

    if (state.playing) {
      stopPlayback();
      return;
    }

    state.playing = true;
    state.measuredFrames = 0;
    state.measuredStarted = 0;
    state.measuredFps = 0;
    element("playButton").textContent = "Pause";
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
      loadCycle(0);

      element("streamEmpty").classList.add("hidden");
      element("downloadButton").disabled = false;
      element("playButton").disabled = false;
      element("restartButton").disabled = false;
      element("fullscreenButton").disabled = false;

      stopPlayback();
      showFrame();

      ui.setStatus(
        "buildStatus",
        `${core.kindLabel(built.meta.kind)} ready: ${built.meta.name} - ${core.formatBytes(payload.length)} - ${state.stream.total.toLocaleString()} data frames.`,
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

  // Page events
  function startPage() {
    ui.bindDropZone(element("sourceDrop"), element("sourceFile"), setSourceFile);

    element("fileModeButton").addEventListener("click", () => setMode("file"));
    element("textModeButton").addEventListener("click", () => setMode("text"));
    element("removeSourceButton").addEventListener("click", clearSourceFile);
    element("buildButton").addEventListener("click", buildFromPage);
    element("downloadButton").addEventListener("click", downloadPackage);
    element("playButton").addEventListener("click", togglePlayback);

    element("restartButton").addEventListener("click", () => {
      if (!state.stream) return;
      loadCycle(0);
      showFrame();
    });

    element("fullscreenButton").addEventListener("click", async () => {
      try {
        await element("canvasShell").requestFullscreen();
      } catch {
        ui.showToast("Fullscreen was blocked");
      }
    });

    element("speedSelect").addEventListener("change", () => {
      state.measuredFps = 0;
      if (state.stream) {
        loadCycle(state.cycle);
        showFrame();
      }
      updateMetrics();
    });

    updateMetrics();
    window.addEventListener("beforeunload", stopPlayback);
  }

  document.addEventListener("DOMContentLoaded", startPage);
})();
