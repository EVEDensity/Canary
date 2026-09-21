import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./lib/evidence-output.mjs";

function size(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    if (entry.isSymbolicLink()) return sum;
    const path = join(dir, entry.name);
    return sum + (entry.isDirectory() ? size(path) : lstatSync(path).size);
  }, 0);
}
export function logStatus(root = join(repositoryRoot, ".canary/logs"), now = Date.now()) {
  const base = resolve(root),
    runs = [];
  function visit(dir) {
    if (lstatSync(dir).isSymbolicLink()) return;
    if (existsSync(join(dir, "result.json"))) {
      try {
        const metadata = lstatSync(join(dir, "result.json"));
        if (metadata.isSymbolicLink() || metadata.size > 1_000_000) return;
        const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
        if (result.kind === "canary.local-log") {
          const completed =
            ["passed", "failed", "interrupted"].includes(result.status) &&
            Number.isFinite(Date.parse(result.finishedAt));
          runs.push({
            path: relative(base, dir),
            bytes: size(dir),
            finishedAt: result.finishedAt,
            protected: !completed || existsSync(join(dir, "run.lock")),
          });
        }
      } catch {
        /* Unknown or incomplete logs are never eligible. */
      }
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(join(dir, entry.name));
  }
  if (existsSync(base) && !lstatSync(base).isSymbolicLink()) visit(base);
  runs.sort((a, b) => String(b.finishedAt ?? "").localeCompare(String(a.finishedAt ?? "")));
  const candidates = runs.filter(
    (run, i) => !run.protected && (i >= 20 || now - Date.parse(run.finishedAt) > 30 * 86400000),
  );
  return {
    root: base,
    totalBytes: existsSync(base) && !lstatSync(base).isSymbolicLink() ? size(base) : 0,
    runs: runs.length,
    protectedRuns: runs.filter((run) => run.protected).length,
    policy: { keepLatest: 20, maxAgeDays: 30 },
    reclaimableBytes: candidates.reduce((sum, run) => sum + run.bytes, 0),
    candidates: candidates.map((run) => run.path),
  };
}
export function pruneLogs(root, apply = false) {
  const plan = logStatus(root),
    removed = [];
  if (apply)
    for (const candidate of plan.candidates) {
      const target = resolve(plan.root, candidate),
        rel = relative(plan.root, target);
      if (!rel || rel.startsWith("..") || resolve(target, "..") === target) throw new Error("Unsafe log path");
      // Refresh eligibility, including locks and symlink ancestors, immediately before deletion.
      if (!logStatus(plan.root).candidates.includes(candidate)) continue;
      rmSync(target, { recursive: true, force: false });
      removed.push(candidate);
    }
  return { ...plan, mode: apply ? "apply" : "preview", removed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(
    JSON.stringify(pruneLogs(join(repositoryRoot, ".canary/logs"), process.argv.includes("--apply")), null, 2),
  );
}
