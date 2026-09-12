import { demoTools } from "../src/tools.js";

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  void Promise.all(lines.map(async (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as { id: number; params?: { name?: string; arguments?: unknown } };
    try {
      const name = String(message.params?.name ?? "");
      const tool = demoTools[name];
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      const result = await tool(message.params?.arguments);
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }));
});
