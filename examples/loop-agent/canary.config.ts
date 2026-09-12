import { defineConfig } from "../../packages/core/src/index.js";

export default defineConfig({
  agent: { adapter: "function", entry: "./agent.mjs" },
  cases: "./cases.ts",
  coverage: { include: ["agent.mjs"] },
  reporters: ["json", "markdown", "junit"],
  web: { enabled: true, host: "127.0.0.1", open: false },
});
