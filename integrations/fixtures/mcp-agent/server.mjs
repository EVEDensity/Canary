process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    try {
      if (String(message.params?.name ?? "") !== "run") throw new Error(`Unknown MCP agent method: ${String(message.params?.name ?? "")}`);
      const input = message.params?.arguments;
      const goal = input && typeof input === "object" && !Array.isArray(input)
        ? String(input.goal ?? input.value ?? "")
        : String(input ?? "");
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { output: `mcp:${goal}`, adapter: "mcp" } })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }
});
