import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArtifactOptions } from "@canary/core";
import { safeArtifactPath, verifyArtifacts } from "./artifacts.js";

export interface RetentionPlan {
  v: 1;
  kind: "canary.retention";
  candidates: string[];
  protectedRuns: string[];
  retainedBytes: number;
  withinBudget: boolean;
}
function directoryBytes(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const file = join(dir, entry.name);
    if (entry.isSymbolicLink()) return sum;
    return sum + (entry.isDirectory() ? directoryBytes(file) : lstatSync(file).size);
  }, 0);
}
/** Opt-in only. Legacy, invalid, active runs and all retained lineage ancestors are protected. */
export function planRetention(
  root: string,
  policy: NonNullable<ArtifactOptions["retention"]>,
  protect: string[] = [],
  now = Date.now(),
): RetentionPlan {
  const rows = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => {
          const dir = safeArtifactPath(root, entry.name);
          const status = verifyArtifacts(dir).status;
          let startedAt = 0;
          let parents: string[] = [];
          try {
            const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
            startedAt = Date.parse(run.startedAt);
            const lineage = run.evidence?.lineage ?? run;
            parents = [lineage.replayOf, lineage.candidateOf, lineage.retryOf, lineage.recoveryOf].filter(
              (value): value is string => typeof value === "string" && value !== entry.name,
            );
            if (Array.isArray(run.checks)) for (const check of run.checks) if (typeof check.childRun?.runId === "string") parents.push(check.childRun.runId);
          } catch {
            /* unparseable evidence is protected */
          }
          return {
            id: entry.name,
            bytes: directoryBytes(dir),
            status,
            startedAt,
            parents,
            locked: existsSync(join(dir, "run.lock")) || existsSync(join(dir, "manifest.lock")),
          };
        })
        .sort((a, b) => b.startedAt - a.startedAt)
    : [];
  const protectedIds = new Set(protect);
  const candidates = new Set<string>();
  let count = 0;
  let bytes = 0;
  for (const row of rows) {
    const eligible =
      row.status === "verified" && !row.locked && Number.isFinite(row.startedAt) && !protectedIds.has(row.id);
    if (
      eligible &&
      ((policy.maxRuns !== undefined && count >= policy.maxRuns) ||
        (policy.maxAgeDays !== undefined && now - row.startedAt > policy.maxAgeDays * 86_400_000) ||
        (policy.maxBytes !== undefined && bytes + row.bytes > policy.maxBytes))
    )
      candidates.add(row.id);
    else {
      count++;
      bytes += row.bytes;
      if (!eligible) protectedIds.add(row.id);
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keepAncestors = (id: string): void => {
    for (const parent of byId.get(id)?.parents ?? []) {
      if (protectedIds.has(parent)) continue;
      protectedIds.add(parent);
      candidates.delete(parent);
      keepAncestors(parent);
    }
  };
  for (const row of rows) if (!candidates.has(row.id)) keepAncestors(row.id);
  const retained = rows.filter((row) => !candidates.has(row.id));
  const retainedBytes = retained.reduce((sum, row) => sum + row.bytes, 0);
  return {
    v: 1,
    kind: "canary.retention",
    candidates: [...candidates],
    protectedRuns: [...protectedIds].sort(),
    retainedBytes,
    withinBudget:
      (policy.maxBytes === undefined || retainedBytes <= policy.maxBytes) &&
      (policy.maxRuns === undefined || retained.length <= policy.maxRuns),
  };
}
export function applyRetention(root: string, plan: RetentionPlan): string[] {
  const base = resolve(root);
  const removed: string[] = [];
  if (!existsSync(base)) return removed;
  const referenced = new Set<string>();
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || plan.candidates.includes(entry.name)) continue;
    try {
      const dir = safeArtifactPath(base, entry.name);
      const source = existsSync(join(dir, "manifest.json"))
        ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).lineage
        : JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
      for (const id of [source.replayOf, source.candidateOf, source.retryOf, source.recoveryOf])
        if (typeof id === "string") referenced.add(id);
      const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
      if (Array.isArray(run.checks)) for (const check of run.checks) if (typeof check.childRun?.runId === "string") referenced.add(check.childRun.runId);
    } catch {
      /* invalid runs are never deleted */
    }
  }
  // Delete referrers before their dependencies. A project parent starts before its agent child,
  // so timestamp order alone could leave a retained parent pointing at an already deleted child.
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    try {
      const run = JSON.parse(readFileSync(join(safeArtifactPath(base, id), "run.json"), "utf8"));
      const lineage = run.evidence?.lineage ?? run;
      const dependencies = [lineage.replayOf, lineage.candidateOf, lineage.retryOf, lineage.recoveryOf, ...(Array.isArray(run.checks) ? run.checks.map((check: { childRun?: { runId?: string } }) => check.childRun?.runId) : [])];
      for (const dependency of dependencies) if (typeof dependency === "string" && plan.candidates.includes(dependency)) visit(dependency);
    } catch { /* integrity is rechecked before deletion */ }
    ordered.push(id);
  };
  for (const id of plan.candidates) visit(id);
  for (const id of ordered.reverse()) {
    const dir = safeArtifactPath(base, id);
    // Recheck immediately before deletion; never follow symlinks or delete outside the artifact collection.
    if (
      resolve(dir, "..") !== base ||
      referenced.has(id) ||
      plan.protectedRuns.includes(id) ||
      existsSync(join(dir, "run.lock")) ||
      existsSync(join(dir, "manifest.lock")) ||
      verifyArtifacts(dir).status !== "verified"
    )
      continue;
    const lock = safeArtifactPath(dir, "manifest.lock");
    const fd = openSync(lock, "wx");
    closeSync(fd);
    try {
      if (existsSync(join(dir, "run.lock")) || verifyArtifacts(dir).status !== "verified") continue;
      rmSync(dir, { recursive: true, force: false });
      removed.push(id);
    } finally {
      if (existsSync(lock)) unlinkSync(lock);
    }
  }
  return removed;
}
