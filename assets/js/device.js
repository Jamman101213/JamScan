(() => {
  "use strict";

  // Device check
  function getDeviceInfo() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "Unknown";
    const touchPoints = navigator.maxTouchPoints || 0;

    const isVR = /OculusBrowser|Meta Quest|Quest|PICO|PicoBrowser|VR Browser/i.test(ua);
    const isPhone = /iPhone|iPod|Windows Phone|Android.*Mobile|Mobile Safari/i.test(ua);
    const isTablet = /iPad|Tablet|Silk|Android(?!.*Mobile)/i.test(ua) || (platform === "MacIntel" && touchPoints > 1);
    const isDesktop = /Windows NT|Macintosh|Mac OS X|X11|Linux x86_64|CrOS/i.test(ua);
    const isBlocked = /SmartTV|SMART-TV|Tizen|Web0S|WebOS|PlayStation|Xbox|Nintendo|Chromecast|CrKey|AppleTV|GoogleTV|bot|crawler|spider/i.test(ua);

    let type = "unsupported";
    let layout = "unsupported";

    if (isBlocked) {
      type = "unsupported";
    } else if (isVR) {
      type = "vr";
      layout = "desktop";
    } else if (isPhone) {
      type = "phone";
      layout = "mobile";
    } else if (isTablet) {
      type = "tablet";
      layout = "mobile";
    } else if (isDesktop) {
      type = "desktop";
      layout = "desktop";
    }

    return { ua, platform, touchPoints, type, layout };
  }

  // Browser check
  function getMissingFeatures() {
    const missing = [];

    if (typeof Promise === "undefined") missing.push("Promise");
    if (typeof Uint8Array === "undefined") missing.push("Uint8Array");
    if (typeof Blob === "undefined") missing.push("Blob");
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") missing.push("Object URLs");
    if (!window.crypto || !window.crypto.subtle || typeof window.crypto.getRandomValues !== "function") missing.push("Web Crypto");
    if (!document.createElement("canvas").getContext) missing.push("Canvas");

    return missing;
  }

  // Error screen
  function showDeviceError(code, title, message, info, missing = []) {
    document.body.classList.add("device-blocked");

    const screen = document.createElement("main");
    screen.className = "device-error";
    screen.innerHTML = `
      <section class="device-error-card">
        <div class="device-error-mark">!</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="error-code">${code}</div>
        <div class="device-details">
          Type: ${info.type}<br>
          Platform: ${info.platform}<br>
          Screen: ${window.screen.width} x ${window.screen.height}<br>
          Touch points: ${info.touchPoints}<br>
          Missing: ${missing.length ? missing.join(", ") : "None"}<br>
          User agent: ${info.ua}
        </div>
      </section>`;

    document.body.prepend(screen);
  }

  // Apply layout
  function applyDeviceMode() {
    const info = getDeviceInfo();
    const missing = getMissingFeatures();

    window.JamScanDevice = info;
    document.documentElement.dataset.device = info.type;
    document.documentElement.dataset.layout = info.layout;

    if (info.layout === "mobile") {
      document.body.classList.add("device-mobile");
    }

    if (info.layout === "desktop") {
      document.body.classList.add("device-desktop");
    }

    if (info.type === "unsupported") {
      showDeviceError(
        "JSCAN-DEVICE-001",
        "Unsupported device",
        "JamScan supports phones, tablets, desktop computers, and supported VR browsers. This device type is not supported.",
        info
      );
      return;
    }

    if (missing.length) {
      showDeviceError(
        "JSCAN-CAPABILITY-002",
        "Browser update required",
        "This browser is missing features JamScan needs. Update the browser or use a modern Chrome, Edge, Firefox, or Safari version.",
        info,
        missing
      );
    }
  }

  document.addEventListener("DOMContentLoaded", applyDeviceMode, { once: true });
})();
