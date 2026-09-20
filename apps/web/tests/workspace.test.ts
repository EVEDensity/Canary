import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginArtifacts, sealArtifacts, writePrivateJson, FileArtifactRepository, RunStore } from "@canary/trace";
import type { RunSnapshot } from "@canary/core";
import { WorkspaceReader } from "../src/workspace.js";
import { createWebServer } from "../src/index.js";

const run = (id: string): RunSnapshot => ({
  runId: id,
  status: "completed",
  startedAt: "2026-09-20T00:00:00.000Z",
  totalCases: 1,
  completedCases: 1,
  passedCases: 1,
  results: [],
  events: [],
});
const ratio = { covered: 2, total: 4, pct: 50 };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-workspace-"));
  const child = {
    ...run("run_child"),
    coverage: {
      runId: "run_child",
      sourceHash: "test",
      status: "final" as const,
      lines: ratio,
      statements: ratio,
      branches: ratio,
      functions: ratio,
      featureChains: [],
    },
  };
  const dir = join(root, child.runId);
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), child);
  sealArtifacts(dir);
  const repo = new FileArtifactRepository(root);
  const parent: RunSnapshot = {
    ...run("run_parent"),
    checks: [
      {
        id: "agent",
        type: "agent",
        version: 1,
        required: true,
        status: "passed",
        evidence: "verified",
        exitCode: 0,
        category: "none",
        retryable: true,
        durationMs: 42,
        cwd: root,
        envAllowlist: [],
        childRun: {
          runId: child.runId,
          artifactPath: join(dir, "run.json"),
          manifestHash: repo.verify(child.runId).manifestHash!,
        },
      },
    ],
  };
  beginArtifacts(join(root, parent.runId));
  writePrivateJson(join(root, parent.runId, "run.json"), parent);
  sealArtifacts(join(root, parent.runId));
  return { root, repo, child, parent, reader: new WorkspaceReader(new RunStore(), repo) };
}
describe("unified verification workspace", () => {
  it("lists both run kinds as summaries and surfaces linked coverage without calling it repository coverage", () => {
    const f = fixture(),
      rows = f.reader.list();
    expect(rows.map((r) => r.kind).sort()).toEqual(["agent", "project"]);
    expect(JSON.stringify(rows)).not.toContain("featureChains");
    expect(JSON.stringify(rows)).not.toContain("results");
    const detail = f.reader.read(f.parent.runId)!;
    expect(detail.coverageSources[0]?.coverage?.lines.pct).toBe(50);
    expect(detail.coverageSources[0]?.runId).toBe(f.child.runId);
    expect(detail.coverageSources[0]?.scope).toContain("仅覆盖");
  });
  it("withholds corrupted child data and never fabricates coverage for a retry subset", () => {
    const f = fixture();
    writeFileSync(join(f.root, f.child.runId, "run.json"), JSON.stringify({ ...f.child, status: "failed" }));
    expect(() => f.reader.read(f.parent.runId)).toThrow("Artifact integrity");
    const store = new RunStore();
    store.create(0, "run_retry");
    store.update("run_retry", { checks: [], retryOf: f.parent.runId });
    expect(new WorkspaceReader(store, f.repo).read("run_retry")?.coverageSources).toEqual([]);
  });
  it("serves one UI for both modes with lazy detail, redacted data, and project isolation", async () => {
    const f = fixture(),
      store = new RunStore();
    const web = createWebServer(store, "127.0.0.1", 0, f.root, { projectPage: true, writeToken: "test-token" });
    expect(store.list()).toHaveLength(0);
    const { url } = await web.listen();
    try {
      const page = await fetch(url).then((r) => r.text());
      expect(page).toContain("代码与功能覆盖率");
      expect(page).toContain("用例与轨迹");
      const rows = await fetch(url + "/api/workspace/runs").then((r) => r.json());
      expect(rows).toHaveLength(2);
      const detail = await fetch(url + "/api/workspace/runs/run_parent").then((r) => r.json());
      expect(detail.coverageSources[0].coverage.lines.pct).toBe(50);
      expect((await fetch(url + "/api/workspace/runs/run_foreign")).status).toBe(404);
      expect(
        (await fetch(url + "/api/workspace/runs", { headers: { origin: "https://outside.example" } })).status,
      ).toBe(403);
      expect((await fetch(url + "/api/session/close", { method: "POST" })).status).toBe(403);
      store.create(1, "run_private");
      store.update("run_private", {
        checks: [{ ...f.parent.checks![0]!, stdout: "Bearer fixture-secret-value", childRun: undefined }],
      });
      const privateData = await fetch(url + "/api/workspace/runs/run_private").then((r) => r.text());
      expect(privateData).not.toContain("fixture-secret-value");
      expect(privateData).toContain("[redacted]");
    } finally {
      web.server.closeAllConnections();
      await new Promise<void>((done) => web.server.close(() => done()));
    }
  });
});
