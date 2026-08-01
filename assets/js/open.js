(() => {
  "use strict";

  const core = window.JamScanCore;
  const ui = window.JamScanUI;
  const viewer = window.JamScanViewer;

  // Open file
  async function openFile(file) {
    if (!file.name.toLowerCase().endsWith(".jscan")) {
      throw new Error("Choose a file ending in .jscan.");
    }

    ui.setStatus("openStatus", "Reading and verifying package.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await core.parsePackage(bytes);

    ui.setStatus(
      "openStatus",
      `${parsed.meta.name} - ${core.kindLabel(parsed.meta.kind)} - ${core.formatBytes(parsed.payload.length)} - ${parsed.hashOK ? "verified" : "hash mismatch"}`,
      parsed.hashOK ? "good" : "bad"
    );

    viewer.showWarning(parsed, "openPreviewHost");
  }

  // Page events
  function startPage() {
    const drop = document.getElementById("jscanDrop");
    const input = document.getElementById("jscanInput");

    ui.bindDropZone(drop, input, file => {
      openFile(file).catch(error => {
        ui.setStatus("openStatus", error.message, "bad");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", startPage);
})();
