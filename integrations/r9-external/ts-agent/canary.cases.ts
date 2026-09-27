export default [
  {
    id: "calculator-tool-result",
    input: "calc: (2 + 3) * 4 ^ 2",
    assertions: [
      { type: "output.exists" },
      { type: "output.predicate", predicate: (output: any) => output?.answer?.includes("= 80") && output?.toolCalls?.some((call: any) => call.name === "calculator" && call.ok === true) },
    ],
  },
];
