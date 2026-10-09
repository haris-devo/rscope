import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Served from https://haris-devo.github.io/rscope/
  base: "/rscope/",
  plugins: [react()],
  resolve: {
    // The site runs the same analyzer as the CLI, straight from source.
    alias: { rscope: fileURLToPath(new URL("../src/core/index.ts", import.meta.url)) },
  },
  server: { fs: { allow: [".."] } },
});
