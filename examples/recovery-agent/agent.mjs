export default async (input, ctx) => {
  ctx.emit({ type: "error", tool: "lookup" });
  ctx.emit({ type: "recovery" });
  ctx.emit({ type: "tool.call", name: "lookup", args: { q: input } });
  return { output: `recovered:${input}` };
};
