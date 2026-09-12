import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createWebServer, FileArtifactRepository, RunStore } from "../src/index.js";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, (response) => { let body = ""; response.setEncoding("utf8"); response.on("data", (part) => body += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body })); });
    req.on("error", reject); req.end();
  });
}
function close(server: ReturnType<typeof createWebServer>["server"]): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}
function coverage(runId: string, status: "provisional" | "final" = "final", covered = 1) {
  return { runId, sourceHash: "hash", status, lines: { covered, total: 2, pct: covered === 2 ? 100 : 50 }, statements: { covered, total: 2, pct: covered === 2 ? 100 : 50 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 2, pct: 0 }, featureChains: [] };
}

describe("web run store and HTTP/SSE", () => {
  it("serves coverage through HTTP and renders a coverage-capable page", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_coverage");
    store.setCoverage(run.runId, coverage(run.runId));
    const web = createWebServer(store); const listening = await web.listen();
    try {
      const payload = await get(`${listening.url}/api/runs/${run.runId}/coverage`);
      expect(payload.status).toBe(200); expect(JSON.parse(payload.body).lines.pct).toBe(50);
      expect(JSON.parse(payload.body).featureChains).toEqual([]);
      const page = await get(`${listening.url}/?runId=${run.runId}`);
      expect(page.body).toContain("Coverage"); expect(page.body).toContain("coverage.updated");
      expect(page.body).toContain("history");
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
      expect(store.subscriberCount(run.runId)).toBe(0);
    } finally { await close(web.server); }
  });

  it("hydrates historical artifacts so HTTP APIs work without an in-memory run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-web-art-"));
    mkdirSync(join(dir, "run_hist"));
    writeFileSync(join(dir, "run_hist", "run.json"), JSON.stringify({ runId: "run_hist", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", totalCases: 1, completedCases: 1, passedCases: 1, results: [], events: [] }), "utf8");
    writeFileSync(join(dir, "run_hist", "coverage.json"), JSON.stringify(coverage("run_hist")), "utf8");
    const store = new RunStore();
    const web = createWebServer(store, "127.0.0.1", 0, dir);
    const listening = await web.listen();
    try {
      const list = await get(`${listening.url}/api/runs`);
      const run = await get(`${listening.url}/api/runs/run_hist`);
      const cov = await get(`${listening.url}/api/runs/run_hist/coverage`);
      expect(list.status).toBe(200);
      expect(JSON.parse(list.body).some((item: { runId: string }) => item.runId === "run_hist")).toBe(true);
      expect(run.status).toBe(200);
      expect(JSON.parse(cov.body).lines.total).toBe(2);
      expect(new FileArtifactRepository(dir).readRun("run_hist")?.runId).toBe("run_hist");
      const home = await get(`${listening.url}/`);
      expect(home.body).toContain("/api/runs");
      const report = await get(`${listening.url}/api/runs/run_hist/report/markdown`);
      expect(report.status).toBe(200);
      expect(report.body).toContain("run_hist");
    } finally { await close(web.server); }
  });

  it("pushes provisional then final coverage over SSE", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_live"); const web = createWebServer(store); const listening = await web.listen();
    try {
      const events: string[] = [];
      await new Promise<void>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/events`);
        req.on("response", (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            events.push(chunk);
            if (chunk.includes("event: run.snapshot")) {
              store.setCoverage(run.runId, coverage(run.runId, "provisional", 1));
              store.setCoverage(run.runId, coverage(run.runId, "final", 2));
            }
            if (events.join("").includes("\"status\":\"final\"")) { res.destroy(); resolvePromise(); }
          });
        });
        req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
        req.end();
      });
      const body = events.join("");
      expect(body).toContain("coverage.updated");
      expect(body).toContain("\"status\":\"provisional\"");
      expect(body).toContain("\"status\":\"final\"");
    } finally { await close(web.server); }
  });

  it("delivers events to multiple clients and does not block a healthy client behind a paused one", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_multi"); const web = createWebServer(store); const listening = await web.listen();
    const received = ["", ""];
    try {
      const sockets: Array<{ destroy: () => void; pause: () => void }> = [];
      await Promise.all([0, 1].map((index) => new Promise<void>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/events`);
        req.on("response", (res) => {
          sockets[index] = res;
          if (index === 1) res.socket?.pause();
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            received[index] += chunk;
            if (chunk.includes("event: run.snapshot")) resolvePromise();
          });
        });
        req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
        req.end();
      })));
      expect(store.subscriberCount(run.runId)).toBe(2);
      store.setCoverage(run.runId, coverage(run.runId, "final", 2));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
      expect(received[0]).toContain("coverage.updated");
      sockets[1]?.pause();
      sockets[0]?.destroy();
      sockets[1]?.destroy();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
      expect(store.subscriberCount(run.runId)).toBe(0);
    } finally { await close(web.server); }
  });
});
