import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ControlPlane, ControlError, type Command } from "@canary/control-plane";
import { renderControlPage, controlScript, controlStyles } from "./control-ui.js";

export function createControlServer(plane: ControlPlane, options: { port?: number; writeToken?: string } = {}) {
  if (options.writeToken !== undefined && options.writeToken.length < 32)
    throw new Error("CANARY_CONTROL_TOKEN must contain at least 32 characters");
  let origin = "";
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
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
        json(res, 200, { mode