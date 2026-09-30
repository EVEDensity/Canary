import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { maxWorkers: 2, testTimeout: 20_000 },
});
