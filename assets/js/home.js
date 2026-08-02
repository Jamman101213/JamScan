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

    // Demo code
    function drawCode(left, top, size, seed) {
      const random = randomFor(seed);
      const grid = 24;
      const cell = size / grid;

      context.fillStyle = "#ffffff";
      context.fillRect(left, top, size, size);

      for (let y = 0; y < grid; y += 1) {
        for (let x = 0; x < grid; x += 1) {
          let on = random() > 0.5;
          const corner =
            (x < 4 && y < 4) ||
            (x >= grid - 4 && y < 4) ||
            (x < 4 && y >= grid - 4) ||
            (x >= grid - 4 && y >= grid - 4);

          if (corner) {
            const localX = x < 4 ? x : x - (grid - 4);
            const localY = y < 4 ? y : y - (grid - 4);
            on = localX === 0 || localY === 0 || localX === 3 || localY === 3 || (localX === 2 && localY === 2);
          }

          if (!on) continue;
          context.fillStyle = "#171714";
          context.fillRect(
            left + Math.floor(x * cell),
            top + Math.floor(y * cell),
            Math.ceil(cell),
            Math.ceil(cell)
          );
        }
      }
    }

    setInterval(() => {
      frame += 1;
      const gap = 18;
      const size = Math.floor((canvas.width - gap * 3) / 2);

      context.fillStyle = "#e9e7e1";
      context.fillRect(0, 0, canvas.width, canvas.height);

      drawCode(gap, gap, size, frame * 727 + 11);
      drawCode(gap * 2 + size, gap, size, frame * 727 + 23);
      drawCode(gap, gap * 2 + size, size, frame * 727 + 37);
      drawCode(gap * 2 + size, gap * 2 + size, size, frame * 727 + 51);

      frameLabel.textContent = `Flash ${String(frame).padStart(4, "0")} - 4 codes`;
    }, 75);
  }

  document.addEventListener("DOMContentLoaded", startDemo);
})();
