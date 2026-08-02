(() => {
  "use strict";

  // Demo animation
  function startDemo() {
    const canvas = document.getElementById("demoCanvas");
    const frameLabel = document.getElementById("demoFrame");
    if (!canvas || !frameLabel) return;

    const context = canvas.getContext("2d");
    let frame = 0;

    // Random number generator
    function randomFor(seed) {
      let value = seed || 1;
      return () => {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        return (value >>> 0) / 4294967296;
      };
    }

    // Demo mosaic
    function drawMosaic(seed) {
      const random = randomFor(seed);
      const grid = 80;
      const margin = 8;
      const cell = canvas.width / grid;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let y = margin; y < grid - margin; y += 1) {
        for (let x = margin; x < grid - margin; x += 1) {
          if (random() <= 0.5) continue;
          context.fillStyle = "#171714";
          context.fillRect(
            Math.floor(x * cell),
            Math.floor(y * cell),
            Math.ceil(cell),
            Math.ceil(cell)
          );
        }
      }

      const marker = 6;
      const markerPositions = [
        [0, 0],
        [grid - marker, 0],
        [grid - marker, grid - marker],
        [0, grid - marker]
      ];

      for (const [left, top] of markerPositions) {
        for (let y = 0; y < marker; y += 1) {
          for (let x = 0; x < marker; x += 1) {
            const on = x < 2 || y < 2 || x >= marker - 2 || y >= marker - 2 || (x >= 2 && x <= 3 && y >= 2 && y <= 3);
            if (!on) continue;
            context.fillStyle = "#171714";
            context.fillRect(
              Math.floor((left + x) * cell),
              Math.floor((top + y) * cell),
              Math.ceil(cell),
              Math.ceil(cell)
            );
          }
        }
      }
    }

    setInterval(() => {
      frame += 1;
      drawMosaic(frame * 727 + 11);
      frameLabel.textContent = `Flash ${String(frame).padStart(4, "0")} - 64 tiles`;
    }, 75);
  }

  document.addEventListener("DOMContentLoaded", startDemo);
})();
