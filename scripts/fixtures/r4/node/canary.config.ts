export default {
  kind: "canary.project", version: 1,
  checks: [{ id: "node.tests", type: "command", command: "node", args: ["--test", "math.test.mjs"] }],
};
