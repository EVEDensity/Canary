import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { execFileSync } from "node:child_process";
import { createWebServer, FileArtifactRepository, RunStore } from "../src/index.js";
import { beginArtifacts, sealArtifacts, writePrivateJson } from "@canary/trace";
import { buildStructure } from "@canary/structure";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, (response) => { let body = ""; response.setEncoding("utf8"); response.on("data", (part) => body += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body })); });
    req.on("error", reject); req.end();
  });
}
function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } }, (response) => {
      let data = ""; response.setEncoding("utf8"); response.on("data", (part) => data += part); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
const WRITE = { "x-canary-write-token": "test-token" };
function close(server: ReturnType<typeof createWebServer>["server"]): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}
function coverage(runId: string, status: "provisional" | "final" = "final", covered = 1) {
  return { runId, sourceHash: "hash", status, lines: { covered, total: 2, pct: covered === 2 ? 100 : 50 }, statements: { covered, total: 2, pct: covered === 2 ? 100 : 50 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 2, pct: 0 }, featureChains: [] };
}

describe("web run store and HTTP/SSE", () => {
  it("serves the sealed historical structure and rejects a damaged graph", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-web-structure-"));
    writeFileSync(join(root, "index.ts"), "export function value() { return 1; }\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
    git("init", "-q"); git("add", "."); git("-c", "user.name=Canary Test", "-c", "user.email=test@example.com", "commit", "-qm", "source");
    const store = new RunStore();
    const run = store.create(1, "run_structure_history");
    const artifactRoot = join(root, ".canary", "artifacts");
    const dir = join(artifactRoot, run.runId);
    mkdirSync(dir, { recursive: true });
    const structure = buildStructure(root);
    beginArtifacts(dir);
    writePrivateJson(join(dir, "run.json"), run);
    writePrivateJson(join(dir, "structure.json"), structure);
    sealArtifacts(dir);
    const web = createWebServer(new RunStore(), "127.0.0.1", 0, artifactRoot);
    const listening = await web.listen();
    try {
      const response = await get(`${listening.url}/api/structure?runId=${run.runId}`);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).structure.source.inventoryHash).toBe(structure.source.inventoryHash);
      expect(JSON.parse(response.body).integrity.status).toBe("verified");
      const fileId = structure.nodes.find((node) => node.kind === "file" && node.path === "index.ts")!.id;
      const sourceUrl = `${listening.url}/api/structure/source?runId=${run.runId}&nodeId=${encodeURIComponent(fileId)}`;
      expect(JSON.parse((await get(sourceUrl)).body).availability).toBe("current-hash-match");
      writeFileSync(join(root, "index.ts"), "export function value() { return 2; }\n");
      const historical = JSON.parse((await get(sourceUrl)).body);
      expect(historical.availability).toBe("git-hash-match");
      expect(historical.lines.join("\n")).toContain("return 1");
      writeFileSync(join(dir, "structure.json"), "{damaged");
      expect((await get(`${listening.url}/api/structure?runId=${run.runId}`)).status).toBe(409);
      expect((await get(sourceUrl)).status).toBe(409);
    } finally { await close(web.server); }
  });
  it("links checks to source only through a verified child coverage hash", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-web-check-links-"));
    writeFileSync(join(root, "index.ts"), "export function value() { return 1; }\n");
    const structure = buildStructure(root);
    const file = structure.nodes.find((node) => node.kind === "file" && node.path === "index.ts")!;
    const artifactRoot = join(root, ".canary", "artifacts");
    const store = new RunStore();
    const child = store.create(1, "run_check_link_child");
    const childDir = join(artifactRoot, child.runId);
    mkdirSync(childDir, { recursive: true });
    beginArtifacts(childDir);
    writePrivateJson(join(childDir, "run.json"), child);
    writePrivateJson(join(childDir, "coverage.json"), {
      ...coverage(child.runId),
      files: [{ filePath: join(root, "index.ts"), sourceHash: file.sourceHash, status: "covered", lines: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 0, pct: 0 } }],
    });
    sealArtifacts(childDir);
    const childHash = new FileArtifactRepository(artifactRoot).verify(child.runId).manifestHash!;
    const parent = store.create(1, "run_check_link_parent");
    store.update(parent.runId, { checks: [{ id: "agent.regression", type: "agent", version: 1, required: true, status: "passed", evidence: "verified", exitCode: 0, category: "none", retryable: true, durationMs: 1, cwd: root, envAllowlist: [], childRun: { runId: child.runId, artifactPath: join(childDir, "run.json"), manifestHash: childHash } }] });
    const parentDir = join(artifactRoot, parent.runId);
    mkdirSync(parentDir, { recursive: true });
    beginArtifacts(parentDir);
    writePrivateJson(join(parentDir, "run.json"), store.get(parent.runId));
    writePrivateJson(join(parentDir, "structure.json"), structure);
    sealArtifacts(parentDir);
    const web = createWebServer(new RunStore(), "127.0.0.1", 0, artifactRoot);
    const listening = await web.listen();
    try {
      const url = `${listening.url}/api/structure?runId=${parent.runId}`;
      const first = JSON.parse((await get(url)).body);
      expect(first.checkLinks).toEqual([{ nodeId: file.id, checkId: "agent.regression", runId: child.runId, evidence: "coverage-observed" }]);
      writeFileSync(join(childDir, "coverage.json"), "{damaged");
      expect((await get(url)).status).toBe(409);
    } finally { await close(web.server); }
  });
  it("keeps unrelated Agent histories out of the project page polling response", async () => {
    const store = new RunStore();
    store.create(1, "run_agent_history");
    store.create(2, "run_project_history");
    store.update("run_project_history", { checks: [] });
    const artifacts = mkdtempSync(join(tmpdir(), "canary-project-history-"));
    const historical = new RunStore();
    historical.create(1, "run_persisted_agent");
    historical.create(1, "run_persisted_project");
    historical.update("run_persisted_project", { checks: [] });
    for (const run of historical.list()) {
      mkdirSync(join(artifacts, run.runId));
      writeFileSync(join(artifacts, run.runId, "run.json"), JSON.stringify(run));
    }
    const web = createWebServer(store, "127.0.0.1", 0, artifacts, { projectPage: true });
    const listening = await web.listen();
    try {
      const response = await get(`${listening.url}/api/runs`);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).map((run: { runId: string }) => run.runId).sort()).toEqual(["run_persisted_project", "run_project_history"]);
      expect(store.get("run_persisted_agent")).toBeUndefined();
      expect((await get(`${listening.url}/api/runs/run_agent_history`)).status).toBe(200);
    } finally { await close(web.server); }
  });

  it("serves coverage through HTTP and renders a coverage-capable page", async () => {
    const store = new RunStore(); const run = store.create(1, "run_web_coverage");
    store.setCoverage(run.runId, coverage(run.runId));
    const web = createWebServer(store); const listening = await web.listen();
    try {
      const payload = await get(`${listening.url}/api/runs/${run.runId}/coverage`);
      expect(payload.status).toBe(200); expect(JSON.parse(payload.body).lines.pct).toBe(50);
      expect(JSON.parse(payload.body).featureChains).toEqual([]);
      const page = await get(`${listening.url}/?runId=${run.runId}`);
      expect(page.body).toContain("Coverage"); expect(page.body).toContain("/api/workspace/runs");
      expect(page.body).toContain("history");
      expect(page.body).toContain("此工作台需要 JavaScript");
      expect(page.body).toContain("正在处理运行数据");
      expect(page.body).toContain("连接中断");
      expect(page.body).toContain("/api/workspace/runs");
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
      expect(home.body).toContain("改进建议");
      expect(home.body).toContain("检查通过率趋势");
      expect(home.body).toContain("运行时间线");
      expect(home.body).toContain("代码与功能覆盖率");
      expect(home.body).toContain("Agent 用例与轨迹");
      expect(home.body).toContain("canary report");
      expect(home.body).toContain("JSON 报告");
      expect(home.body).toContain("JUnit 报告");
      expect(home.body).toContain("与历史运行比较");
      expect(home.body).toContain("运行时间线");
      expect(home.body).toContain("准备中");
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
    const web = createWebServer(store, "127.0.0.1", 0, dir, { writeToken: "test-token" });
    const listening = await web.listen();
    try {
      const payload = await get(`${listening.url}/api/runs/run_imp/improvements`);
      expect(payload.status).toBe(200);
      expect(JSON.parse(payload.body)[0].caseId).toBe("broken");
      const page = await get(`${listening.url}/?runId=run_imp`);
      expect(page.body).toContain("改进建议");
      expect(page.body).toContain("/improvements/");
      const denied = await post(`${listening.url}/api/runs/run_imp/improvements/s1`, { status: "accepted" });
      expect(denied.status).toBe(403);
      const accepted = await post(`${listening.url}/api/runs/run_imp/improvements/s1`, { status: "accepted" }, WRITE);
      expect(accepted.status).toBe(200);
      expect(JSON.parse(accepted.body).status).toBe("accepted");
      const verified = await post(`${listening.url}/api/runs/run_imp/improvements/s1`, { status: "verified" }, WRITE);
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
    const web = createWebServer(store, "127.0.0.1", 0, undefined, { writeToken: "test-token" });
    const listening = await web.listen();
    try {
      const replayed = await new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/replay`, { method: "POST", headers: { "content-type": "application/json", "x-canary-write-token": "test-token" } }, (response) => {
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
      expect(page.body).toContain("重新评估");
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
      expect(JSON.parse(compared.body).assessment).toMatchObject({ level: "insufficient", sample: { matched: 1 }, changes: { regressions: 1 } });
      const events = store.eventLog(baseline.runId).map((event) => event.type);
      expect(events).toContain("case.started");
      expect(events).toContain("case.finished");
    } finally { await close(web.server); }
  });

  it("compares original case identities before response redaction collapses secret values", async () => {
    const store = new RunStore();
    for (const [runId, secret] of [["run_secret_before", "sk-case-one"], ["run_secret_after", "sk-case-two"]]) {
      store.create(1, runId);
      store.appendEvent(runId, {
        type: "execution.finished", executionId: `${runId}-execution`,
        result: {
          runId, executionId: `${runId}-execution`, caseId: "task", passed: true,
          assertions: [{ id: "state.equals", passed: true }], coverage: coverage(runId),
          sourceCase: { id: "task", input: { apiKey: secret }, assertions: [{ type: "state.equals", value: { done: true } }] },
        },
      });
      store.finish(runId);
    }
    const web = createWebServer(store);
    const listening = await web.listen();
    try {
      const response = await get(`${listening.url}/api/compare?baseline=run_secret_before&candidate=run_secret_after`);
      expect(response.status).toBe(200);
      expect(response.body).not.toContain("sk-case-one");
      expect(response.body).not.toContain("sk-case-two");
      expect(JSON.parse(response.body).assessment.uncertainty.join(" ")).toMatch(/用例输入/);
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
      expect(page.body).toContain("加载轨迹 / state diff");
      expect(page.body).toContain("此工作台需要 JavaScript");
      expect(page.body).toContain("连接中断");
      expect(page.body).toContain("读取失败");
      expect(page.body).toContain("/api/workspace/runs");
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

  it("redacts secrets on run JSON and SSE payloads", async () => {
    const store = new RunStore();
    const run = store.create(1, "run_secret");
    store.appendEvent(run.runId, {
      type: "execution.finished",
      executionId: "exec_secret",
      result: {
        runId: run.runId,
        executionId: "exec_secret",
        caseId: "smoke",
        passed: true,
        assertions: [],
        coverage: coverage(run.runId),
        input: { apiKey: "sk-live" },
        output: { password: "p" },
      },
    });
    const web = createWebServer(store);
    const listening = await web.listen();
    try {
      const payload = await get(`${listening.url}/api/runs/${run.runId}`);
      expect(payload.status).toBe(200);
      const body = JSON.parse(payload.body);
      expect(body.results[0].input.apiKey).toBe("[redacted]");
      expect(body.results[0].output.password).toBe("[redacted]");
      const streamed = await new Promise<string>((resolvePromise, reject) => {
        const req = request(`${listening.url}/api/runs/${run.runId}/events`);
        req.on("response", (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
            if (data.includes("event: run.snapshot")) { res.destroy(); resolvePromise(data); }
          });
        });
        req.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNRESET") reject(error); });
        req.end();
      });
      expect(streamed).toContain("[redacted]");
      expect(streamed).not.toContain("sk-live");
    } finally { await close(web.server); }
  });

  it("fails clearly when the requested UI port is already in use", async () => {
    const occupied = createWebServer(new RunStore(), "127.0.0.1", 0);
    const listening = await occupied.listen();
    try {
      const conflict = createWebServer(new RunStore(), "127.0.0.1", listening.port);
      await expect(conflict.listen()).rejects.toThrow(/already in use/);
    } finally {
      await close(occupied.server);
    }
  });
});
