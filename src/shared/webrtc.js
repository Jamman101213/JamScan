export function signalUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/signal`;
}

export function randomToken(byteLength = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createPeer(iceServers, sendSignal) {
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) sendSignal({ candidate: event.candidate });
  });
  return peer;
}

export async function applySignal(peer, data, role) {
  peer.__jamscanCandidates ||= [];
  if (data.description) {
    await peer.setRemoteDescription(data.description);
    for (const candidate of peer.__jamscanCandidates.splice(0)) await peer.addIceCandidate(candidate);
    if (data.description.type === "offer" && role === "receiver") {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      return { description: peer.localDescription };
    }
  } else if (data.candidate) {
    if (!peer.remoteDescription) peer.__jamscanCandidates.push(data.candidate);
    else await peer.addIceCandidate(data.candidate);
  }
  return null;
}

export async function describeSelectedConnection(peer) {
  try {
    const stats = await peer.getStats();
    let selectedPair = null;
    stats.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) selectedPair = stats.get(report.selectedCandidatePairId);
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) selectedPair ||= report;
    });
    if (!selectedPair) return "Peer-to-peer";
    const local = stats.get(selectedPair.localCandidateId);
    const remote = stats.get(selectedPair.remoteCandidateId);
    if (local?.candidateType === "relay" || remote?.candidateType === "relay") return "TURN relay";
    if (local?.candidateType === "host" && remote?.candidateType === "host") return "Direct local network";
    return "Direct peer-to-peer";
  } catch {
    return "Peer-to-peer";
  }
}

export function waitForBuffer(channel, highWater, lowWater) {
  if (channel.bufferedAmount <= highWater) return Promise.resolve();
  channel.bufferedAmountLowThreshold = lowWater;
  return new Promise((resolve, reject) => {
    const onLow = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error("The connection closed during transfer.")); };
    const cleanup = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
    };
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
    if (channel.bufferedAmount <= lowWater) {
      cleanup();
      resolve();
    }
  });
}
