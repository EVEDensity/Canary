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
function post(url: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
      let data = ""; response.setEncoding("utf8"); response.on("data", (part) => data += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
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
      expect(page.body).toContain("Snapshot (no JavaScript)");
      expect(page.body).toContain("status-running");
      expect(page.body).toContain("Live stream disconnected. Polling snapshot");
      expect(page.body).toContain("EventSource unavailable");
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
      expect(home.body).toContain("Improvement Queue");
      expect(home.body).toContain("Overview");
      expect(home.body).toContain("Run Timeline");
      expect(home.body).toContain("Feature Coverage");
      expect(home.body).toContain("Case Detail");
      expect(home.body).toContain("canary replay");
      expect(home.body).toContain("/report/json");
      expect(home.body).toContain("/report/junit");
      expect(home.body).toContain("Compare");
      expect(home.body).toContain("case.started");
      expect(home.body).toContain("preparing");
      expect(home.body).toContain("state diff");
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

  it("serves Improvement Queue JSON from hydrated artifacts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-web-imp-"));
    mkdirSync(join(dir, "run_imp"));
    writeFileSync(join(dir, "run_imp", "run.json"), JSON.stringify({ runId: "run_imp", status: "failed", startedAt: "2026-01-01T00:00:00.000Z", totalCases: 1, completedCases: 1, passedCases: 0, results: [], events: [] }), "utf8");
    writeFileSync(join(dir, "run_imp", "improvement.json"), JSON.stringify([{ id: "s1", caseId: "broken", category: "prompt", status: "proposed", rationale: "missing output", evidence: [] }]), "utf8");
    const store = new RunStore();
    const web = createWebServer(store, "127.0.0.1", 0, dir);
    const listening = await web.listen();
    try {
      const payload = await get(`${listening.url}/api/runs/run_imp/improvements`);
      expect(payload.status).toBe(200);
      expect(JSON.parse(payload.body)[0].caseId).toBe("broken");
      const page = await get(`${listening.url}/?runId=run_imp`);
      expect(page.body).toContain("Improvement Queue");
      expect(page.body).toContain("/api/runs/'+runId+'/improvements");
      const accepted = await post(`${listening.url}/api/runs/run_imp/improvements/s1`, { status: "accepted" });
      expect(accepted.status).toBe(200);
      expect(JSON.parse(accepted.body).status).toBe("accepted");
      const verified = await post(`${listening.url}/api/runs/run_imp/improvements/s1`, { status: "verified" });
      expect(verified.status).toBe(200);
      expect(JSON.parse(verified.body).status).toBe("verified");
    } finally { await close(web.server); }
  });

  it("resumes SSE from Last-Event-ID without replaying the same coverage fragment", async () => {
    const store = new RunStore();
    const run = store.create(1, "run_sse_resume");
    const web = createWebServer(store);
    const listening = await web.listen();
    const collect = (headers: Record<string, string> = {}, afterSnapshot?: () => void): Promise<string> => new Promise((resolvePromise, reject) => {
      const req = request(`${listening.url}/api/runs/${run.runId}/events`, { headers });
      req.on("response", (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.includes("event: run.snapshot")) afterSnapshot?.();
          if (data.includes("event: coverage.updated") && data.includes("\"status\":\"provisional\"")) { res.destroy(); resolvePromise(data); }
        });
      });
      req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
      req.end();
    });
    try {
      const first = await collect({}, () => store.setCoverage(run.runId, coverage(run.runId, "provisional", 1)));
      const lastId = Math.max(0, ...[...first.matchAll(/^id: (\d+)/gm)].map((match) => Number(match[1])));
      expect(lastId).toBeGreaterThan(0);
      let resumed = "";
      await new Promise<void>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/events`, { headers: { "Last-Event-ID": String(lastId) } });
        req.on("response", (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            resumed += chunk;
            if (resumed.includes("event: run.snapshot") && resumed.includes("\"status\":\"final\"")) { res.destroy(); resolvePromise(); }
            if (resumed.includes("event: run.snapshot") && !resumed.includes("\"status\":\"final\"")) {
              store.setCoverage(run.runId, coverage(run.runId, "final", 2));
            }
          });
        });
        req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
        req.end();
      });
      expect(resumed).toContain("event: run.snapshot");
      expect(resumed).toContain("id: ");
      const updatedAt = resumed.indexOf("event: coverage.updated");
      expect(updatedAt).toBeGreaterThan(resumed.indexOf("event: run.snapshot"));
      expect((resumed.match(/event: coverage.updated/g) ?? []).length).toBe(1);
      expect(resumed.slice(updatedAt)).toContain("\"status\":\"final\"");
      expect(resumed.slice(updatedAt)).not.toContain("\"status\":\"provisional\"");
    } finally { await close(web.server); }
  });

  it("accepts POST replay, exposes the CLI command, and rejects invalid report formats", async () => {
    const store = new RunStore();
    const run = store.create(1, "run_replay");
    store.setCoverage(run.runId, coverage(run.runId));
    const web = createWebServer(store);
    const listening = await web.listen();
    try {
      const replayed = await new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/replay`, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
          let body = ""; response.setEncoding("utf8"); response.on("data", (part) => body += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end("{}");
      });
      expect(replayed.status).toBe(200);
      const payload = JSON.parse(replayed.body);
      expect(payload.command).toBe(`canary replay ${run.runId}`);
      expect(payload.mode).toBe("command");
      const bad = await get(`${listening.url}/api/runs/${run.runId}/report/html`);
      expect(bad.status).toBe(400);
      expect(bad.body).toContain("report format");
      const page = await get(`${listening.url}/?runId=${run.runId}`);
      expect(page.body).toContain("/api/runs/'+runId+'/replay");
    } finally { await close(web.server); }
  });

  it("compares baseline and candidate runs and emits case.started aliases", async () => {
    const store = new RunStore();
    const baseline = store.create(1, "run_base");
    store.appendEvent(baseline.runId, { type: "execution.started", runId: baseline.runId, executionId: "exec_1", caseId: "smoke" });
    store.appendEvent(baseline.runId, { type: "execution.finished", executionId: "exec_1", result: { runId: baseline.runId, executionId: "exec_1", caseId: "smoke", passed: true, assertions: [], coverage: coverage(baseline.runId), createdAt: "2026-01-01T00:00:00.000Z" } });
    store.finish(baseline.runId);
    const candidate = store.create(1, "run_cand");
    store.appendEvent(candidate.runId, { type: "execution.finished", executionId: "exec_2", result: { runId: candidate.runId, executionId: "exec_2", caseId: "smoke", passed: false, assertions: [{ id: "output.exists", passed: false }], coverage: coverage(candidate.runId), failureCategory: "assertion_failed" } });
    store.finish(candidate.runId);
    const web = createWebServer(store);
    const listening = await web.listen();
    try {
      const compared = await get(`${listening.url}/api/compare?baseline=${baseline.runId}&candidate=${candidate.runId}`);
      expect(compared.status).toBe(200);
      expect(JSON.parse(compared.body).verdict).toBe("reject");
      const events = store.eventLog(baseline.runId).map((event) => event.type);
      expect(events).toContain("case.started");
      expect(events).toContain("case.finished");
    } finally { await close(web.server); }
  });

  it("emits canonical SSE names, heartbeats, and trace.event", async () => {
    const previous = process.env.CANARY_SSE_HEARTBEAT_MS;
    process.env.CANARY_SSE_HEARTBEAT_MS = "25";
    const store = new RunStore();
    const run = store.create(1, "run_sse_canonical");
    store.appendEvent(run.runId, { type: "trace.event", executionId: "exec_1", event: { type: "tool.call", timestamp: "2026-01-01T00:00:00.000Z" } });
    store.appendEvent(run.runId, { type: "execution.started", runId: run.runId, executionId: "exec_1", caseId: "smoke" });
    store.appendEvent(run.runId, { type: "execution.finished", executionId: "exec_1", result: { runId: run.runId, executionId: "exec_1", caseId: "smoke", passed: true, assertions: [], coverage: coverage(run.runId), createdAt: "2026-01-01T00:00:00.000Z" } });
    store.appendEvent(run.runId, { type: "execution.failed", executionId: "exec_1", error: "none" });
    store.setCoverage(run.runId, coverage(run.runId, "final", 2));
    store.finish(run.runId);
    const types = store.eventLog(run.runId).map((event) => event.type);
    const { CANONICAL_SSE_EVENTS } = await import("@canary/core");
    for (const name of CANONICAL_SSE_EVENTS) expect(types).toContain(name);
    const web = createWebServer(store);
    const listening = await web.listen();
    try {
      const page = await get(`${listening.url}/?runId=${run.runId}`);
      expect(page.body).toContain("trace.event");
      expect(page.body).toContain("Snapshot (no JavaScript)");
      expect(page.body).toContain("Live stream disconnected. Polling snapshot");
      expect(page.body).toContain("Cannot reach canary UI. Showing last known snapshot.");
      expect(page.body).toContain("EventSource unavailable");
      const streamed = await new Promise<string>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/events`);
        req.on("response", (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
            if (data.includes(": ping")) { res.destroy(); resolvePromise(data); }
          });
        });
        req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
        req.end();
        setTimeout(() => reject(new Error("heartbeat timeout")), 2000);
      });
      expect(streamed).toContain(": ping");
      expect(streamed).toContain("event: run.snapshot");
    } finally {
      if (previous === undefined) delete process.env.CANARY_SSE_HEARTBEAT_MS;
      else process.env.CANARY_SSE_HEARTBEAT_MS = previous;
      await close(web.server);
    }
  });
});
