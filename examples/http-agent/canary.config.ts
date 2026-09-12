import { defineConfig } from "../../packages/core/src/index.js";

export default defineConfig({
  agent: { adapter: "http", entry: process.env.CANARY_HTTP_AGENT_URL ?? "http://127.0.0.1:8787/agent" },
  cases: "./cases.ts",
  coverage: { include: ["server.mjs"] },
  reporters: ["json", "markdown", "junit"],
  web: { enabled: true, host: "127.0.0.1", open: false },
});
