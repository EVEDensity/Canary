import { defineConfig } from "vitest/config";

export default defineConfig({
  // Both suites build real TypeScript programs and spawn Git; serialize file workers.
  // Keep the default timeout and every assertion unchanged.
  test: { maxWorkers: 1 },
});
