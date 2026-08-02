import QRCode from "qrcode";
import { LTEncoder } from "./shared/fountain.js";
import { HEADER_LEN, fnv1a, packFrame } from "./shared/protocol.js";
import { buildPackage, formatBytes, safeName } from "./shared/package.js";
import { chooseTransferPlan } from "./shared/transfer-plan.js";
import { expectedDisplayFrames, getChannelMode, makeSequenceBatch } from "./shared/channels.js";
import { downloadBytes } from "./shared/viewer.js";

const overhead = 1.18;
const lookahead = 2;
const canvas = document.getElementById("qr-canvas");
const context = canvas.getContext("2d", { alpha: false });
let mode = "file";
let profileName = "reliable";
let channelModeName = "standard";
let packageBytes = null;
let metadata = null;
let streamState = null;
let wakeLock = null;

const status = document.getElementById("send-status");
const startButton = document.getElementById("start-stream");
const saveButton = document.getElementById("save-jscan");
const pauseButton = document.getElementById("pause-stream");
const stopButton = document.getElementById("stop-stream");
const fullscreenButton = document.getElementById("fullscreen-stream");

clearCanvas("Prepare content to begin");

function setStatus(message, style = "") {
  status.textContent = message;
  status.className = `status${style ? ` ${style}` : ""}`;
}

function clearCanvas(message) {
  canvas.width = 900;
  canvas.height = 900;
  canvas.style.width = "";
  canvas.style.height = "";
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#171714";
  context.font = "700 26px system-ui";
  context.textAlign = "center";
  context.fillText(message, canvas.width / 2, canvas.height / 2);
}

function setMode(nextMode) {
  mode = nextMode;
  document.getElementById("mode-file").classList.toggle("active", mode === "file");
  document.getElementById("mode-text").classList.toggle("active", mode === "text");
  document.getElementById("file-pane").hidden = mode !== "file";
  document.getElementById("text-pane").hidden = mode !== "text";
}

document.getElementById("mode-file").addEventListener("click", () => setMode("file"));
document.getElementById("mode-text").addEventListener("click", () => setMode("text"));

document.querySelectorAll(".profile-button").forEach((button) => {
  button.addEventListener("click", () => {
    profileName = button.dataset.profile;
    document.querySelectorAll(".profile-button").forEach((item) => item.classList.toggle("active", item === button));
    if (packageBytes) updateEstimate();
    if (streamState) startStream();
  });
});

document.querySelectorAll(".channel-button").forEach((button) => {
  button.addEventListener("click", () => {
    channelModeName = button.dataset.channels;
    document.querySelectorAll(".channel-button").forEach((item) => item.classList.toggle("active", item === button));
    if (packageBytes) updateEstimate();
    if (streamState) startStream();
  });
});

document.getElementById("file-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size === 0) return setStatus("The selected file is empty.", "bad");
  if (file.size > 64 * 1024 * 1024) return setStatus("The file is over the 64 MB limit.", "bad");
  setStatus(`Preparing ${file.name}...`);
  try {
    const built = await buildPackage(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
    usePackage(built);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
});

document.getElementById("text-build").addEventListener("click", async () => {
  const text = document.getElementById("text-input").value;
  if (!text.trim()) return setStatus("Enter some text first.", "bad");
  const title = safeName(document.getElementById("text-title").value.trim() || "JamScan message");
  setStatus("Preparing text...");
  try {
    const built = await buildPackage(new TextEncoder().encode(text), `${title}.txt`, "text/plain;charset=utf-8");
    usePackage(built);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
});

function usePackage(built) {
  stopStream();
  packageBytes = built.bytes;
  metadata = built.metadata;
  startButton.disabled = false;
  saveButton.disabled = false;
  const plan = chooseTransferPlan(packageBytes.length, profileName);
  const extra = plan.staticQr ? " It will use one static QR." : "";
  startButton.textContent = plan.staticQr ? "Show QR" : "Start stream";
  setStatus(`${metadata.name} is ready. Package size: ${formatBytes(packageBytes.length)}.${extra}`, "good");
  updateEstimate();
}

function updateEstimate() {
  const plan = chooseTransferPlan(packageBytes.length, profileName);
  const selected = getChannelMode(channelModeName);
  const channels = plan.staticQr ? 1 : selected.count;
  const k = Math.ceil(packageBytes.length / plan.blockLen);
  const displays = plan.staticQr ? 1 : expectedDisplayFrames(k, overhead, channels);
  const seconds = displays / plan.fps;
  document.getElementById("send-size").textContent = formatBytes(packageBytes.length);
  document.getElementById("send-time").textContent = plan.staticQr ? "One valid scan" : formatTime(seconds);
  document.getElementById("send-blocks").textContent = String(k);
  document.getElementById("send-frame-size").textContent = `${plan.blockLen + HEADER_LEN} B each`;
  document.getElementById("send-rate").textContent = plan.staticQr
    ? "Static QR"
    : `${((plan.blockLen * plan.fps * channels) / 1024).toFixed(1)} KB/s raw`;
  document.getElementById("send-mode").textContent = plan.staticQr
    ? plan.label
    : `${plan.label}, ${selected.name} ${channels}-QR`;
}

function formatTime(seconds) {
  if (seconds < 1) return "Under 1 s";
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}

startButton.addEventListener("click", startStream);
pauseButton.addEventListener("click", () => {
  if (!streamState || streamState.plan.staticQr) return;
  streamState.paused = !streamState.paused;
  pauseButton.textContent = streamState.paused ? "Resume" : "Pause";
  if (!streamState.paused) scheduleTick(streamState.generation);
});
stopButton.addEventListener("click", stopStream);
fullscreenButton.addEventListener("click", async () => {
  document.body.classList.add("fullscreen-stream");
  if (streamState?.queue.length) sizeVisibleCanvas(streamState.queue[0].canvas.width, streamState.queue[0].canvas.height);
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    // Fullscreen is optional.
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) document.body.classList.remove("fullscreen-stream");
  if (streamState?.queue.length) sizeVisibleCanvas(streamState.queue[0].canvas.width, streamState.queue[0].canvas.height);
});
saveButton.addEventListener("click", () => {
  if (!packageBytes || !metadata) return;
  const base = metadata.name.replace(/\.[^.]+$/, "") || "shared";
  downloadBytes(packageBytes, `${base}.jscan`, "application/x-jamscan");
});

async function startStream() {
  if (!packageBytes) return;
  stopStream();
  const plan = chooseTransferPlan(packageBytes.length, profileName);
  const selected = getChannelMode(channelModeName);
  const channels = plan.staticQr ? 1 : selected.count;
  const sessionId = crypto.getRandomValues(new Uint16Array(1))[0] || 1;
  const encoder = new LTEncoder(packageBytes, plan.blockLen, sessionId);
  if (encoder.k > 65535) {
    setStatus("This file needs too many source blocks for the selected profile.", "bad");
    return;
  }
  const generation = Date.now() + Math.random();
  streamState = {
    generation,
    plan,
    channels,
    encoder,
    sessionId,
    checksum: fnv1a(packageBytes),
    sequence: 0,
    queue: [],
    paused: false,
    nextAt: performance.now(),
    version: undefined,
  };

  const queueSize = plan.staticQr ? 1 : lookahead;
  for (let i = 0; i < queueSize; i++) streamState.queue.push(buildDisplayFrame(streamState));
  sizeVisibleCanvas(streamState.queue[0].canvas.width, streamState.queue[0].canvas.height);
  renderFrame(streamState.queue[0]);

  startButton.disabled = true;
  pauseButton.disabled = plan.staticQr;
  stopButton.disabled = false;
  fullscreenButton.disabled = false;
  pauseButton.textContent = plan.staticQr ? "Static" : "Pause";
  setStatus(
    plan.staticQr
      ? "Static one-QR transfer running. The receiver only needs one successful scan."
      : `${selected.name} mode is showing ${channels} different QR codes per update at ${plan.fps} updates per second. Keep every code and its white margin visible.`,
    "good",
  );
  requestWakeLock();
  if (!plan.staticQr) scheduleTick(generation);
}

function stopStream() {
  if (streamState) streamState.generation = -1;
  streamState = null;
  startButton.disabled = !packageBytes;
  if (packageBytes) startButton.textContent = chooseTransferPlan(packageBytes.length, profileName).staticQr ? "Show QR" : "Start stream";
  pauseButton.disabled = true;
  stopButton.disabled = true;
  fullscreenButton.disabled = true;
  document.getElementById("send-sequence").textContent = "-";
  if (packageBytes) clearCanvas("Stream stopped");
  releaseWakeLock();
}

function buildDisplayFrame(state) {
  const sequences = state.plan.staticQr
    ? [0]
    : makeSequenceBatch(state.sequence, state.channels);
  if (!state.plan.staticQr) state.sequence += state.channels;
  const qrCanvases = sequences.map((sequence, index) => buildQrCanvas(state, sequence, index));
  return {
    sequences,
    canvas: composeQrCanvases(qrCanvases),
  };
}

function buildQrCanvas(state, sequence, channelIndex) {
  const block = state.encoder.encode(sequence);
  const bytes = packFrame({
    sessionId: state.sessionId,
    seq: sequence,
    k: state.encoder.k,
    blockLen: state.encoder.blockLen,
    totalLen: packageBytes.length,
    payloadFnv: state.checksum,
    channels: state.channels,
  }, block);
  const qr = QRCode.create([{ data: bytes, mode: "byte" }], {
    errorCorrectionLevel: state.plan.ecc,
    version: state.version,
    maskPattern: (4 + channelIndex) % 8,
  });
  if (state.version === undefined) state.version = qr.version;
  const offscreen = document.createElement("canvas");
  rasterize(qr, offscreen);
  return offscreen;
}

function rasterize(qr, target) {
  const margin = 4;
  const modules = qr.modules.size;
  const size = modules + margin * 2;
  target.width = size;
  target.height = size;
  const targetContext = target.getContext("2d", { alpha: false });
  targetContext.fillStyle = "white";
  targetContext.fillRect(0, 0, size, size);
  targetContext.fillStyle = "black";
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (qr.modules.get(x, y)) targetContext.fillRect(x + margin, y + margin, 1, 1);
    }
  }
}

function composeQrCanvases(items) {
  if (items.length === 1) return items[0];
  const tile = items[0].width;
  const gap = 8;
  let columns = 2;
  let rows = Math.ceil(items.length / columns);
  if (items.length === 2 && window.innerHeight > window.innerWidth) {
    columns = 1;
    rows = 2;
  }
  const output = document.createElement("canvas");
  output.width = columns * tile + (columns - 1) * gap;
  output.height = rows * tile + (rows - 1) * gap;
  const outputContext = output.getContext("2d", { alpha: false });
  outputContext.imageSmoothingEnabled = false;
  outputContext.fillStyle = "white";
  outputContext.fillRect(0, 0, output.width, output.height);
  items.forEach((item, index) => {
    const x = (index % columns) * (tile + gap);
    const y = Math.floor(index / columns) * (tile + gap);
    outputContext.drawImage(item, x, y);
  });
  return output;
}

function sizeVisibleCanvas(logicalWidth, logicalHeight) {
  const stage = document.querySelector(".qr-stage");
  const dpr = window.devicePixelRatio || 1;
  const fullscreen = document.body.classList.contains("fullscreen-stream");
  const budgetWidth = fullscreen ? window.innerWidth : stage.clientWidth - 28;
  const budgetHeight = fullscreen ? window.innerHeight : window.innerHeight * 0.78;
  const scale = Math.max(1, Math.floor(Math.min(
    (budgetWidth * dpr) / logicalWidth,
    (budgetHeight * dpr) / logicalHeight,
  )));
  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
}

function renderFrame(frame) {
  const scaleX = canvas.width / frame.canvas.width;
  const scaleY = canvas.height / frame.canvas.height;
  if (!canvas.width || scaleX < 1 || scaleY < 1) sizeVisibleCanvas(frame.canvas.width, frame.canvas.height);
  context.imageSmoothingEnabled = false;
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
  const first = frame.sequences[0];
  const last = frame.sequences[frame.sequences.length - 1];
  document.getElementById("send-sequence").textContent = first === last
    ? first.toLocaleString()
    : `${first.toLocaleString()}-${last.toLocaleString()}`;
}

function scheduleTick(generation) {
  if (!streamState || streamState.generation !== generation || streamState.paused || streamState.plan.staticQr) return;
  const interval = 1000 / streamState.plan.fps;
  const wait = Math.max(0, streamState.nextAt - performance.now());
  setTimeout(() => tick(generation), wait);
  streamState.nextAt += interval;
}

function tick(generation) {
  if (!streamState || streamState.generation !== generation || streamState.paused || streamState.plan.staticQr) return;
  const frame = streamState.queue.shift();
  renderFrame(frame);
  streamState.queue.push(buildDisplayFrame(streamState));
  scheduleTick(generation);
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => undefined);
  wakeLock = null;
}

window.addEventListener("resize", () => {
  if (!streamState || !streamState.queue.length) return;
  sizeVisibleCanvas(streamState.queue[0].canvas.width, streamState.queue[0].canvas.height);
  renderFrame(streamState.queue[0]);
});
