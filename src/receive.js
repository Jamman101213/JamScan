import { LTDecoder } from "./shared/fountain.js";
import { fnv1a, parseFrame } from "./shared/protocol.js";
import { formatBytes, parsePackage } from "./shared/package.js";
import { requestPreview } from "./shared/viewer.js";

const overhead = 1.18;
const video = document.getElementById("camera");
const cameraFrame = document.getElementById("camera-frame");
const status = document.getElementById("receive-status");
const startButton = document.getElementById("start-camera");
const stopButton = document.getElementById("stop-camera");
const progress = document.getElementById("receive-progress");
const resultHost = document.getElementById("receive-result");
const grab = document.createElement("canvas");
let stream = null;
let workers = [];
let busy = [];
let captureGeneration = 0;
let frameId = 0;
let decoder = null;
let streamKey = "";
let streamChecksum = 0;
let startedAt = 0;
let completed = false;
let statsTimer = null;
let wakeLock = null;
const captureTimes = [];
const decodeTimes = [];

const defaultWorkers = Math.min(6, Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
document.getElementById("worker-count").value = String([2, 3, 4, 6].reduce((best, value) => Math.abs(value - defaultWorkers) < Math.abs(best - defaultWorkers) ? value : best, 4));

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);

function setStatus(message, style = "") {
  status.textContent = message;
  status.className = `status${style ? ` ${style}` : ""}`;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access requires HTTPS or localhost.", "bad");
    return;
  }
  stopCamera();
  completed = false;
  resultHost.innerHTML = "";
  progress.style.width = "0%";
  decoder = null;
  streamKey = "";
  startButton.disabled = true;
  setStatus("Starting camera...");
  const width = Number(document.getElementById("capture-width").value);
  const requestedFps = Number(document.getElementById("capture-fps").value);
  const base = {
    facingMode: { ideal: "environment" },
    width: { ideal: width },
    height: { ideal: Math.round(width * 3 / 4) },
  };
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, frameRate: { exact: requestedFps } } });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, frameRate: { ideal: requestedFps } } });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: base });
      }
    }
  } catch (error) {
    startButton.disabled = false;
    setStatus(error instanceof Error ? `Camera error: ${error.message}` : String(error), "bad");
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  cameraFrame.hidden = false;
  stopButton.disabled = false;
  buildWorkers(Number(document.getElementById("worker-count").value));
  const settings = stream.getVideoTracks()[0]?.getSettings();
  document.getElementById("metric-camera").textContent = `${settings?.width || "?"}x${settings?.height || "?"} @ ${Math.round(settings?.frameRate || 0)}`;
  setStatus("Searching for a JamScan QR stream...");
  captureGeneration++;
  scheduleFrame(captureGeneration);
  clearInterval(statsTimer);
  statsTimer = setInterval(updateStats, 500);
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    wakeLock = null;
  }
}

function stopCamera() {
  captureGeneration++;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  cameraFrame.hidden = true;
  for (const worker of workers) worker.terminate();
  workers = [];
  busy = [];
  clearInterval(statsTimer);
  statsTimer = null;
  wakeLock?.release?.().catch(() => undefined);
  wakeLock = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  if (!completed) setStatus("Camera is off.");
}

function buildWorkers(count) {
  for (const worker of workers) worker.terminate();
  workers = [];
  busy = [];
  for (let index = 0; index < count; index++) {
    const worker = new Worker(new URL("./qr-worker.js", import.meta.url), { type: "module" });
    const slot = index;
    worker.onmessage = (event) => {
      if (event.data.id === -1) return;
      busy[slot] = false;
      if (event.data.bytes) {
        decodeTimes.push(performance.now());
        onDecoded(new Uint8Array(event.data.bytes));
      }
    };
    workers.push(worker);
    busy.push(false);
  }
}

function scheduleFrame(generation) {
  if (!stream || completed || generation !== captureGeneration) return;
  const callback = () => {
    if (!stream || completed || generation !== captureGeneration) return;
    captureFrame();
    scheduleFrame(generation);
  };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(callback);
  else requestAnimationFrame(callback);
}

function captureFrame() {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  captureTimes.push(performance.now());
  const slot = busy.indexOf(false);
  if (slot === -1) return;
  if (grab.width !== width || grab.height !== height) {
    grab.width = width;
    grab.height = height;
  }
  const context = grab.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  busy[slot] = true;
  workers[slot].postMessage({ id: frameId++, buffer: image.data.buffer, width, height }, [image.data.buffer]);
}

function onDecoded(bytes) {
  if (completed) return;
  const parsed = parseFrame(bytes);
  if (!parsed) return;
  const { header, block } = parsed;
  const key = `${header.sessionId}:${header.k}:${header.blockLen}:${header.totalLen}:${header.payloadFnv}`;
  if (!decoder || key !== streamKey) {
    decoder = new LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen);
    streamKey = key;
    streamChecksum = header.payloadFnv;
    startedAt = performance.now();
    progress.style.width = "0%";
    setStatus(`Locked onto a ${formatBytes(header.totalLen)} stream. Keep the phone steady.`, "good");
  }
  decoder.addFrame(header.seq, block);
  const ratio = Math.min(0.99, decoder.framesNew / (decoder.k * overhead));
  progress.style.width = `${(ratio * 100).toFixed(1)}%`;
  if (decoder.isComplete) finishTransfer();
}

async function finishTransfer() {
  if (!decoder || completed) return;
  const packageBytes = decoder.assemble();
  if (!packageBytes) return;
  if (fnv1a(packageBytes) !== streamChecksum) {
    setStatus("The optical checksum failed. Restart the scan.", "bad");
    return;
  }
  completed = true;
  progress.style.width = "100%";
  const seconds = (performance.now() - startedAt) / 1000;
  try {
    const parsed = await parsePackage(packageBytes);
    setStatus(`${parsed.metadata.name} received in ${seconds.toFixed(1)} seconds. SHA-256 ${parsed.hashOk ? "verified" : "mismatch"}.`, parsed.hashOk ? "good" : "bad");
    parsed.packageBytes = packageBytes;
    requestPreview(parsed, resultHost);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
  stopCamera();
}

function updateStats() {
  const now = performance.now();
  prune(captureTimes, now);
  prune(decodeTimes, now);
  document.getElementById("metric-capture").textContent = (captureTimes.length / 2).toFixed(0);
  document.getElementById("metric-decode").textContent = (decodeTimes.length / 2).toFixed(1);
  if (!decoder) return;
  const elapsed = Math.max(0.1, (now - startedAt) / 1000);
  const rate = (decoder.framesNew * decoder.blockLen) / overhead / 1024 / elapsed;
  document.getElementById("metric-valid").textContent = String(decoder.framesNew);
  document.getElementById("metric-duplicates").textContent = String(decoder.framesDup);
  document.getElementById("metric-rate").textContent = `${rate.toFixed(1)} KB/s`;
  document.getElementById("metric-payload").textContent = formatBytes(decoder.totalLen);
  document.getElementById("metric-elapsed").textContent = `${elapsed.toFixed(1)} s`;
}

function prune(values, now) {
  while (values.length && values[0] < now - 2000) values.shift();
}
