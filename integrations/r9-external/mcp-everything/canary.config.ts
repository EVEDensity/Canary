export default {
  agent: { adapter: "function", entry: "./canary-agent.mjs" },
  cases: "./canary.cases.ts",
  coverage: { include: ["canary-agent.mjs"] },
  tools: { adapter: "mcp-stdio", command: "node", args: ["./dist/index.js", "stdio"] },
  reporters: ["json", "markdown", "junit"],
  runtime: { timeoutMs: 10000 },
  web: { enabled: false },
};
