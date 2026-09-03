import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    // Pins date/time formatting to a fixed timezone so tests are
    // deterministic regardless of the machine running them.
    env: { TZ: "UTC" },
  },
});
