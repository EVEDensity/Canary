export default async (input, ctx) => {
  const name = input.tool;
  ctx.emit({ type: "tool.call", name, args: { value: input.value } });
  const result = await ctx.tools.call(name, { value: input.value });
  ctx.state.set("answer", result.answer);
  return result;
};
