import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);

createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    try {
      const payload = JSON.parse(body || "{}") as { input?: unknown };
      const input = payload.input;
      const goal = input && typeof input === "object" && !Array.isArray(input)
        ? String((input as { goal?: unknown }).goal ?? (input as { value?: unknown }).value ?? "")
        : String(input ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output: `http:${goal}`, remote: true }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}).listen(port, "127.0.0.1");
