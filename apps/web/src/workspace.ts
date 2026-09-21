import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CoverageSummary, RunSnapshot } from "@canary/core";
import {
  ArtifactIntegrityError,
  FileArtifactRepository,
  RunStore,
  readArtifactManifest,
  safeArtifactPath,
} from "@canary/trace";
import {
  gateIssues,
  issueFromCheck,
  linkVerification,
  type ProjectIssue,
  type RetryCandidate,
} from "./project-issues.js";

function summary(run: RunSnapshot) {
  return {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    kind: run.checks ? "project" : "agent",
    total: run.totalCases,
    completed: run.completedCases,
    passed: run.passedCases,
    retryOf: run.retryOf,
    replayOf: run.replayOf,
    checkIds: run.checks?.map((check) => check.id) ?? [],
    caseIds: run.results?.map((result) => result.caseId) ?? [],
    childRuns: (run.checks ?? []).flatMap((check) =>
      check.childRun ? [{ runId: check.childRun.runId, checkId: check.id }] : [],
    ),
  };
}
function compactCoverage(value?: CoverageSummary) {
  if (!value) return undefined;
  return {
    ...value,
    files: value.files?.map((file) => ({
      ...file,
      source: undefined,
      uncoveredLocations: file.uncoveredLocations?.slice(0, 30),
    })),
  };
}

/** Small history index; traces are read only when a user selects a run. */
export class WorkspaceReader {
  private headers = new Map<string, { stamp: string; value: ReturnType<typeof summary> }>();
  constructor(
    private store: RunStore,
    private repository?: FileArtifactRepository,
  ) {}
  list(limit = 100) {
    const rows = new Map<string, ReturnType<typeof summary>>();
    const root = this.repository?.rootDir;
    if (root && existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
        try {
          const file = join(root, entry.name, "run.json"),
            stat = statSync(file);
          if (stat.size > 64 * 1024 * 1024) continue;
          const stamp = `${stat.mtimeMs}:${stat.size}`;
          let cached = this.headers.get(entry.name);
          if (cached?.stamp !== stamp) {
            const raw = JSON.parse(readFileSync(file, "utf8"));
            if (raw.runId !== entry.name || typeof raw.startedAt !== "string") continue;
            cached = { stamp, value: summary(raw) };
            this.headers.set(entry.name, cached);
          }
          rows.set(entry.name, cached.value);
        } catch {
          /* A half-written run is not a usable history entry. */
        }
      }
    }
    for (const run of this.store.list()) rows.set(run.runId, summary(run));
    return this.store.sanitize(
      [...rows.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit),
    );
  }
  private retries(): RetryCandidate[] {
    const rows = this.list(Number.MAX_SAFE_INTEGER);
    const known = new Set(rows.map((row) => row.runId));
    const retries: RetryCandidate[] = rows.filter((row) => row.retryOf);
    const root = this.repository?.rootDir;
    if (root && existsSync(root))
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || known.has(entry.name)) continue;
        try {
          // The manifest can still identify a retry whose run.json was half-written.
          // This is a discovery hint only; linkVerification always verifies content.
          const manifest = readArtifactManifest(safeArtifactPath(root, entry.name));
          if (manifest?.lineage.retryOf)
            retries.push({
              runId: entry.name,
              retryOf: manifest.lineage.retryOf,
              startedAt: manifest.createdAt,
              checkIds: [],
            });
        } catch {
          /* Unreadable metadata never supplies a verified result. */
        }
      }
    return retries;
  }
  read(id: string) {
    const integrity = this.repository?.verify(id);
    if (integrity?.status === "invalid") throw new ArtifactIntegrityError(integrity);
    const run = this.store.get(id) ?? this.repository?.readRun(id);
    if (!run) return undefined;
    const issues: ProjectIssue[] = [...gateIssues(run)];
    const retryRuns = run.checks?.some((check) => check.status === "failed" || check.status === "blocked")
      ? this.retries()
      : [];
    const loaded = new Map<string, RunSnapshot | undefined>();
    const loadRetry = (runId: string) => {
      if (!loaded.has(runId)) loaded.set(runId, this.store.get(runId) ?? this.repository?.readRun(runId));
      return loaded.get(runId);
    };
    for (const check of run.checks ?? []) {
      if (check.status === "failed" || check.status === "blocked")
        issues.push(linkVerification(issueFromCheck(id, check), run, retryRuns, this.repository, loadRetry));
    }
    const sources: {
      runId: string;
      checkId?: string;
      scope: string;
      coverage?: ReturnType<typeof compactCoverage>;
      error?: string;
    }[] = [];
    const coverage = run.coverage ?? this.repository?.readCoverage(id);
    if (coverage)
      sources.push({ runId: id, scope: "当前 Agent 配置声明的文件范围", coverage: compactCoverage(coverage) });
    for (const check of run.checks ?? []) {
      if (!check.childRun || !this.repository) continue;
      // Resolve only by ID within this project's repository; never trust an embedded absolute path.
      try {
        const verified = this.repository.verify(check.childRun.runId);
        if (verified.status !== "verified" || verified.manifestHash !== check.childRun.manifestHash)
          throw new Error("Unverified child evidence");
        const child = this.repository.readRun(check.childRun.runId);
        if (child) {
          issues.push(...gateIssues(child));
          for (const result of child.results.filter((result) => !result.passed))
            issues.push({
              id: `${child.runId}:case:${result.caseId}`,
              runId: child.runId,
              category: "agent",
              title: result.caseId,
              summary:
                result.assertions.find((a) => !a.passed)?.message ?? result.failureCategory ?? "Agent 用例未通过",
              advice: "进入关联用例检查断言和轨迹，修复后重新评估。",
              target: "cases",
              status: "open",
            });
        }
        sources.push({
          runId: check.childRun.runId,
          checkId: check.id,
          scope: "Agent 子运行 · 仅覆盖其配置声明的文件",
          coverage: compactCoverage(child?.coverage ?? this.repository.readCoverage(check.childRun.runId)),
        });
      } catch {
        issues.push({
          id: `${id}:artifact:${check.id}`,
          runId: id,
          checkId: check.id,
          category: "artifact",
          title: check.id,
          summary: "子运行证据缺失、损坏或谱系不匹配",
          advice: "重新生成并核验关联 Agent 证据。",
          target: "coverage",
          status: "open",
        });
        sources.push({
          runId: check.childRun.runId,
          checkId: check.id,
          scope: "Agent 子运行",
          error: "子运行证据缺失、损坏或谱系不匹配",
        });
      }
    }
    return this.store.sanitize({
      ...summary(run),
      issues,
      activeCheck: run.activeCheck,
      checks: run.checks,
      coverageSources: sources,
      integrity,
      evidence: run.evidence,
      gate: run.gate,
      capabilities: { project: Boolean(run.checks) },
      cases: run.results.map((result) => ({
        caseId: result.caseId,
        executionId: result.executionId,
        passed: result.passed,
        failureCategory: result.failureCategory,
        metrics: result.metrics,
        assertions: result.assertions,
        trajectoryId: result.trajectoryId,
      })),
      timeline: run.events.slice(-60).map((event) => ({ type: event.type, at: "at" in event ? event.at : undefined })),
      improvements: run.improvements ?? this.repository?.readJson(id, "improvement.json") ?? [],
    });
  }
}
