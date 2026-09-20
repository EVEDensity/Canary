export default {
  kind: "canary.project", version: 1,
  checks: [{ id: "python.tests", type: "command", command: "python", args: ["-B", "-m", "unittest", "discover", "-s", "tests", "-v"] }],
};
