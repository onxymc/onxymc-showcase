import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and no clearing of the Rust output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  worker: { format: "es" },
  build: {
    target: "chrome110",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
} as any);
