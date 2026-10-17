export default [
  {
    dataset: { version: "canary-fixed-v1", split: "regression", contentHash: "canary-fixed-contract-v1" },
    input: { value: "sample-1", tool: "lookup" },
    id: "case-1",
    assertions: [
      { type: "tool.called", name: "lookup", id: "actual-route" },
      { key: "answer", type: "state.equals", value: "lookup:sample-1", id: "task-result" },
    ],
  },
  {
    dataset: { version: "canary-fixed-v1", split: "eval", contentHash: "canary-fixed-contract-v1" },
    input: { value: "sample-2", tool: "echo" },
    id: "case-2",
    assertions: [
      { type: "tool.called", name: "echo", id: "actual-route" },
      { key: "answer", type: "state.equals", value: "echo:sample-2", id: "task-result" },
    ],
  },
  {
    dataset: { version: "canary-fixed-v1", split: "eval", contentHash: "canary-fixed-contract-v1" },
    input: { value: "sample-3", tool: "echo" },
    id: "case-3",
    assertions: [
      { type: "tool.called", name: "echo", id: "actual-route" },
      { key: "answer", type: "state.equals", value: "echo:sample-3", id: "task-result" },
    ],
  },
  {
    dataset: { version: "canary-fixed-v1", split: "eval", contentHash: "canary-fixed-contract-v1" },
    input: { value: "sample-4", tool: "echo" },
    id: "case-4",
    assertions: [
      { type: "tool.called", name: "echo", id: "actual-route" },
      { key: "answer", type: "state.equals", value: "echo:sample-4", id: "task-result" },
    ],
  },
  {
    dataset: { version: "canary-fixed-v1", split: "holdout", contentHash: "canary-fixed-contract-v1" },
    input: { value: "sample-5", tool: "echo" },
    id: "case-5",
    assertions: [
      { type: "tool.called", name: "echo", id: "actual-route" },
      { key: "answer", type: "state.equals", value: "echo:sample-5", id: "task-result" },
    ],
  },
  {
    dataset: { version: "canary-fixed-v1", split: "holdout", contentHash: "canary-fixed-contract-v1" },
    input: { value: "sample-6", tool: "echo" },
    id: "case-6",
    assertions: [
      { type: "tool.called", name: "echo", id: "actual-route" },
      { key: "answer", type: "state.equals", value: "echo:sample-6", id: "task-result" },
    ],
  },
];
