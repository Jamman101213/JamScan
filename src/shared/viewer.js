import { formatBytes, kindLabel } from "./package.js";

let objectUrl = null;

export function downloadBytes(bytes, name, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function requestPreview(parsed, host) {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.innerHTML = `
    <section>
      <h2>Check before opening</h2>
      <p class="muted">The sender can mislabel content. It could contain inappropriate media, scams, deceptive links, or an unsafe download.</p>
      <div class="summary">
        <div><span>Type</span><strong>${escapeHtml(kindLabel(parsed.metadata.kind))}</strong></div>
        <div><span>Name</span><strong>${escapeHtml(parsed.metadata.name)}</strong></div>
        <div><span>Size</span><strong>${formatBytes(parsed.payload.length)}</strong></div>
        <div><span>Integrity</span><strong>${parsed.hashOk ? "SHA-256 verified" : "Hash mismatch"}</strong></div>
      </div>
      <label style="display:flex;gap:9px;align-items:flex-start;line-height:1.45;font-size:.85rem">
        <input class="warning-check" type="checkbox" style="margin-top:3px">
        <span>I understand that JamScan does not guarantee this content is safe.</span>
      </label>
    </section>
    <section class="dialog-actions">
      <button class="button cancel" type="button">Cancel</button>
      <button class="button primary continue" type="button" disabled>Continue</button>
    </section>`;
  document.body.appendChild(dialog);
  const check = dialog.querySelector(".warning-check");
  const continueButton = dialog.querySelector(".continue");
  check.addEventListener("change", () => { continueButton.disabled = !check.checked; });
  dialog.querySelector(".cancel").addEventListener("click", () => dialog.close());
  continueButton.addEventListener("click", () => {
    dialog.close();
    renderPreview(parsed, host);
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

export function renderPreview(parsed, host) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  host.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = parsed.metadata.name;
  const info = document.createElement("p");
  info.className = "muted";
  info.textContent = `${kindLabel(parsed.metadata.kind)} | ${formatBytes(parsed.payload.length)} | ${parsed.hashOk ? "verified" : "hash mismatch"}`;
  const buttons = document.createElement("div");
  buttons.className = "button-row";
  const originalButton = document.createElement("button");
  originalButton.className = "button";
  originalButton.textContent = "Download original";
  originalButton.addEventListener("click", () => downloadBytes(parsed.payload, parsed.metadata.name, parsed.metadata.type));
  const packageButton = document.createElement("button");
  packageButton.className = "button";
  packageButton.textContent = "Save .jscan";
  packageButton.addEventListener("click", () => {
    const base = parsed.metadata.name.replace(/\.[^.]+$/, "") || "shared";
    downloadBytes(parsed.packageBytes, `${base}.jscan`, "application/x-jamscan");
  });
  buttons.append(originalButton, packageButton);
  const body = document.createElement("div");
  const blob = new Blob([parsed.payload], { type: parsed.metadata.type || "application/octet-stream" });
  objectUrl = URL.createObjectURL(blob);
  if (parsed.metadata.kind === "photo" || parsed.metadata.kind === "gif") {
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = parsed.metadata.name;
    body.appendChild(image);
  } else if (parsed.metadata.kind === "video") {
    const video = document.createElement("video");
    video.src = objectUrl;
    video.controls = true;
    video.playsInline = true;
    body.appendChild(video);
  } else if (parsed.metadata.kind === "audio") {
    const audio = document.createElement("audio");
    audio.src = objectUrl;
    audio.controls = true;
    body.appendChild(audio);
  } else if (parsed.metadata.kind === "text") {
    const pre = document.createElement("pre");
    const limit = 2 * 1024 * 1024;
    pre.textContent = new TextDecoder().decode(parsed.payload.subarray(0, limit)) + (parsed.payload.length > limit ? "\n\n[Preview truncated]" : "");
    body.appendChild(pre);
  } else {
    const note = document.createElement("div");
    note.className = "status";
    note.textContent = "Preview is disabled for this file type. Download it only if you trust the sender.";
    body.appendChild(note);
  }
  host.append(heading, info, buttons, body);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
