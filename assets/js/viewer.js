(() => {
  "use strict";

  // Viewer state
  const state = {
    pending: null,
    objectURL: null
  };

  const core = window.JamScanCore;
  const ui = window.JamScanUI;

  // Close old preview
  function revokePreviewURL() {
    if (!state.objectURL) return;
    URL.revokeObjectURL(state.objectURL);
    state.objectURL = null;
  }

  // Warning screen
  function showWarning(parsed, hostId) {
    state.pending = { parsed, hostId };

    const kind = parsed.meta.kind || core.classify(parsed.meta.type, parsed.meta.name);
    document.getElementById("warningKind").textContent = core.kindLabel(kind);
    document.getElementById("warningName").textContent = parsed.meta.name || "Unnamed";
    document.getElementById("warningSize").textContent = core.formatBytes(parsed.payload.length);
    document.getElementById("warningIntegrity").textContent = parsed.hashOK ? "SHA-256 verified" : "Hash mismatch";
    document.getElementById("warningSubtitle").textContent = `This item claims to be ${core.kindLabel(kind).toLowerCase()}. Its label may be misleading.`;
    document.getElementById("warningCheck").checked = false;
    document.getElementById("warningOpen").disabled = true;
    document.getElementById("warningDialog").showModal();
  }

  // Content preview
  function renderPreview(parsed, hostId) {
    revokePreviewURL();

    const host = document.getElementById(hostId);
    if (!host) return;

    host.innerHTML = "";

    const shell = document.createElement("article");
    shell.className = "preview-shell";

    const heading = document.createElement("div");
    heading.className = "preview-heading";

    const text = document.createElement("div");
    const title = document.createElement("h3");
    const details = document.createElement("p");
    const download = document.createElement("button");

    const kind = parsed.meta.kind || core.classify(parsed.meta.type, parsed.meta.name);

    title.textContent = parsed.meta.name;
    details.textContent = `${core.kindLabel(kind)} - ${core.formatBytes(parsed.payload.length)} - ${parsed.hashOK ? "integrity verified" : "integrity warning"}`;
    download.className = "button";
    download.type = "button";
    download.textContent = "Download original";
    download.addEventListener("click", () => {
      ui.downloadBytes(parsed.payload, parsed.meta.name, parsed.meta.type);
    });

    text.append(title, details);
    heading.append(text, download);

    const area = document.createElement("div");
    area.className = "preview-area";

    const blob = new Blob([parsed.payload], {
      type: parsed.meta.type || "application/octet-stream"
    });
    const url = URL.createObjectURL(blob);
    state.objectURL = url;

    if (kind === "photo" || kind === "gif") {
      const image = document.createElement("img");
      image.src = url;
      image.alt = parsed.meta.name;
      area.appendChild(image);
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      area.appendChild(video);
    } else if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      audio.preload = "metadata";
      area.appendChild(audio);
    } else if (kind === "text") {
      const preview = document.createElement("pre");
      const limit = 2 * 1024 * 1024;
      preview.textContent = core.textDecoder.decode(parsed.payload.slice(0, limit));
      if (parsed.payload.length > limit) preview.textContent += "\n\n[Preview stopped after 2 MB]";
      area.appendChild(preview);
    } else {
      const box = document.createElement("div");
      box.className = "file-preview";

      const fileTitle = document.createElement("h3");
      const fileText = document.createElement("p");
      fileTitle.textContent = "Preview disabled for this file type";
      fileText.textContent = "JamScan will not execute apps, scripts, archives, HTML, or unknown content. Download only when you trust the sender.";

      box.append(fileTitle, fileText);
      area.appendChild(box);
    }

    shell.append(heading, area);
    host.appendChild(shell);
    shell.setAttribute("tabindex", "-1");
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    shell.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    shell.focus({ preventScroll: true });
  }

  // Dialog events
  function startViewer() {
    const dialog = document.getElementById("warningDialog");
    const check = document.getElementById("warningCheck");
    const openButton = document.getElementById("warningOpen");
    const cancelButton = document.getElementById("warningCancel");

    if (!dialog || !check || !openButton || !cancelButton) return;

    check.addEventListener("change", () => {
      openButton.disabled = !check.checked;
    });

    cancelButton.addEventListener("click", () => {
      dialog.close();
      state.pending = null;
    });

    openButton.addEventListener("click", () => {
      if (!check.checked || !state.pending) return;

      const { parsed, hostId } = state.pending;
      dialog.close();
      state.pending = null;
      renderPreview(parsed, hostId);
    });

    dialog.addEventListener("cancel", () => {
      state.pending = null;
    });

    window.addEventListener("beforeunload", revokePreviewURL);
  }

  window.JamScanViewer = {
    showWarning,
    renderPreview
  };

  document.addEventListener("DOMContentLoaded", startViewer);
})();
