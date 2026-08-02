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
        send: resolve(process.cwd(), "send/index.html"),
        receive: resolve(process.cwd(), "receive/index.html"),
        open: resolve(process.cwd(), "open/index.html"),
      },
    },
  },
});
