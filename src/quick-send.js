import QRCode from "qrcode";
import { buildPackage, formatBytes, safeName } from "./shared/package.js";
import { BUFFER_HIGH_WATER, BUFFER_LOW_WATER, CHUNK_SIZE, MAX_QUICK_FILE_SIZE, createTransferMeta, formatEta, formatSpeed } from "./shared/quick-protocol.js";
import { applySignal, createPeer, describeSelectedConnection, randomToken, signalUrl, waitForBuffer } from "./shared/webrtc.js";

const fileModeButton = document.querySelector("#quick-file-mode");
const textModeButton = document.querySelector("#quick-text-mode");
const filePane = document.querySelector("#quick-file-pane");
const textPane = document.querySelector("#quick-text-pane");
const fileInput = document.querySelector("#quick-file");
const textInput = document.querySelector("#quick-text");
const textTitle = document.querySelector("#quick-text-title");
const prepareTextButton = document.querySelector("#quick-prepare-text");
const originSelect = document.querySelector("#pair-origin");
const createButton = document.querySelector("#create-pairing");
const sendButton = document.querySelector("#send-now");
const resetButton = document.querySelector("#reset-quick-send");
const autoSend = document.querySelector("#auto-send");
const status = document.querySelector("#quick-send-status");
const qrCanvas = document.querySelector("#pairing-qr");
const placeholder = document.querySelector("#pairing-placeholder");
const pairingDetails = document.querySelector("#pairing-details");
const pairCode = document.querySelector("#pair-code");
const copyPairLink = document.querySelector("#copy-pair-link");
const connectionValue = document.querySelector("#quick-connection");
const fileSizeValue = document.querySelector("#quick-file-size");
const sentValue = document.querySelector("#quick-sent");
const speedValue = document.querySelector("#quick-speed");
const etaValue = document.querySelector("#quick-eta");
const routeValue = document.querySelector("#quick-route");
const progress = document.querySelector("#quick-send-progress");

const state = {
  mode: "file",
  packageBytes: null,
  metadata: null,
  runtime: null,
  socket: null,
  peer: null,
  channel: null,
  key: "",
  session: "",
  pairLink: "",
  sending: false,
  sentOnce: false,
  pendingSignals: [],
};

initialize().catch((error) => setStatus(error.message, "bad"));

async function initialize() {
  state.runtime = await fetch("/api/runtime").then((response) => {
    if (!response.ok) throw new Error("JamScan signaling is not running. Start the Node server with npm run dev.");
    return response.json();
  });
  fillOriginOptions(state.runtime);
}

fileModeButton.addEventListener("click", () => setMode("file"));
textModeButton.addEventListener("click", () => setMode("text"));
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) prepareFile(file);
});
prepareTextButton.addEventListener("click", prepareText);
createButton.addEventListener("click", createPairing);
sendButton.addEventListener("click", sendPackage);
resetButton.addEventListener("click", resetAll);
copyPairLink.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.pairLink);
  } catch {
    const input = document.createElement("textarea");
    input.value = state.pairLink;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  setStatus("Pairing link copied.", "good");
});

function setMode(mode) {
  state.mode = mode;
  fileModeButton.classList.toggle("active", mode === "file");
  textModeButton.classList.toggle("active", mode === "text");
  filePane.hidden = mode !== "file";
  textPane.hidden = mode !== "text";
}

async function prepareFile(file) {
  try {
    if (file.size > MAX_QUICK_FILE_SIZE) throw new Error("This build supports quick-transfer files up to 256 MB.");
    setStatus("Preparing the file and calculating its integrity hash.");
    createButton.disabled = true;
    const payload = new Uint8Array(await file.arrayBuffer());
    const built = await buildPackage(payload, file.name, file.type || "application/octet-stream");
    state.packageBytes = built.bytes;
    state.metadata = built.metadata;
    state.sentOnce = false;
    fileSizeValue.textContent = `${formatBytes(file.size)} original`;
    createButton.disabled = false;
    setStatus(`${safeName(file.name)} is ready. Create the pairing QR.`, "good");
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

async function prepareText() {
  const text = textInput.value;
  if (!text.trim()) return setStatus("Enter some text first.", "bad");
  try {
    setStatus("Preparing the text.");
    const payload = new TextEncoder().encode(text);
    const name = `${safeName(textTitle.value.trim() || "JamScan message")}.txt`;
    const built = await buildPackage(payload, name, "text/plain;charset=utf-8");
    state.packageBytes = built.bytes;
    state.metadata = built.metadata;
    state.sentOnce = false;
    fileSizeValue.textContent = `${formatBytes(payload.length)} original`;
    createButton.disabled = false;
    setStatus("Text is ready. Create the pairing QR.", "good");
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

async function createPairing() {
  if (!state.packageBytes || !state.runtime) return;
  closeConnections();
  state.key = randomToken(18);
  state.session = "";
  state.pairLink = "";
  state.sentOnce = false;
  connectionValue.textContent = "Creating session";
  setStatus("Creating a temporary pairing session.");

  const socket = new WebSocket(signalUrl());
  state.socket = socket;
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "create", key: state.key })));
  socket.addEventListener("message", (event) => handleSocketMessage(JSON.parse(event.data)));
  socket.addEventListener("close", () => {
    if (!state.peer || state.peer.connectionState !== "connected") connectionValue.textContent = "Signaling disconnected";
  });
  socket.addEventListener("error", () => setStatus("Could not connect to the JamScan signaling server.", "bad"));
}

async function handleSocketMessage(message) {
  if (message.type === "created") {
    state.session = message.session;
    const base = originSelect.value.replace(/\/$/, "");
    const receivePath = new URL("../../q/", location.href).pathname;
    state.pairLink = `${base}${receivePath}?s=${encodeURIComponent(state.session)}#k=${encodeURIComponent(state.key)}`;
    await QRCode.toCanvas(qrCanvas, state.pairLink, {
      width: 560,
      margin: 4,
      errorCorrectionLevel: "H",
      color: { dark: "#171714", light: "#ffffff" },
    });
    qrCanvas.hidden = false;
    placeholder.hidden = true;
    pairingDetails.hidden = false;
    pairCode.textContent = state.session;
    connectionValue.textContent = "Waiting for receiver";
    setStatus("Scan the static QR with the receiving phone's normal camera app.", "good");
    return;
  }
  if (message.type === "peer-ready") {
    await startPeer();
    return;
  }
  if (message.type === "signal") {
    if (!state.peer) state.pendingSignals.push(message.data);
    else {
      const response = await applySignal(state.peer, message.data, "sender");
      if (response) sendSignal(response);
    }
    return;
  }
  if (message.type === "peer-left") {
    connectionValue.textContent = "Receiver left";
    sendButton.disabled = true;
    return;
  }
  if (message.type === "expired") return setStatus("The pairing session expired. Create a new QR.", "bad");
  if (message.type === "error") setStatus(`${message.code}: ${message.message}`, "bad");
}

async function startPeer() {
  if (state.peer) state.peer.close();
  const peer = createPeer(state.runtime.iceServers, sendSignal);
  state.peer = peer;
  for (const pending of state.pendingSignals.splice(0)) {
    const response = await applySignal(peer, pending, "sender");
    if (response) sendSignal(response);
  }
  const channel = peer.createDataChannel("jamscan-file", { ordered: true });
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
  channel.addEventListener("open", async () => {
    connectionValue.textContent = "Connected";
    routeValue.textContent = await describeSelectedConnection(peer);
    sendButton.disabled = false;
    setStatus("Receiver connected. Ready to send.", "good");
    if (autoSend.checked && !state.sentOnce) sendPackage();
  });
  channel.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === "received") {
        connectionValue.textContent = "Transfer confirmed";
        setStatus("The receiver verified the complete file.", "good");
      }
      if (message.type === "error") setStatus(`Receiver error: ${message.message}`, "bad");
    } catch {}
  });
  channel.addEventListener("close", () => {
    sendButton.disabled = true;
    if (!state.sending) connectionValue.textContent = "Disconnected";
  });
  peer.addEventListener("connectionstatechange", async () => {
    const value = peer.connectionState;
    if (value === "connected") routeValue.textContent = await describeSelectedConnection(peer);
    if (["failed", "disconnected", "closed"].includes(value) && !state.sending) connectionValue.textContent = value;
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  sendSignal({ description: peer.localDescription });
  connectionValue.textContent = "Negotiating";
}

function sendSignal(data) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "signal", data }));
}

async function sendPackage() {
  if (state.sending || !state.packageBytes || state.channel?.readyState !== "open") return;
  state.sending = true;
  state.sentOnce = true;
  sendButton.disabled = true;
  const bytes = state.packageBytes;
  const meta = createTransferMeta(bytes, state.metadata);
  state.channel.send(JSON.stringify(meta));
  const startedAt = performance.now();
  let offset = 0;

  try {
    while (offset < bytes.length) {
      if (state.channel.readyState !== "open") throw new Error("The receiver disconnected.");
      await waitForBuffer(state.channel, BUFFER_HIGH_WATER, BUFFER_LOW_WATER);
      const end = Math.min(offset + CHUNK_SIZE, bytes.length);
      state.channel.send(bytes.slice(offset, end).buffer);
      offset = end;
      updateProgress(offset, bytes.length, startedAt);
    }
    state.channel.send(JSON.stringify({ type: "complete", packageSize: bytes.length }));
    progress.style.width = "100%";
    sentValue.textContent = formatBytes(bytes.length);
    etaValue.textContent = "Done";
    setStatus("File sent. Waiting for the receiver's verification.", "good");
  } catch (error) {
    setStatus(error.message, "bad");
    state.sentOnce = false;
  } finally {
    state.sending = false;
    sendButton.disabled = state.channel?.readyState !== "open";
  }
}

function updateProgress(sent, total, startedAt) {
  const elapsed = Math.max(0.001, (performance.now() - startedAt) / 1000);
  const rate = sent / elapsed;
  sentValue.textContent = `${formatBytes(sent)} / ${formatBytes(total)}`;
  speedValue.textContent = formatSpeed(rate);
  etaValue.textContent = formatEta((total - sent) / rate);
  progress.style.width = `${Math.min(100, sent / total * 100)}%`;
}

function fillOriginOptions(runtime) {
  const options = [];
  if (runtime.publicOrigin) options.push(runtime.publicOrigin);
  options.push(...runtime.suggestedOrigins);
  options.push(location.origin);
  for (const value of [...new Set(options.filter(Boolean))]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    originSelect.appendChild(option);
  }
  const nonLocal = [...originSelect.options].find((option) => !/localhost|127\.0\.0\.1/.test(option.value));
  if (/localhost|127\.0\.0\.1/.test(location.hostname) && nonLocal) originSelect.value = nonLocal.value;
}

function resetAll() {
  closeConnections();
  state.packageBytes = null;
  state.metadata = null;
  state.sentOnce = false;
  fileInput.value = "";
  textInput.value = "";
  qrCanvas.hidden = true;
  pairingDetails.hidden = true;
  placeholder.hidden = false;
  createButton.disabled = true;
  sendButton.disabled = true;
  progress.style.width = "0%";
  connectionValue.textContent = "Not paired";
  fileSizeValue.textContent = "-";
  sentValue.textContent = "0 B";
  speedValue.textContent = "-";
  etaValue.textContent = "-";
  routeValue.textContent = "-";
  setStatus("Choose a file or prepare text.");
}

function closeConnections() {
  if (state.channel) state.channel.close();
  if (state.peer) state.peer.close();
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "leave" }));
  if (state.socket) state.socket.close();
  state.socket = null;
  state.peer = null;
  state.channel = null;
  state.sending = false;
  state.pendingSignals = [];
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status${kind ? ` ${kind}` : ""}`;
}

window.addEventListener("beforeunload", closeConnections);
