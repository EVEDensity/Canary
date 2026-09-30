import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const options = { port: 4320, base: "/" };
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  if (flag === "--port") options.port = Number(args[++index]);
  else if (flag === "--base") options.base = args[++index];
  else throw new Error(`Unknown option: ${flag}. Use --port <number> or --base /Canary/.`);
}
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  throw new Error("Port must be an integer between 1 and 65535.");
}
if (typeof options.base !== "string" || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(options.base)) {
  throw new Error("Base must be a path such as / or /Canary/ with a trailing slash.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
await stat(join(root, "index.html")).catch(() => {
  throw new Error("Build the website first with pnpm site:build.");
});
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const send = (response, status, message) => {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, 405, "Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch {
    send(response, 400, "Invalid path");
    return;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) {
    send(response, 400, "Invalid path");
    return;
  }
  if (options.base !== "/" && pathname === options.base.slice(0, -1)) {
    response.writeHead(308, { Location: options.base });
    response.end();
    return;
  }
  if (!pathname.startsWith(options.base)) {
    send(response, 404, "Not found");
    return;
  }
  const requested = pathname.slice(options.base.length) || "index.html";
  const file = resolve(root, requested);
  const withinRoot = relative(root, file);
  if (withinRoot === ".." || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
    send(response, 403, "Forbidden");
    return;
  }
  try {
    const details = await stat(file);
    if (!details.isFile()) {
      send(response, 404, "Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": details.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else await pipeline(createReadStream(file), response);
  } catch (error) {
    if (!response.headersSent) {
      send(
        response,
        error.code === "ENOENT" ? 404 : 500,
        error.code === "ENOENT" ? "Not found" : "Unable to read file",
      );
    } else response.destroy();
  }
});
server.on("error", (error) => {
  console.error(`Unable to start website preview: ${error.message}`);
  process.exitCode = 1;
});
server.listen(options.port, "127.0.0.1", () => {
  console.log(`Canary website: http://127.0.0.1:${options.port}${options.base}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close());
}
