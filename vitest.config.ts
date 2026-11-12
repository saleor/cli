import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/**/*.live.test.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
