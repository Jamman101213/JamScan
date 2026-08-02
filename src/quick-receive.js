import { formatBytes, parsePackage } from "./shared/package.js";
import { MAX_QUICK_FILE_SIZE, formatEta, formatSpeed, joinChunks } from "./shared/quick-protocol.js";
import { requestPreview } from "./shared/viewer.js";
import { applySignal, createPeer, describeSelectedConnection, signalUrl } from "./shared/webrtc.js";

const heading = document.querySelector("#quick-receive-heading");
const message = document.querySelector("#quick-receive-message");
const connectionValue = document.querySelector("#quick-receive-connection");
const nameValue = document.querySelector("#quick-receive-name");
const receivedValue = document.querySelector("#quick-received");
const speedValue = document.querySelector("#quick-receive-speed");
const etaValue = document.querySelector("#quick-receive-eta");
const routeValue = document.querySelector("#quick-receive-route");
const progress = document.querySelector("#quick-receive-progress");
const errorBox = document.querySelector("#quick-receive-error");
const cancelButton = document.querySelector("#cancel-quick-receive");
const previewHost = document.querySelector("#quick-preview");

const state = {
  runtime: null,
  socket: null,
  peer: null,
  channel: null,
  meta: null,
  chunks: [],
  received: 0,
  startedAt: 0,
  finished: false,
  pendingSignals: [],
};

cancelButton.addEventListener("click", () => {
  closeConnections();
  setConnection("Cancelled", "The transfer was cancelled.");
});

start().catch((error) => fail(error.message));

async function start() {
  const parameters = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const session = parameters.get("s") || parameters.get("session") || "";
  const key = fragment.get("k") || fragment.get("key") || "";
  if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (!/^[A-Z0-9]{8}$/.test(session) || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new Error("This pairing link is incomplete. Scan a new JamScan Quick Transfer QR.");
  }
  state.runtime = await fetch("/api/runtime").then((response) => {
    if (!response.ok) throw new Error("The JamScan signaling server is unavailable.");
    return response.json();
  });
  setConnection("Joining session", `Pairing code ${session}`);
  const socket = new WebSocket(signalUrl());
  state.socket = socket;
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "join", session, key })));
  socket.addEventListener("message", (event) => handleSocketMessage(JSON.parse(event.data)));
  socket.addEventListener("error", () => fail("Could not connect to the JamScan signaling server."));
  socket.addEventListener("close", () => {
    if (!state.finished && state.peer?.connectionState !== "connected") fail("The signaling connection closed before pairing finished.");
  });
}

async function handleSocketMessage(signal) {
  if (signal.type === "joined") {
    setConnection("Waiting for sender", "The pairing secret was accepted.");
    await createReceiverPeer();
    return;
  }
  if (signal.type === "signal") {
    if (!state.peer) state.pendingSignals.push(signal.data);
    else {
      const response = await applySignal(state.peer, signal.data, "receiver");
      if (response) sendSignal(response);
    }
    return;
  }
  if (signal.type === "peer-left") return fail("The sender left the session.");
  if (signal.type === "expired") return fail("The pairing session expired.");
  if (signal.type === "error") fail(`${signal.code}: ${signal.message}`);
}

async function createReceiverPeer() {
  const peer = createPeer(state.runtime.iceServers, sendSignal);
  state.peer = peer;
  peer.addEventListener("datachannel", (event) => configureChannel(event.channel));
  peer.addEventListener("connectionstatechange", async () => {
    if (peer.connectionState === "connected") {
      connectionValue.textContent = "Connected";
      routeValue.textContent = await describeSelectedConnection(peer);
      setConnection("Connected", "Waiting for the sender to begin.");
    } else if (peer.connectionState === "disconnected" && !state.finished) {
      connectionValue.textContent = "Reconnecting";
      setConnection("Connection interrupted", "JamScan is waiting for WebRTC to recover.");
    } else if (peer.connectionState === "failed" && !state.finished) {
      fail("The peer connection failed. A TURN relay may be required on this network.");
    }
  });
  for (const pending of state.pendingSignals.splice(0)) {
    const response = await applySignal(peer, pending, "receiver");
    if (response) sendSignal(response);
  }
}

function configureChannel(channel) {
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.addEventListener("open", () => setConnection("Connected", "Waiting for file information."));
  channel.addEventListener("message", handleChannelMessage);
  channel.addEventListener("close", () => {
    if (!state.finished) fail("The data connection closed before the transfer completed.");
  });
}

async function handleChannelMessage(event) {
  if (typeof event.data === "string") {
    let control;
    try { control = JSON.parse(event.data); } catch { return; }
    if (control.type === "meta") return beginTransfer(control);
    if (control.type === "complete") return finishTransfer(control);
    return;
  }
  if (!state.meta || state.finished) return;
  const chunk = new Uint8Array(event.data);
  state.chunks.push(chunk);
  state.received += chunk.length;
  if (state.received > state.meta.packageSize) return fail("The sender transmitted more data than declared.");
  updateProgress();
}

function beginTransfer(meta) {
  if (meta.protocol !== 1) return fail("This sender uses an unsupported Quick Transfer protocol.");
  if (!Number.isSafeInteger(meta.packageSize) || meta.packageSize <= 0 || meta.packageSize > MAX_QUICK_FILE_SIZE + 5 * 1024 * 1024) {
    return fail("The incoming file size is invalid or exceeds this build's 256 MB limit.");
  }
  if (!Number.isSafeInteger(meta.originalSize) || meta.originalSize < 0 || meta.originalSize > MAX_QUICK_FILE_SIZE) {
    return fail("The declared original file size is invalid.");
  }
  if (typeof meta.name !== "string" || meta.name.length < 1 || meta.name.length > 180) {
    return fail("The incoming file name is invalid.");
  }
  state.meta = meta;
  state.chunks = [];
  state.received = 0;
  state.startedAt = performance.now();
  state.finished = false;
  nameValue.textContent = meta.name || "Incoming file";
  setConnection("Receiving file", `${formatBytes(meta.originalSize)} original, ${formatBytes(meta.packageSize)} transferred.`);
  updateProgress();
}

async function finishTransfer(control) {
  if (!state.meta || state.finished) return;
  if (control.packageSize !== state.meta.packageSize) return fail("The completion size does not match the transfer metadata.");
  try {
    setConnection("Verifying file", "Checking the JamScan package and SHA-256 hash.");
    const bytes = joinChunks(state.chunks, state.meta.packageSize);
    const parsed = await parsePackage(bytes);
    if (!parsed.hashOk) throw new Error("The received file failed its SHA-256 check.");
    state.finished = true;
    progress.style.width = "100%";
    etaValue.textContent = "Done";
    connectionValue.textContent = "Verified";
    heading.textContent = "Transfer complete";
    message.textContent = "Review the warning before opening or downloading the content.";
    previewHost.hidden = false;
    requestPreview(parsed, previewHost);
    state.channel?.send(JSON.stringify({ type: "received", packageSize: bytes.length, hashOk: true }));
  } catch (error) {
    state.channel?.send(JSON.stringify({ type: "error", message: error.message }));
    fail(error.message);
  }
}

function updateProgress() {
  if (!state.meta) return;
  const elapsed = Math.max(0.001, (performance.now() - state.startedAt) / 1000);
  const rate = state.received / elapsed;
  const total = state.meta.packageSize;
  receivedValue.textContent = `${formatBytes(state.received)} / ${formatBytes(total)}`;
  speedValue.textContent = formatSpeed(rate);
  etaValue.textContent = formatEta((total - state.received) / rate);
  progress.style.width = `${Math.min(100, state.received / total * 100)}%`;
}

function sendSignal(data) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "signal", data }));
}

function setConnection(title, detail) {
  heading.textContent = title;
  message.textContent = detail;
}

function fail(text) {
  if (state.finished) return;
  connectionValue.textContent = "Error";
  heading.textContent = "Transfer stopped";
  message.textContent = text;
  errorBox.textContent = text;
  errorBox.className = "status bad";
  errorBox.hidden = false;
}

function closeConnections() {
  state.finished = true;
  if (state.channel) state.channel.close();
  if (state.peer) state.peer.close();
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "leave" }));
  if (state.socket) state.socket.close();
}

window.addEventListener("beforeunload", closeConnections);
