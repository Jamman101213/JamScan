import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: {
    host: true,
    https: true,
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
