export default async function run(input, context) {
  context.emit({ type: "tool.call", name: "get-sum", args: input });
  return context.tools.call("get-sum", input);
}
