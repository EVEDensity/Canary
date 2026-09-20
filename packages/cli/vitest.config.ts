import { defineConfig } from "vitest/config";

export default defineConfig({
  // Each integration file starts real CLI processes. Keep their combined CPU load
  // bounded while a report server and workspace checks share the same machine.
  test: { maxWorkers: 2, minWorkers: 1 },
});
