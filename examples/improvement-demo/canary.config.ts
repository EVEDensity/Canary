export default {
  agent: { adapter: "function", entry: "./broken-agent.mjs" },
  cases: "./cases.ts",
  coverage: { include: ["broken-agent.mjs", "fixed-agent.mjs"], exclude: [] },
  reporters: ["json", "markdown", "junit"],
  web: { enabled: true, host: "127.0.0.1", open: false },
};
