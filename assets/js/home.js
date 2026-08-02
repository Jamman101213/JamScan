(() => {
  "use strict";

  // Demo animation
  function startDemo() {
    const canvas = document.getElementById("demoCanvas");
    const frameLabel = document.getElementById("demoFrame");
    if (!canvas || !frameLabel) return;

    const context = canvas.getContext("2d");
    const grid = 32;
    const cell = canvas.width / grid;
    let frame = 0;

    function randomFor(seed) {
      let value = seed || 1;
      return () => {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        return (value >>> 0) / 4294967296;
      };
    }

    setInterval(() => {
      frame += 1;
      const random = randomFor(frame * 727 + 91);

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let y = 0; y < grid; y += 1) {
        for (let x = 0; x < grid; x += 1) {
          let on = random() > 0.5;
          const corner =
            (x < 5 && y < 5) ||
            (x >= grid - 5 && y < 5) ||
            (x < 5 && y >= grid - 5) ||
            (x >= grid - 5 && y >= grid - 5);

          if (corner) {
            const localX = x < 5 ? x : x - (grid - 5);
            const localY = y < 5 ? y : y - (grid - 5);
            on =
              localX === 0 ||
              localY === 0 ||
              localX === 4 ||
              localY === 4 ||
              (localX >= 2 && localX <= 3 && localY >= 2 && localY <= 3);
          }

          context.fillStyle = on ? "#171714" : "#ffffff";
          context.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }

      frameLabel.textContent = `Frame ${String(frame).padStart(4, "0")}`;
    }, 75);
  }

  document.addEventListener("DOMContentLoaded", startDemo);
})();
