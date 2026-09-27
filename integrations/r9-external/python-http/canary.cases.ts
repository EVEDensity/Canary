export default [
  {
    id: "mock-agent-help",
    input: "help",
    assertions: [
      { type: "output.exists" },
      { type: "output.predicate", predicate: (output: any) => output?.response?.includes("Available commands") },
    ],
  },
];
