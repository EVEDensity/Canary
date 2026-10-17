import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Script, runInNewContext } from "node:vm";
import type { QualityAssessmentView, RunSnapshot } from "@canary/core";
import { beginArtifacts, sealArtifacts, reviseArtifacts, writePrivateJson, FileArtifactRepository, RunStore, readQualityAssessment } from "@canary/trace";
import { createWebServer } from "../src/index.js";
import { qualityAssessmentClient } from "../src/quality-assessment-ui.js";
import { readCatalogs } from "../src/i18n.js";
import { renderWorkspace } from "../src/workspace-ui.js";
import { dashboardClient } from "../src/dashboard-ui.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-web-quality-")), id = "run_quality", dir = join(root, id);
  const run: RunSnapshot = {
    runId: id, status: "failed", startedAt: "2026-10-17T00:00:00Z", totalCases: 0, completedCases: 0, passedCases: 0, results: [], events: [],
    checks: [{ id: "unit", type: "command", version: 1, required: true, status: "failed", evidence: "verified", exitCode: 1, category: "assertion", retryable: true, durationMs: 5 }],
  };
  const seal = () => { beginArtifacts(dir); writePrivateJson(join(dir, "run.json"), run); sealArtifacts(dir); };
  seal();
  return { root, dir, id, run, seal, repository: new FileArtifactRepository(root) };
}
function inventory(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else entries[relative(root, path)] = readFileSync(path, "utf8"); } };
  walk(root); return entries;
}

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  id = ""; value = ""; disabled = false; open = false; required = false; maxLength = 0; isConnected = true; focused = false;
  styleValues: Record<string, string> = {};
  style = { setProperty: (key: string, value: string) => { this.styleValues[key] = value; } };
  classList = { add: () => {} };
  onclick?: () => Promise<void>; oninput?: () => void; ontoggle?: () => void;
  constructor(readonly tag: string, private content = "", readonly className = "") {}
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  get textContent(): string { return this.content + this.children.map(node => node.textContent).join(" "); }
  set textContent(value: string) { this.content = value; this.children = []; }
  querySelectorAll() { return nodes(this); }
  scrollIntoView() {}
  focus() { this.focused = true; }
}
function nodes(node: Element): Element[] { return [node, ...node.children.flatMap(nodes)]; }
function client() {
  const root = new Element("section"); root.id = "quality-assessment";
  const calls: Array<{ path: string; body?: unknown }> = [], pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [], navigations: string[] = [];
  const catalogs = readCatalogs();
  const context = {
    selected: "run_quality", current: { runId: "run_quality" }, tab: "overview", canaryLocale: "en", settings: { token: "test-token" },
    document: { createElement: (tag: string) => new Element(tag) },
    text: (tag: string, value = "", cls = "") => new Element(tag, value, cls),
    button: (label: string, action: () => Promise<void>, cls = "") => Object.assign(new Element("button", label, cls), { onclick: action }),
    $: (id: string) => nodes(root).find(node => node.id === id),
    t: (key: string) => catalogs[context.canaryLocale]![key] ?? key,
    tm: (key: string) => catalogs[context.canaryLocale]![key] ?? key,
    tfmt: (key: string, values: Record<string, unknown>) => (catalogs[context.canaryLocale]![key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name])),
    api: (path: string, body?: unknown) => { calls.push({ path, body }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    date: (value: string) => value, select: async (id: string) => { context.selected = id; navigations.push(id); },
    showTab: (tab: string) => navigations.push(tab), openCheckDrawer: (_run: unknown, id: string) => navigations.push(id),
  };
  const control = runInNewContext(qualityAssessmentClient + "\n({load:qualityLoad,sync:qualitySync,draw:qualityDraw,decide:qualityDecide,reset:qualityInvalidate})", context) as {
    load: (id: string, force?: boolean) => Promise<void>; sync: (run: unknown) => void; draw: () => void; decide: (optionId: string, action: string) => Promise<void>; reset: () => void;
  };
  return { root, calls, pending, context, control, navigations };
}
function enter(f: ReturnType<typeof client>, id: string, value: string) { const field = nodes(f.root).find(node => node.id === id)!; field.value = value; field.oninput!(); }

describe("quality assessment HTTP contract", () => {
  it("reads without creating files; requires same-origin write authority and a complete strict decision", async () => {
    const f = fixture(), before = inventory(f.root), web = createWebServer(new RunStore(), "127.0.0.1", 0, f.root, { writeToken: "test-token" }), { url } = await web.listen();
    const path = url + "/api/runs/" + f.id + "/assessment";
    const post = (body: unknown, token?: string, origin?: string) => fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-canary-write-token": token } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    try {
      const response = await fetch(path), view = await response.json() as QualityAssessmentView;
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(inventory(f.root)).toEqual(before); expect(readdirSync(f.root)).not.toContain(".quality");
      expect(view.report.options.length).toBeGreaterThan(1);
      const input = { reportHash: view.report.contentHash, expectedRevision: view.revision, optionId: view.report.options[0]!.id, action: "select", actor: "maintainer", reason: "Preserve original assertions" };
      expect((await post(input)).status).toBe(403); expect((await post(input, "wrong")).status).toBe(403);
      expect((await post(input, "test-token", "https://example.invalid")).status).toBe(403);
      expect((await post({ ...input, execute: true }, "test-token")).status).toBe(400);
      expect((await post({ ...input, actor: "" }, "test-token")).status).toBe(400);
      expect(inventory(f.root)).toEqual(before);
      const accepted = await post(input, "test-token"), chosen = await accepted.json() as QualityAssessmentView;
      expect(accepted.status).toBe(200); expect(accepted.headers.get("cache-control")).toBe("no-store"); expect(chosen.revision).toBe(1);
      expect(chosen.decisions[0]).toMatchObject({ action: "select", executionGranted: false, verificationStatus: "not-executed", actor: "maintainer", stale: false });
      expect(f.repository.verify(f.id).status).toBe("verified");
      const stale = await post(input, "test-token"); expect(stale.status).toBe(409); expect((await stale.json() as { code: string }).code).toBe("QUALITY_STALE");
      const rejected = await post({ ...input, expectedRevision: 1, optionId: view.report.options[1]!.id, action: "reject", reason: "Review the contract first" }, "test-token");
      expect(rejected.status).toBe(200); expect((await rejected.json() as QualityAssessmentView).decisions.map(choice => choice.action)).toEqual(["select", "reject"]);
      const after = inventory(f.root); for (const [name, value] of Object.entries(before)) expect(after[name]).toBe(value);
      expect((await fetch(path, { method: "DELETE" })).status).toBe(405);
      expect((await fetch(path + "?execute=true")).status).toBe(400);
      expect((await fetch(path + "/unexpected")).status).toBe(405);
    } finally { await new Promise<void>(resolve => web.server.close(() => resolve())); }
  });
  it("rejects a choice bound to an old report after sealed evidence changes", async () => {
    const f = fixture(), view = readQualityAssessment(f.repository, f.id), web = createWebServer(new RunStore(), "127.0.0.1", 0, f.root, { writeToken: "test-token" }), { url } = await web.listen();
    f.run.checks![0]!.category = "dependency"; reviseArtifacts(f.dir, () => writePrivateJson(join(f.dir, "run.json"), f.run));
    try {
      const response = await fetch(url + "/api/runs/" + f.id + "/assessment", { method: "POST", headers: { "content-type": "application/json", "x-canary-write-token": "test-token" }, body: JSON.stringify({ reportHash: view.report.contentHash, expectedRevision: 0, optionId: view.report.options[0]!.id, action: "select", actor: "maintainer", reason: "Act on the old report" }) });
      expect(response.status).toBe(409); expect(response.headers.get("cache-control")).toBe("no-store"); expect((await response.json() as { code: string }).code).toBe("QUALITY_STALE");
      expect(readdirSync(f.root)).not.toContain(".quality");
    } finally { await new Promise<void>(resolve => web.server.close(() => resolve())); }
  });
});

describe("guided quality workspace", () => {
  it("loads only when opened, caches polling and localizes recommendations without translating evidence", async () => {
    const view = readQualityAssessment(fixture().repository, "run_quality"), f = client(), run = { runId: "run_quality", status: "failed" };
    view.report.issues[0]!.observation = "原始断言错误 at src/value.ts:3";
    f.control.sync(run); expect(f.calls).toEqual([]);
    f.context.tab = "improve"; f.control.sync(run); expect(f.calls).toHaveLength(1);
    f.pending.shift()!.resolve(view); await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.root.textContent).toContain("Recommended option"); expect(f.root.textContent).toContain("原始断言错误");
    expect(f.root.textContent).toContain("After confirming the contract");
    enter(f, "quality-actor", "maintainer"); enter(f, "quality-reason", "Keep original checks");
    const actor = nodes(f.root).find(node => node.id === "quality-actor"); f.control.sync(run); expect(nodes(f.root).find(node => node.id === "quality-actor")).toBe(actor); expect(f.calls).toHaveLength(1);
    f.context.canaryLocale = "zh-CN"; f.control.draw();
    expect(f.root.textContent).toContain("推荐方案"); expect(f.root.textContent).toContain("确认契约后"); expect(f.root.textContent).not.toContain("After confirming the contract"); expect(f.root.textContent).toContain("原始断言错误");
    expect(nodes(f.root).find(node => node.id === "quality-reason")!.value).toBe("Keep original checks"); expect(f.calls).toHaveLength(1);
    const evidence = nodes(f.root).find(node => node.tag === "button" && node.textContent === "unit")!; await evidence.onclick!(); expect(f.navigations).toEqual(["checks", "unit"]);
  });
  it("requires actor/reason, prevents duplicate submissions and preserves selection history without granting execution", async () => {
    const view = readQualityAssessment(fixture().repository, "run_quality"), f = client(), loading = f.control.load("run_quality"); f.pending.shift()!.resolve(view); await loading;
    const option = view.report.options[0]!;
    expect(nodes(f.root).find(node => node.id === "quality-fields-panel")!.open).toBe(false);
    await f.control.decide(option.id, "select"); expect(f.calls).toHaveLength(1); expect(f.root.textContent).toContain("Enter an operator");
    expect(nodes(f.root).find(node => node.id === "quality-fields-panel")!.open).toBe(true); expect(nodes(f.root).find(node => node.id === "quality-actor")!.focused).toBe(true);
    enter(f, "quality-actor", "maintainer");
    await f.control.decide(option.id, "select"); expect(f.calls).toHaveLength(1); expect(nodes(f.root).find(node => node.id === "quality-reason")!.focused).toBe(true);
    f.context.canaryLocale = "zh-CN"; f.control.draw(); expect(nodes(f.root).find(node => node.id === "quality-fields-panel")!.open).toBe(true); expect(nodes(f.root).find(node => node.id === "quality-actor")!.value).toBe("maintainer"); f.context.canaryLocale = "en"; f.control.draw(); enter(f, "quality-reason", "Fix the original failure");
    const saving = f.control.decide(option.id, "select"); await f.control.decide(option.id, "select"); expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.body).toEqual({ reportHash: view.report.contentHash, expectedRevision: 0, optionId: option.id, action: "select", actor: "maintainer", reason: "Fix the original failure" });
    const saved = { ...view, revision: 1, selections: [{ issueId: option.issueId, optionId: option.id, revision: 1 }], decisions: [{ reportHash: view.report.contentHash, optionId: option.id, action: "select", actor: "maintainer", reason: "Fix the original failure", revision: 1, at: "2026-10-17T00:00:01Z", stale: false, executionGranted: false, verificationStatus: "not-executed" }] };
    f.pending.shift()!.resolve(saved); await saving;
    expect(f.root.textContent).toContain("Choice history"); expect(f.root.textContent).toContain("Recorded · Not executed"); expect(f.root.textContent).toContain("Choice recorded; not executed"); expect(f.root.textContent).toContain("Fix the original failure");
    const failing = f.control.decide(option.id, "reject"); f.pending.shift()!.reject(new Error("QUALITY_STALE")); await failing;
    expect(f.root.textContent).toContain("refresh the brief"); expect(f.root.textContent).toContain("Choice history");
    const refreshed = f.control.load("run_quality", true); f.pending.shift()!.resolve({ ...saved, selections: [], omittedDecisions: 3, decisions: [{ ...saved.decisions[0], stale: true }] }); await refreshed;
    expect(f.root.textContent).toContain("3 earlier choices are not shown"); expect(f.root.textContent).toContain("revalidation required");
  });
  it("uses the authoritative current direction even when earlier selections were omitted from visible history", async () => {
    const view = readQualityAssessment(fixture().repository, "run_quality"), f = client(), first = view.report.options[0]!, second = view.report.options[1]!;
    const selected = { ...view, omittedDecisions: 4, selections: [{ issueId: second.issueId, optionId: second.id, revision: 2 }], decisions: [{ reportHash: view.report.contentHash, optionId: first.id, action: "select", actor: "maintainer", reason: "Earlier direction", revision: 1, at: "2026-10-17T00:00:01Z", stale: false, executionGranted: false, verificationStatus: "not-executed" }] };
    const loading = f.control.load("run_quality"); f.pending.shift()!.resolve(selected); await loading;
    const cards = nodes(f.root).filter(node => node.className === "quality-option");
    expect(cards.filter(card => card.dataset.selected === "true").map(card => card.dataset.optionId)).toEqual([second.id]);
    expect(cards.find(card => card.dataset.optionId === first.id)!.textContent).not.toContain("Choice recorded; not executed");
    expect(cards.find(card => card.dataset.optionId === second.id)!.textContent).toContain("Choice recorded; not executed");
    expect(f.root.textContent).toContain("Earlier direction"); expect(f.root.textContent).toContain("4 earlier choices are not shown");
  });
  it("ignores late responses after switching runs and disables writes in read-only sessions", async () => {
    const view = readQualityAssessment(fixture().repository, "run_quality"), f = client(), loading = f.control.load("run_quality");
    f.context.selected = "run_other"; f.control.reset(); f.pending.shift()!.resolve(view); await loading; expect(f.root.textContent).toBe("");
    f.context.selected = "run_quality"; f.context.settings.token = ""; const second = f.control.load("run_quality"); f.pending.shift()!.resolve(view); await second;
    expect(f.root.textContent).toContain("read-only"); expect(nodes(f.root).filter(node => node.tag === "button" && /Choose this|Reject this/.test(node.textContent)).every(node => node.disabled)).toBe(true);
    const html = renderWorkspace("test-token"), script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!; expect(() => new Script(script)).not.toThrow();
  });
});

function coverageClient(locale = "en") {
  const elements = Object.fromEntries(["dashboard-coverage", "coverage-preview", "coverage-content"].map(id => [id, new Element("div")]));
  const catalog = readCatalogs()[locale]!;
  const text = (tag: string, value = "", cls = "") => new Element(tag, value, cls);
  const functions = ["coverageReading", "barRow", "renderDashboardCoverage"].map(name => dashboardClient.match(new RegExp("^function " + name + "\\(.*$", "m"))![0]).join("\n");
  const workspace = renderWorkspace().match(/^function renderCoverage\(run\).*$/m)![0];
  const context = {
    $: (id: string) => elements[id], text, document: { createElement: (tag: string) => text(tag) },
    t: (key: string) => catalog[key] ?? key, tm: (key: string) => catalog[key] ?? key,
    labels: { final: "Final", partial: "Partial", unavailable: "Unavailable" }, precisionLabel: (key: string) => key,
    button: (label: string) => text("button", label), empty: (id: string, value: string) => elements[id]!.replaceChildren(text("div", value)),
  };
  const control = runInNewContext(functions + "\n" + workspace + "\n({dashboard:renderDashboardCoverage,workspace:renderCoverage})", context) as { dashboard: (run: unknown) => void; workspace: (run: unknown) => void };
  return { elements, control };
}
function coverageRun(status = "final", precision?: string) {
  const measured = { covered: 1, total: 2, pct: 50 }, zero = { covered: 0, total: 0, pct: 0 };
  const file = { filePath: "src/value.ts", status: "final", quality: { precision: precision ?? "exact" }, lines: measured, statements: measured, functions: measured, branches: zero };
  return { kind: "agent", coverageSources: [{ runId: "run_quality", scope: "agent", coverage: { status, lines: measured, statements: measured, functions: measured, branches: zero, files: precision ? [file] : [], featureChains: [] } }] };
}

describe("coverage display evidence boundaries", () => {
  it("shows a zero denominator as unknown with its denominator and no filled progress, while preserving genuine zero coverage", () => {
    const f = coverageClient(), run = coverageRun(); f.control.dashboard(run); f.control.workspace(run);
    const rows = f.elements["dashboard-coverage"]!.children.filter(node => node.className === "bar-row"), branch = rows[3]!;
    expect(branch.textContent).toContain("Unknown"); expect(branch.textContent).toContain("0 / 0"); expect(branch.children[1]!.children).toHaveLength(0);
    expect(rows[0]!.textContent).toContain("50%"); expect(rows[0]!.children[1]!.children).toHaveLength(1);
    expect(f.elements["coverage-content"]!.textContent).toContain("Branches Unknown 0 / 0");
    const c = run.coverageSources[0]!.coverage; c.branches.total = 2; f.control.dashboard(run);
    const genuineZero = f.elements["dashboard-coverage"]!.children[3]!;
    expect(genuineZero.textContent).toContain("0%"); expect(genuineZero.textContent).toContain("0 / 2"); expect(genuineZero.children[1]!.children).toHaveLength(1);
    c.lines = { covered: 0, total: 0, pct: 0 }; f.control.workspace(run);
    const ring = f.elements["coverage-preview"]!.children[0]!; expect(ring.textContent).toContain("Unknown"); expect(ring.textContent).toContain("0 / 0"); expect(ring.styleValues["--pct"]).toBeUndefined();
  });
  it("keeps partial, unavailable and approximate measurements uncertain in both overview and detailed metrics", () => {
    for (const [status, precision] of [["partial", undefined], ["unavailable", undefined], ["provisional", undefined], ["final", "approximate"], ["final", "unknown"]]) {
      const f = coverageClient("zh-CN"), run = coverageRun(status, precision); f.control.dashboard(run); f.control.workspace(run);
      const rows = f.elements["dashboard-coverage"]!.children.filter(node => node.className === "bar-row");
      expect(rows).toHaveLength(4); expect(rows.every(row => row.dataset.measurement === "unknown" && row.children[1]!.children.length === 0)).toBe(true);
      expect(rows[0]!.textContent).toContain("未知"); expect(rows[0]!.textContent).toContain("1 / 2");
      expect(f.elements["coverage-content"]!.textContent).not.toContain("50%"); expect(f.elements["coverage-preview"]!.textContent).toContain("未知");
    }
  });
});
