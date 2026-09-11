import { defineConfig } from "./packages/core/src/index.js";

export default defineConfig({
  agent: { adapter: "function", entry: "./examples/local-agent/src/agent.ts", export: "runAgent" },
  cases: "./examples/local-agent/cases/**/*.ts",
  coverage: { include: ["examples/local-agent/src/**/*.ts"], exclude: ["**/*.test.ts"], lines: 80, branches: 70, functions: 75 },
  web: { enabled: true, host: "127.0.0.1", open: false }
});
