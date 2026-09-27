import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { maxWorkers: 2, minWorkers: 1, testTimeout: 20_000 },
});
