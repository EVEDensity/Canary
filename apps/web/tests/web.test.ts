import { describe, expect, it } from "vitest";
import { request } from "node:http";
import { createWebServer, RunStore } from "../src/index.js";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => { request(url, (response) => { let body = ""; response.setEncoding("utf8"); response.on("data", (part) => body += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body })); }).on("error", reject).end(); });
}

describe("web run store and HTTP/SSE", () => {
  it("serves run JSON and sends an SSE snapshot", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_test"); const web = createWebServer(store); const listening = await web.listen();
    try {
      const response = await get(`${listening.url}/api/runs/${run.runId}`);
      expect(response.status).toBe(200); expect(JSON.parse(response.body).runId).toBe(run.runId);
      await new Promise<void>((resolvePromise, reject) => { const req = request(`${listening.url}/api/runs/${run.runId}/events`); req.on("response", (res) => { let data = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { data += chunk; if (data.includes("event: run.snapshot")) { req.destroy(); resolvePromise(); } }); }); req.on("error", reject); req.end(); });
    } finally { await new Promise<void>((resolvePromise) => web.server.close(() => resolvePromise())); }
  });
});
