import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveChangeSummary,
  type ChangeFileAssessment,
  type ChangeVerificationV2,
  type RunSnapshot,
} from "@canary/core";
import { beginArtifacts, sealArtifacts, writePrivateJson, RunStore, stableHash } from "@canary/trace";
import { changeVerificationClient } from "../src/change-verification-ui.js";
import { readCatalogs } from "../src/i18n.js";
import { createWebServer } from "../src/index.js";

const hash = "a".repeat(64),
  commit = "b".repeat(40);
const unknown = { covered: null, total: null };
function executionSource(runId: string) {
  const fingerprint = {
    commit,
    sourceHash: hash,
    indexHash: hash,
    trackedStatusHash: hash,
    trackedFilesHash: hash,
    commitMatches: true,
  };
  return {
    v: 1,
    kind: "canary.execution-source",
    runId,
    status: "unchanged",
    projectPath: ".",
    before: fingerprint,
    after: fingerprint,
  };
}
function receipt(runId = "run_change"): ChangeVerificationV2 {
  const file: ChangeFileAssessment = {
    path: "src/value.ts",
    status: "modified",
    changedLines: [3, 4],
    execution: {
      status: "measured",
      lines: { covered: 1, total: 2 },
      functions: { covered: 1, total: 1 },
      branches: unknown,
      reasons: ["Branch source mapping unavailable"],
    },
    uncovered: { lines: [4], functions: [], branches: [] },
    nodes: [{ id: "file_value", kind: "file", line: 1 }],
    behavior: "unknown",
    contracts: [],
    failureEvidence: [],
    interpretation: "Execution coverage does not establish behavior verification",
  };
  const second: ChangeFileAssessment = {
    ...file,
    path: "src/unknown.py",
    status: "unsupported",
    changedLines: [],
    execution: {
      status: "unknown",
      lines: unknown,
      functions: unknown,
      branches: unknown,
      reasons: ["No reliable source mapping"],
    },
    uncovered: { lines: [], functions: [], branches: [] },
    nodes: [],
  };
  const source = {
    status: "verified" as const,
    projectPath: ".",
    sourceHash: hash,
    configHash: hash,
    executionSourceHash: stableHash(executionSource(runId)),
    reasons: [],
  };
  return {
    v: 2,
    kind: "canary.change-verification",
    runId,
    baseline: "c".repeat(40),
    commit,
    manifestHash: hash,
    source,
    files: [file, second],
    contracts: [],
    summary: deriveChangeSummary([file, second], source),
    assessment: "analyzed",
    limitations: [],
    checks: { planned: 1, executed: 1, passed: 1, failed: 0, blocked: 0, excluded: 0, omitted: 0, missing: 0 },
  };
}
class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  onclick?: () => Promise<void>;
  isConnected = true;
  constructor(
    readonly tag: string,
    readonly value = "",
    readonly className = "",
  ) {}
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  get textContent(): string {
    return this.value + this.children.map((node) => node.textContent).join(" ");
  }
  scrollIntoView() {}
}
function render(report: unknown, locale = "en") {
  const catalog = readCatalogs()[locale]!;
  const text = (tag: string, value = "", className = "") => new Element(tag, value, className);
  const navigation: unknown[] = [];
  const sourceCalls: Array<{ nodeId: string; line: number; kind: string }> = [];
  const context = {
    document: { createElement: text },
    text,
    button: (value: string, action: () => Promise<void>, className: string) =>
      Object.assign(text("button", value, className), { onclick: action }),
    t: (key: string) => catalog[key] ?? key,
    tfmt: (key: string, values: Record<string, unknown>) =>
      (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name])),
    selected: "run_change",
    showTab: (tab: string) => navigation.push(tab),
    renderArchitecture: async () => {},
    architectureRunId: "run_change",
    architectureIndex: { byId: new Map([["file_value", { id: "file_value" }]]) },
    architectureFocus: (id: string) => navigation.push(id),
    architectureSource: async (node: { id: string }, _box: unknown, line: number, kind: string) => {
      navigation.push(line);
      sourceCalls.push({ nodeId: node.id, line, kind });
    },
    $: text,
  };
  return {
    node: runInNewContext(changeVerificationClient + "\nchangeVerificationView(report,'run_change')", {
      ...context,
      report,
    }) as Element,
    navigation,
    sourceCalls,
  };
}
function descendants(node: Element): Element[] {
  return [node, ...node.children.flatMap(descendants)];
}
function visibleText(node: Element): string {
  return (
    node.value +
    (node.tag === "details" ? node.children.filter((child) => child.tag === "summary") : node.children)
      .map(visibleText)
      .join(" ")
  );
}

describe("sealed change verification workspace", () => {
  it("keeps changed execution denominators separate from unknown files and explicit behavior", async () => {
    const { node, navigation } = render(receipt());
    expect(node.textContent).toContain("Changed lines 1 / 2 Unknown files 1");
    expect(node.textContent).toContain("Added 0 · Modified 1 · Deleted 0 · Unanalyzed 1");
    expect(node.textContent).toContain("Changed branches Unknown Unknown files 2");
    expect(node.textContent).toContain("Explicit behavior · Files Verified 0 Failed 0 Unknown 2");
    expect(node.textContent).not.toContain("100%");
    expect(node.textContent).toContain("Changed lines not executed");
    await descendants(node).find((item) => item.tag === "button")!.onclick!();
    expect(navigation).toEqual(["structure", "file_value", 4]);
    expect(render(receipt(), "zh-CN").node.textContent).toContain("显式行为 · 文件数");
  });
  it("opens sealed source at the changed scope when a branch gap has no exact source line", async () => {
    const report = receipt(),
      file = report.files[0]!;
    file.changedLines = [2];
    file.execution.lines = { covered: 0, total: 1 };
    file.uncovered.lines = [2];
    file.execution.branches = { covered: 0, total: 1 };
    file.uncovered.branches = ["branch_missing"];
    report.summary = deriveChangeSummary(report.files, report.source);
    const { node, sourceCalls } = render(report);
    const gap = descendants(node).find(
      (item) => item.className === "change-gap" && item.textContent.includes("Changed branches not executed"),
    )!;
    await descendants(gap).find((item) => item.tag === "button")!.onclick!();
    expect(sourceCalls).toEqual([{ nodeId: "file_value", line: 2, kind: "gap" }]);
  });
  it("withholds quantities for historical and unmatched source receipts", () => {
    const legacy = render({ ...receipt(), v: 1 }).node.textContent;
    expect(legacy).toContain("quantitative conclusions are unknown");
    expect(legacy).not.toContain("1 / 2");
    const report = receipt();
    report.source.status = "unavailable";
    report.source.reasons = ["Execution source changed during the run"];
    report.assessment = "evidence-insufficient";
    const unmatched = render(report).node.textContent;
    expect(unmatched).toContain("Execution source changed during the run");
    expect(unmatched).not.toContain("1 / 2");
    expect(render({ outcome: "evidence-insufficient", reasons: ["Git input unavailable"] }).node.textContent).toContain(
      "Git input unavailable",
    );
    const chinese = render(report, "zh-CN").node;
    expect(visibleText(chinese)).toContain("源码证据未匹配");
    expect(visibleText(chinese)).toContain("原始技术证据");
    expect(visibleText(chinese)).not.toContain("Execution source changed during the run");
    expect(chinese.textContent).toContain("Execution source changed during the run");
  });
  it("localizes every authored gap explanation while preserving the original receipt", () => {
    const report = receipt(),
      original = JSON.stringify(report);
    const chinese = render(report, "zh-CN").node;
    expect(chinese.textContent).toContain("未执行 1 / 2");
    expect(chinese.textContent).toContain("未知维度：分支");
    expect(chinese.textContent).not.toContain("were not executed");
    expect(chinese.textContent).not.toContain("Execution evidence is unknown");
    expect(chinese.textContent).not.toContain("No maintainer-declared");
    expect(JSON.stringify(report)).toBe(original);
    const gaps = [
      { kind: "source-unavailable", reason: "Execution source identity could not be established" },
      { kind: "deleted-source", reason: "Deleted source has no execution measurement at this revision" },
      { kind: "unsupported-source", reason: "Source cannot be analyzed reliably" },
      { kind: "unverified-contract", reason: "An applicable declared behavior assertion has insufficient evidence" },
      { kind: "failed-contract", reason: "An applicable declared behavior assertion failed" },
      { kind: "observed-failure", reason: "Recorded failure evidence refers to this file" },
      { kind: "coverage-conflict", reason: "Conflicting coverage evidence was not combined" },
    ];
    for (const gap of gaps) {
      report.summary.gaps = [
        { ...gap, kind: gap.kind as (typeof report.summary.gaps)[number]["kind"], path: "src/value.ts" },
      ];
      const localized = render(report, "zh-CN").node.textContent;
      expect(localized).not.toContain(gap.reason);
      expect(localized).toMatch(/[\u3400-\u9fff]/);
      expect(render(report).node.textContent).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
  it("serves only schema-valid receipts bound to the selected sealed source without reading current files", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-web-change-"));
    const variants = [
      "valid",
      "wrong-run",
      "wrong-commit",
      "wrong-source",
      "wrong-config",
      "wrong-proof",
      "missing-proof",
      "wrong-summary",
      "legacy",
      "unavailable",
    ];
    for (const variant of variants) {
      const id = "run_" + variant,
        dir = join(root, id);
      const run: RunSnapshot = {
        runId: id,
        status: "completed",
        startedAt: "2026-10-16T00:00:00Z",
        totalCases: 0,
        completedCases: 0,
        passedCases: 0,
        results: [],
        events: [],
        checks: [],
        evidence: {
          v: 1,
          lineage: {},
          reproduction: {
            configHash: hash,
            casesHash: hash,
            sourceHash: hash,
            node: "v24",
            platform: "test",
            arch: "test",
            gitCommit: commit,
            gitDirty: false,
            projectPath: ".",
            lockfiles: {},
            environmentHash: hash,
            environmentNames: [],
            mode: "recorded",
          },
        },
      };
      const report = receipt(id);
      if (variant === "wrong-run") report.runId = "run_other";
      if (variant === "wrong-commit") report.commit = "d".repeat(40);
      if (variant === "wrong-source") report.source.sourceHash = "e".repeat(64);
      if (variant === "wrong-config") report.source.configHash = "e".repeat(64);
      if (variant === "wrong-proof") report.source.executionSourceHash = "e".repeat(64);
      if (variant === "wrong-summary") report.summary.execution.lines.covered = 2;
      beginArtifacts(dir);
      writePrivateJson(join(dir, "run.json"), run);
      if (variant !== "missing-proof") writePrivateJson(join(dir, "execution-source.json"), executionSource(id));
      writePrivateJson(
        join(dir, "change-verification.json"),
        variant === "legacy"
          ? { ...report, v: 1 }
          : variant === "unavailable"
            ? { v: 1, kind: "canary.change-verification-unavailable", runId: id, reason: "Git input unavailable" }
            : report,
      );
      sealArtifacts(dir);
    }
    const web = createWebServer(new RunStore(), "127.0.0.1", 0, root),
      { url } = await web.listen();
    try {
      for (const variant of variants) {
        const response = await fetch(url + "/api/runs/run_" + variant + "/change-verification");
        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        if (variant === "valid") expect(body).toEqual(receipt("run_valid"));
        else if (variant === "legacy") expect(body.v).toBe(1);
        else {
          expect(body.outcome).toBe("evidence-insufficient");
          expect(body.summary).toBeUndefined();
        }
      }
    } finally {
      await new Promise<void>((resolve) => web.server.close(() => resolve()));
    }
  });
});
