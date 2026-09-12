import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { demoTools } from "../src/tools.js";

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const payload = JSON.parse((await readBody(request)) || "{}") as { id?: number; params?: { name?: string; arguments?: unknown } };
  const name = String(payload.params?.name ?? "");
  const tool = demoTools[name];
  const id = payload.id ?? 1;
  const body = !tool
    ? { jsonrpc: "2.0", id, error: { message: `Unknown tool: ${name}` } }
    : { jsonrpc: "2.0", id, result: await tool(payload.params?.arguments) };
  const accept = request.headers.accept ?? "";
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const port = Number(process.env.PORT ?? 8788);
createServer((request, response) => {
  void handle(request, response).catch((error) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", error: { message: error instanceof Error ? error.message : String(error) } }));
  });
}).listen(port, "127.0.0.1");
