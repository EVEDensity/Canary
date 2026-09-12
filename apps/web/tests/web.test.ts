import { describe, expect, it } from "vitest";
import { request } from "node:http";
import { createWebServer, RunStore } from "../src/index.js";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, (response) => { let body = ""; response.setEncoding("utf8"); response.on("data", (part) => body += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body })); });
    req.on("error", reject); req.end();
  });
}
function close(server: ReturnType<typeof createWebServer>["server"]): Promise<void> { return new Promise((resolvePromise) => server.close(() => resolvePromise())); }

describe("web run store and HTTP/SSE", () => {
  it("serves coverage through HTTP and renders a coverage-capable page", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_coverage");
    store.setCoverage(run.runId, { runId: run.runId, sourceHash: "hash", status: "final", lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 1, total: 2, pct: 50 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 2, pct: 0 }, featureChains: [] });
    const web = createWebServer(store); const listening = await web.listen();
    try {
      const coverage = await get(`${listening.url}/api/runs/${run.runId}/coverage`);
      expect(coverage.status).toBe(200); expect(JSON.parse(coverage.body).lines.pct).toBe(50);
      expect(JSON.parse(coverage.body).featureChains).toEqual([]);
      const page = await get(`${listening.url}/?runId=${run.runId}`);
      expect(page.body).toContain("Coverage"); expect(page.body).toContain("coverage.updated");
    } finally { await close(web.server); }
  });
  it("releases an SSE connection after client close", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_sse"); const web = createWebServer(store); const listening = await web.listen();
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/events`);
        req.on("response", (res) => { let data = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { data += chunk; if (data.includes("event: run.snapshot")) { res.destroy(); resolvePromise(); } }); });
        req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
        req.end();
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      expect((store as unknown as { subscribers: Map<string, Set<unknown>> }).subscribers.get(run.runId)?.size ?? 0).toBe(0);
    } finally { await close(web.server); }
  });
});

