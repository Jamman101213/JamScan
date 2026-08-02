(() => {
  "use strict";

  // Status message
  function setStatus(elementOrId, message, type = "") {
    const target = typeof elementOrId === "string" ? document.getElementById(elementOrId) : elementOrId;
    if (!target) return;

    target.textContent = message;
    target.className = `status-box${type ? ` ${type}` : ""}`;
  }

  // Small notification
  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2500);
  }

  // File download
  function downloadBytes(bytes, name, type = "application/octet-stream") {
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  // File drop area
  function bindDropZone(zone, input, handler) {
    if (!zone || !input) return;

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });

    ["dragenter", "dragover"].forEach(name => {
      zone.addEventListener(name, event => {
        event.preventDefault();
        zone.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach(name => {
      zone.addEventListener(name, event => {
        event.preventDefault();
        zone.classList.remove("dragging");
      });
    });

    zone.addEventListener("drop", event => {
      const file = event.dataTransfer.files[0];
      if (file) handler(file);
    });

    input.addEventListener("change", () => {
      const file = input.files[0];
      if (file) handler(file);
      input.value = "";
    });
  }

  // Mobile menu
  function setupMenu() {
    const button = document.getElementById("menuButton");
    const nav = document.getElementById("siteNav");
    if (!button || !nav) return;

    function closeMenu() {
      nav.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
      button.textContent = "Menu";
    }

    button.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "Close" : "Menu";
    });

    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu();
    });
  }

  // Device label
  function setupDeviceLabel() {
    const label = document.querySelector("[data-device-label]");
    if (!label || !window.JamScanDevice) return;

    const info = window.JamScanDevice;
    const type = info.type === "vr" ? "VR" : info.type.charAt(0).toUpperCase() + info.type.slice(1);
    const layout = info.layout === "mobile" ? "mobile layout" : "desktop layout";
    label.textContent = `${type} - ${layout}`;
  }

  // Reduced motion default
  function applyMotionPreference() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.dataset.reducedMotion = "true";
    }
  }

  window.JamScanUI = {
    setStatus,
    showToast,
    downloadBytes,
    bindDropZone
  };

  document.addEventListener("DOMContentLoaded", () => {
    setupMenu();
    applyMotionPreference();
    setTimeout(setupDeviceLabel, 0);
  });
})();
