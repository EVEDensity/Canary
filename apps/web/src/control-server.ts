import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ControlPlane, ControlError, type Command } from "@canary/control-plane";
import { renderControlPage, controlScript, controlStyles } from "./control-ui.js";
import { redactValue } from "@canary/trace";

export function createControlServer(plane: ControlPlane, options: { port?: number; writeToken?: string } = {}) {
  if (options.writeToken !== undefined && options.writeToken.length < 32)
    throw new Error("CANARY_CONTROL_TOKEN must contain at least 32 characters");
  let origin = "";
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(redactValue(value)));
  };
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      if (!origin || req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin))
        throw new ControlError(403, "Untrusted Host or Origin");
      if (req.headers["sec-fetch-site"] === "cross-site") throw new ControlError(403, "Cross-site request refused");
      const url = new URL(req.url ?? "/", origin);
      if (url.search) throw new ControlError(400, "Query parameters are not accepted; never put credentials in URLs");
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderControlPage());
        return;
      }
      if (req.method === "GET" && url.pathname === "/control.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(controlScript);
        return;
      }
      if (req.method === "GET" && url.pathname === "/control.css") {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(controlStyles);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/control") {
        json(res, 200, { mode: options.writeToken ? "operator_available" : "read_only", snapshot: plane.snapshot() });
        return;
      }
      if (req.method === "POST" && ["/api/control/actions", "/api/control/session"].includes(url.pathname)) {
        const supplied = req.headers["x-canary-control-token"];
        if (
          !options.writeToken ||
          typeof supplied !== "string" ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(options.writeToken) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(options.writeToken))
        )
          throw new ControlError(403, "Operator credential required; this server may be read-only");
        if (url.pathname === "/api/control/session") {
          json(res, 200, { role: "operator" });
          return;
        }
        if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
          throw new ControlError(415, "application/json required");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const b = Buffer.from(chunk);
          size += b.length;
          if (size > 16_384) throw new ControlError(413, "Request exceeds 16 KiB");
          chunks.push(b);
        }
        let body: Command;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Command;
        } catch {
          throw new ControlError(400, "Invalid JSON");
        }
        json(res, 200, { audit: plane.execute(body, { role: "operator" }) });
        return;
      }
      json(res, 404, { error: "Route not found" });
    } catch (error) {
      json(res, error instanceof ControlError ? error.status : 409, {
        error: error instanceof Error ? error.message : "Operation failed",
      });
    }
  }
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return {
    server,
    listen: () =>
      new Promise<{ url: string; port: number }>((done, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("No listening address"));
            return;
          }
          origin = `http://127.0.0.1:${address.port}`;
          server.off("error", reject);
          done({ url: origin, port: address.port });
        });
      }),
  };
}
export function generateControlToken(): string {
  return randomBytes(32).toString("hex");
}
