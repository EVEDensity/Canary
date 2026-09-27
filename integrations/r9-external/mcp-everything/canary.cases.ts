export default [
  {
    id: "get-sum",
    input: { a: 2, b: 3 },
    assertions: [
      { type: "output.exists" },
      { type: "output.predicate", predicate: (output: any) => output?.content?.some((block: any) => block.type === "text" && block.text?.includes("is 5")) },
    ],
  },
];
