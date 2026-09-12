import { defineConfig } from "./packages/core/src/index.js";

export default defineConfig({
  agent: { adapter: "function", entry: "./examples/local-agent/src/agent.ts", export: "runAgent" },
  cases: "./examples/local-agent/cases/**/*.ts",
  coverage: { include: ["examples/local-agent/src/**/*.ts"], exclude: ["**/*.test.ts"], lines: 80, branches: 70, functions: 75 },
  features: [
    { id: "planning", name: "Planning", files: ["examples/local-agent/src/agent.ts"] },
    { id: "tool-routing", name: "Tool routing", files: ["examples/local-agent/src/agent.ts", "examples/local-agent/src/tools.ts"] },
    { id: "error-recovery", name: "Error recovery", files: ["examples/local-agent/src/agent.ts", "examples/local-agent/src/tools.ts"] },
    { id: "termination", name: "Termination", files: ["examples/local-agent/src/agent.ts"] },
  ],
  reporters: ["json", "markdown", "junit"],
  web: { enabled: true, host: "127.0.0.1", open: false },
});
