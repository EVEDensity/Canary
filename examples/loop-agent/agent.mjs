export default async (input, ctx) => {
  if (input === "ok" || (input && typeof input === "object" && input.mode === "ok")) {
    ctx.emit({ type: "tool.call", name: "lookup", args: { q: "ok" } });
    return { output: "ok" };
  }
  ctx.emit({ type: "tool.call", name: "lookup", args: { q: input } });
  ctx.emit({ type: "tool.call", name: "lookup", args: { q: input } });
  ctx.emit({ type: "loop_detected" });
  return { output: "stopped:loop" };
};
