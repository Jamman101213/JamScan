import QRCode from "qrcode";
import { LTEncoder } from "./shared/fountain.js";
import { HEADER_LEN, fnv1a, packFrame } from "./shared/protocol.js";
import { buildPackage, formatBytes, safeName } from "./shared/package.js";
import { chooseTransferPlan } from "./shared/transfer-plan.js";
import { downloadBytes } from "./shared/viewer.js";

const overhead = 1.18;
const lookahead = 3;
const canvas = document.getElementById("qr-canvas");
const context = canvas.getContext("2d", { alpha: false });
let mode = "file";
let profileName = "reliable";
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
  const k = Math.ceil(packageBytes.length / plan.blockLen);
  const expectedFrames = k === 1 ? 1 : Math.ceil(k * overhead);
  const seconds = expectedFrames / plan.fps;
  document.getElementById("send-size").textContent = formatBytes(packageBytes.length);
  document.getElementById("send-time").textContent = plan.staticQr ? "One valid scan" : formatTime(seconds);
  document.getElementById("send-blocks").textContent = String(k);
  document.getElementById("send-frame-size").textContent = `${plan.blockLen + HEADER_LEN} B`;
  document.getElementById("send-rate").textContent = plan.staticQr
    ? "Static QR"
    : `${((plan.blockLen * plan.fps) / 1024).toFixed(1)} KB/s raw`;
  document.getElementById("send-mode").textContent = plan.label;
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
  if (streamState?.queue.length) sizeVisibleCanvas(streamState.queue[0].canvas.width);
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    // Fullscreen is optional.
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) document.body.classList.remove("fullscreen-stream");
  if (streamState?.queue.length) sizeVisibleCanvas(streamState.queue[0].canvas.width);
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
  for (let i = 0; i < queueSize; i++) streamState.queue.push(buildQrFrame(streamState));
  sizeVisibleCanvas(streamState.queue[0].canvas.width);
  renderFrame(streamState.queue[0]);

  startButton.disabled = true;
  pauseButton.disabled = plan.staticQr;
  stopButton.disabled = false;
  fullscreenButton.disabled = false;
  pauseButton.textContent = plan.staticQr ? "Static" : "Pause";
  setStatus(
    plan.staticQr
      ? "Static one-QR transfer running. The receiver only needs one successful scan."
      : `${plan.label} running at ${plan.fps} FPS. Keep the complete QR and white margin visible.`,
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

function buildQrFrame(state) {
  const seq = state.plan.staticQr ? 0 : state.sequence++;
  const block = state.encoder.encode(seq);
  const bytes = packFrame({
    sessionId: state.sessionId,
    seq,
    k: state.encoder.k,
    blockLen: state.encoder.blockLen,
    totalLen: packageBytes.length,
    payloadFnv: state.checksum,
  }, block);
  const qr = QRCode.create([{ data: bytes, mode: "byte" }], {
    errorCorrectionLevel: state.plan.ecc,
    version: state.version,
    maskPattern: 4,
  });
  if (state.version === undefined) state.version = qr.version;
  const offscreen = document.createElement("canvas");
  rasterize(qr, offscreen);
  return { seq, canvas: offscreen };
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

function sizeVisibleCanvas(moduleSize) {
  const stage = document.querySelector(".qr-stage");
  const dpr = window.devicePixelRatio || 1;
  const viewportBudget = document.body.classList.contains("fullscreen-stream")
    ? Math.min(window.innerWidth, window.innerHeight)
    : Math.min(stage.clientWidth - 28, window.innerHeight * 0.78);
  const scale = Math.max(1, Math.floor((viewportBudget * dpr) / moduleSize));
  canvas.width = moduleSize * scale;
  canvas.height = moduleSize * scale;
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
}

function renderFrame(frame) {
  if (!canvas.width || Math.round(canvas.width / frame.canvas.width) < 1) sizeVisibleCanvas(frame.canvas.width);
  context.imageSmoothingEnabled = false;
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
  document.getElementById("send-sequence").textContent = frame.seq.toLocaleString();
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
  streamState.queue.push(buildQrFrame(streamState));
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
  sizeVisibleCanvas(streamState.queue[0].canvas.width);
  renderFrame(streamState.queue[0]);
});

