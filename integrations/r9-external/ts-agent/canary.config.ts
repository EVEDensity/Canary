export default {
  agent: { adapter: "http", entry: "http://127.0.0.1:4329/v1/chat", requestField: "message" },
  cases: "./canary.cases.ts",
  coverage: { include: ["src/**/*.ts"] },
  reporters: ["json", "markdown", "junit"],
  web: { enabled: false },
};
