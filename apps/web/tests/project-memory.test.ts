import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectMemoryHash,
  projectMemoryId,
  projectMemoryProjectId,
  projectMemoryQueryChars,
  type ProjectMemoryRecord,
  type ProjectMemoryQuery,
  type RunSnapshot,
} from "@canary/core";
import { beginArtifacts, sealArtifacts, writePrivateJson, RunStore } from "@canary/trace";
import { projectMemoryClient } from "../src/project-memory-ui.js";
import { createWebServer } from "../src/index.js";
import { readCatalogs } from "../src/i18n.js";

const hash = "a".repeat(64), commit = "b".repeat(40);
function record(projectId = hash): ProjectMemoryRecord {
  const receiptHash = "c".repeat(64);
  const value = {
    v: 1 as const, kind: "canary.project-memory" as const,
    id: projectMemoryId(projectId, receiptHash), projectId, status: "retained" as const,
    createdAt: "2026-10-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
    operator: { actor: "maintainer", reason: "Operator notes are not UI instructions", reviewAcknowledged: false },
    source: {
      original: { runId: "run_original", commit, manifestHash: hash },
      candidate: { runId: "run_candidate", commit: "d".repeat(40), manifestHash: hash },
      beforeRegression: { runId: "run_regression", commit, manifestHash: hash }, receiptHash,
    },
    failures: [{ checkId: "unit", checkType: "command" as const, category: "assertion" as const, declarationHash: hash, paths: ["src/value.mjs"] }],
    regressionChecks: ["regression"], testFiles: ["tests/value.mjs"],
    scope: { projectPath: ".", files: [{ path: "src/value.mjs", mode: "100644" as const, blob: commit }] },
    contentHash: "",
  };
  value.contentHash = projectMemoryHash(value);
  return value;
}
function query(projectId = hash): ProjectMemoryQuery {
  const items = [{ record: record(projectId), match: "related" as const, checkIds: ["unit"], reasons: ["Declared failure and source scope match"] }];
  return { v: 1, kind: "canary.project-memory-query", runId: "run_current", projectId, status: "available", items,
    skipped: [], total: 1, omitted: 0, omittedSkipped: 0,
    budget: { maxItems: 5, maxChars: 8000, usedChars: projectMemoryQueryChars(items) },
    advisoryOnly: true, executionGranted: false, reasons: [],
  };
}
class Element {
  children: Element[] = [];
  parent?: Element;
  id = "";
  value = "";
  disabled = false;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  onclick?: () => Promise<void>;
  onchange?: () => void;
  constructor(readonly tag: string, private content = "", readonly className = "") {}
  append(...nodes: Element[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: Element[]) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  get textContent(): string { return this.content + this.children.map(node => node.textContent).join(" "); }
  set textContent(value: string) { this.content = value; this.children = []; }
}
function nodes(node: Element): Element[] { return [node, ...node.children.flatMap(nodes)]; }
function client() {
  const root = new Element("div"), calls: string[] = [], navigation: string[] = [];
  root.id = "improvements";
  const pending: Array<(value: unknown) => void> = [];
  let locale = "en";
  const catalogs = readCatalogs();
  const context = {
    selected: "run_current", document: { createElement: (tag: string) => new Element(tag) },
    text: (tag: string, value = "", className = "") => new Element(tag, value, className),
    button: (label: string, action: () => Promise<void>, className = "") => Object.assign(new Element("button", label, className), { onclick: action }),
    t: (key: string) => catalogs[locale]![key] ?? key,
    tfmt: (key: string, values: Record<string, unknown>) => (catalogs[locale]![key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name])),
    $: (id: string) => nodes(root).find(node => node.id === id),
    checkCategoryLabel: () => locale === "en" ? "Assertion / Test" : "断言 / 测试",
    date: (value: string) => value,
    api: (path: string) => { calls.push(path); return new Promise(resolve => pending.push(resolve)); },
    select: async (id: string) => { context.selected = id; navigation.push(id); }, showTab: (tab: string) => navigation.push(tab),
  };
  const run = { runId: "run_current", kind: "project", status: "failed", checks: [{ id: "unit", status: "failed" }] };
  const control = runInNewContext(projectMemoryClient + "\n({render:renderProjectMemory,reset:memoryInvalidate})", context) as { render: (run: unknown) => void; reset: () => void };
  return { root, calls, navigation, pending, context, control, run, locale: (value: string) => { locale = value; } };
}

describe("read-only historical repair workspace", () => {
  it("queries only on demand, refreshes from the backend and redraws language changes from memory", async () => {
    const f = client();
    f.control.render(f.run);
    expect(f.calls).toEqual([]);
    expect(f.root.textContent).toContain("Find historical repairs");
    const first = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    expect(f.calls).toEqual(["/api/runs/run_current/memory"]);
    expect(f.root.textContent).toContain("Verifying historical repair evidence");
    f.pending.shift()!(query()); await first;
    expect(f.root.textContent).toContain("Related history");
    expect(f.root.textContent).toContain("does not establish a fix");
    expect(f.root.textContent).not.toContain("Operator notes");
    expect(f.root.textContent).not.toContain("Declared failure");
    f.locale("zh-CN"); f.control.render(f.run);
    expect(f.calls).toHaveLength(1);
    expect(f.root.textContent).toContain("历史验证不代表本次问题已修复");
    const refresh = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    const next = query(); next.items[0]!.match = "needs-revalidation";
    f.pending.shift()!(next); await refresh;
    expect(f.calls).toHaveLength(2);
    expect(f.root.textContent).toContain("需重新验证");
    await nodes(f.root).find(node => node.tag === "button" && node.textContent.includes("原失败"))!.onclick!();
    expect(f.navigation).toEqual(["run_original", "checks"]);
  });
  it("does not let an old request replace a new check query or another selected run", async () => {
    const f = client(); f.control.render(f.run);
    const old = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    const checks = nodes(f.root).find(node => node.tag === "select")!;
    checks.value = "unit"; checks.onchange!();
    const next = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    const secondResult = query(); secondResult.items[0]!.match = "needs-revalidation";
    f.pending[1]!(secondResult); await next;
    f.pending[0]!(query()); await old;
    expect(f.root.textContent).toContain("Needs revalidation");
    expect(f.root.textContent).not.toContain("Related history");
    const third = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    f.context.selected = "run_other"; f.control.reset(); f.control.render({ ...f.run, runId: "run_other" });
    f.pending[2]!(query()); await third;
    expect(f.root.textContent).toContain("Find historical repairs");
    expect(f.root.textContent).not.toContain("Needs revalidation");
    expect(f.calls[1]).toBe("/api/runs/run_current/memory?checkId=unit");
  });
  it("localizes controlled revalidation reasons and keeps escaped source scope inside details", async () => {
    const f = client(); f.control.render(f.run);
    const request = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    const result = query(), item = result.items[0]!;
    item.match = "needs-revalidation";
    const path = "src/<img-onerror>.mjs";
    item.record.scope.files = Array.from({ length: 10 }, (_, index) => ({ path: index ? `src/part${index}.mjs` : path, mode: "100644", blob: commit }));
    item.reasons = ["constructor", "__proto__", "Untrusted arbitrary reason", "related-source-changed", "execution-context-changed", "failure-location-unavailable", "candidate-not-established-as-ancestor", "scope-file-changed:" + path];
    f.pending.shift()!(result); await request;
    const card = nodes(f.root).find(node => node.className === "memory-card")!;
    const visible = card.children.filter(node => node.tag !== "details").map(node => node.textContent).join(" ");
    expect(visible).toContain("Related source changed; run verification again");
    expect(visible).toContain("Execution context changed; revalidation is required");
    expect(visible).not.toContain("Failure-location evidence");
    expect(visible).not.toContain("ancestor");
    expect(card.textContent).not.toContain("Untrusted arbitrary reason");
    expect(card.textContent).not.toContain("Operator notes");
    expect(card.textContent).not.toContain("[object Object]");
    const details = card.children.find(node => node.tag === "details")!;
    expect(details.textContent).toContain(path);
    expect(details.textContent).toContain("Source changed");
    expect(details.textContent).toContain("2 more scoped files");
    expect(nodes(details).filter(node => node.tag === "code").some(node => node.textContent === path)).toBe(true);
    expect(nodes(details).some(node => node.tag === "img")).toBe(false);
    expect(visible).not.toContain(path);
    f.locale("zh-CN"); f.control.render(f.run);
    expect(f.root.textContent).toContain("相关源码已变化，需要重新运行验证");
    expect(f.root.textContent).toContain("执行环境已变化，需要重新验证");
    expect(f.root.textContent).toContain("另有 2 个范围文件");
    expect(f.calls).toHaveLength(1);
  });
  it("keeps unavailable evidence separate from a known empty result and disables unsealed queries", async () => {
    const f = client(); f.control.render(f.run);
    let request = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    f.pending.shift()!({ status: "unavailable", items: [] }); await request;
    expect(f.root.textContent).toContain("no match has been established");
    request = nodes(f.root).find(node => node.tag === "button")!.onclick!();
    f.pending.shift()!({ ...query(), items: [], total: 0, budget: { maxItems: 5, maxChars: 8000, usedChars: 0 } }); await request;
    expect(f.root.textContent).toContain("No available historical repairs match");
    f.control.render({ ...f.run, status: "running" });
    expect(nodes(f.root).find(node => node.tag === "button")!.disabled).toBe(true);
    expect(f.root.textContent).toContain("after the run is sealed");
  });
  it("validates sealed run, project, receipt budget and check identity without exposing write operations", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-web-memory-"));
    const artifacts = join(root, ".canary", "artifacts"), dir = join(artifacts, "run_current");
    mkdirSync(artifacts, { recursive: true });
    const run: RunSnapshot = { runId: "run_current", status: "failed", startedAt: "2026-10-01T00:00:00Z", totalCases: 0, completedCases: 0, passedCases: 0, results: [], events: [], checks: [{ id: "unit", type: "command", version: 1, required: true, status: "failed", evidence: "verified", exitCode: 1, category: "assertion", retryable: true, durationMs: 10, cwd: ".", envAllowlist: [] }] };
    beginArtifacts(dir); writePrivateJson(join(dir, "run.json"), run); sealArtifacts(dir);
    const projectId = projectMemoryProjectId(realpathSync.native(root));
    const before = readFileSync(join(dir, "manifest.json"), "utf8");
    let result: unknown = query(projectId), calls = 0;
    const web = createWebServer(new RunStore(), "127.0.0.1", 0, artifacts, { onMemoryQuery: () => { calls++; return result; } });
    const { url } = await web.listen();
    try {
      const response = await fetch(url + "/api/runs/run_current/memory?checkId=unit");
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(query(projectId));
      for (const change of [
        (q: ProjectMemoryQuery) => { q.runId = "run_wrong"; },
        (q: ProjectMemoryQuery) => { q.projectId = "d".repeat(64); },
        (q: ProjectMemoryQuery) => { q.budget.maxChars = 8001; },
        (q: ProjectMemoryQuery) => { q.budget.usedChars = 0; },
        (q: ProjectMemoryQuery) => { q.items[0]!.record.expiresAt = "2026-10-02T00:00:00Z"; q.items[0]!.record.contentHash = projectMemoryHash(q.items[0]!.record); q.budget.usedChars = projectMemoryQueryChars(q.items); },
      ]) {
        const q = query(projectId); change(q); result = q;
        const value = await (await fetch(url + "/api/runs/run_current/memory")).json() as ProjectMemoryQuery;
        expect(value.status).toBe("unavailable"); expect(value.total).toBeNull(); expect(value.items).toEqual([]);
      }
      const count = calls;
      for (const path of ["?checkId=missing", "?checkId=unit&checkId=unit", "?maxChars=9999", "?checkId=.."])
        expect((await fetch(url + "/api/runs/run_current/memory" + path)).status).toBe(400);
      expect((await fetch(url + "/api/runs/run_current/memory", { method: "POST" })).status).toBe(405);
      expect((await fetch(url + "/api/runs/run_missing/memory")).status).toBe(404);
      expect(calls).toBe(count);
      expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(before);
      writeFileSync(join(dir, "run.json"), "{}");
      expect((await fetch(url + "/api/runs/run_current/memory")).status).toBe(409);
      expect(calls).toBe(count);
    } finally { await new Promise<void>(resolve => web.server.close(() => resolve())); }
    const standalone = createWebServer(new RunStore(), "127.0.0.1", 0, artifacts);
    writePrivateJson(join(dir, "run.json"), run); sealArtifacts(dir);
    const standaloneUrl = (await standalone.listen()).url;
    try {
      const missingHook = await (await fetch(standaloneUrl + "/api/runs/run_current/memory")).json() as ProjectMemoryQuery;
      expect(missingHook.status).toBe("unavailable"); expect(missingHook.total).toBeNull();
    } finally { await new Promise<void>(resolve => standalone.server.close(() => resolve())); }
  });
});
