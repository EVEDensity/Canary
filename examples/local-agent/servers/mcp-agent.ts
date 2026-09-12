import { runAgent } from "../src/agent.js";

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
      if (String(message.params?.name ?? "") !== "run") throw new Error(`Unknown MCP agent method: ${String(message.params?.name ?? "")}`);
      const result = await runAgent(message.params?.arguments);
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }));
});
