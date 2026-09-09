/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the static build runs from GitHub Pages, any sub-folder, or a plain file server.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      // Three pages in one static build: the sixteen-scenario demo (index.html), the Hadarim ERP (hadarim.html) and the control report (report.html).
      input: { main: "index.html", hadarim: "hadarim.html", report: "report.html" },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
