export default {
  agent: { adapter: "http", entry: "http://127.0.0.1:4330/api/chat", requestField: "message" },
  cases: "./canary.cases.ts",
  coverage: { include: ["app/**/*.py"] },
  reporters: ["json", "markdown", "junit"],
  web: { enabled: false },
};
