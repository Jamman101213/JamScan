(() => {
  "use strict";

  // Static sample
  function drawSample() {
    const canvas = document.getElementById("demoCanvas");
    if (!canvas) return;

    const context = canvas.getContext("2d");
    const grid = 34;
    const cell = canvas.width / grid;
    let seed = 0x4a534341;

    function random() {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const border = x === 1 || y === 1 || x === grid - 2 || y === grid - 2;
        const data = x > 3 && y > 3 && x < grid - 4 && y < grid - 4;
        const on = border || (data && random() > 0.5);

        context.fillStyle = on ? "#071014" : "#ffffff";
        context.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  document.addEventListener("DOMContentLoaded", drawSample);
})();
