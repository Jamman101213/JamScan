import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(process.cwd(), "index.html"),
        quickSend: resolve(process.cwd(), "quick/send/index.html"),
        quickReceive: resolve(process.cwd(), "quick/receive/index.html"),
        shortReceive: resolve(process.cwd(), "q/index.html"),
        opticalSend: resolve(process.cwd(), "send/index.html"),
        opticalReceive: resolve(process.cwd(), "receive/index.html"),
        open: resolve(process.cwd(), "open/index.html"),
      },
    },
  },
});
