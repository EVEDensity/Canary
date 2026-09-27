import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { FileArtifactRepository, stableHash, writePrivateJson } from "../packages/trace/dist/index.js";
import { issueFromCheck, linkVerification } from "../apps/web/dist/project-issues.js";
import { evidenceOutput } from "./lib/evidence-output.mjs";

const args = process.argv.slice(2);
if (args.some((arg, index) => index % 2 === 0 && !["--root", "--out"].includes(arg)) || args.length % 2) throw new Error("Usage: collect-real-pairs --root <authorized-project> [--out <file>]");
const flag = (key) => args[args.indexOf(key) + 1];
if (!args.includes("--root")) throw new Error("An explicitly authorized project root is required");
const root = resolve(flag("--root")), repository = new FileArtifactRepository(join(root, ".canary/artifacts"));
const headers = [], skipped = [];
// Bound discovery before parsing. Do not deserialize unrelated, potentially huge Agent trajectories.
for (const entry of readdirSync(repository.rootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^run_[a-z0-9-]+$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 200)) {
  try {
    const file = join(repository.rootDir, entry.name, "run.json");
    if (statSync(file).size > 8 * 1024 * 1024) { skipped.push({ runId: entry.name, reason: "discovery-size-bound" }); continue; }
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw.runId === entry.name && Array.isArray(raw.checks)) headers.push({ runId: raw.runId, retryOf: raw.retryOf, startedAt: raw.startedAt, checkIds: raw.checks.map((check) => check.id) });
  } catch { skipped.push({ runId: entry.name, reason: "unreadable-header" }); }
}
const cache = new Map(), load = (id) => { if (!cache.has(id)) cache.set(id, repository.readRun(id)); return cache.get(id); };
const pairs = [];
for (const header of headers.filter((header) => !header.retryOf && headers.some((next) => next.retryOf === header.runId))) {
  try {
    const baseline = load(header.runId); if (!baseline?.checks) continue;
    for (const check of baseline.checks.filter((check) => check.status === "failed")) {
      const issue = linkVerification(issueFromCheck(baseline.runId, check), baseline, headers, repository, load);
      if (issue.status !== "verified" || !issue.verification?.runId) continue;
      const candidate = load(issue.verification.runId), before = repository.verify(baseline.runId), after = repository.verify(candidate.runId);
      const oldStructure = repository.readJson(baseline.runId, "structure.json"), newStructure = repository.readJson(candidate.runId, "structure.json");
      pairs.push({ id: `${baseline.runId}:${check.id}`, faultGroup: baseline.runId, origin: "observed-local-project-ci-retry", checkId: check.id, category: issue.category,
        baseline: { runId: baseline.runId, manifestHash: before.manifestHash, sourceHash: baseline.evidence?.reproduction.sourceHash, gitCommit: baseline.evidence?.reproduction.gitCommit, checkPlanHash: stableHash(repository.readJson(baseline.runId, "check-plan.json")) },
        candidate: { runId: candidate.runId, manifestHash: after.manifestHash, sourceHash: candidate.evidence?.reproduction.sourceHash, gitCommit: candidate.evidence?.reproduction.gitCommit, checkPlanHash: stableHash(repository.readJson(candidate.runId, "check-plan.json")) },
        replayReadiness: oldStructure && newStructure && oldStructure.source.dirty === false && newStructure.source.dirty === false ? "source-snapshots-present-replay-not-yet-executed" : "evidence-only-missing-reconstructable-source",
        originalEvidence: `${baseline.runId}/checks.json`, verification: "sealed-matching-check-plan-and-retry-lineage" });
    }
  } catch { skipped.push({ runId: header.runId, reason: "unverified-or-unreadable-lineage" }); }
}
const groups = [...new Set(pairs.map((pair) => pair.faultGroup))].sort((a, b) => createHash("sha256").update(a).digest("hex").localeCompare(createHash("sha256").update(b).digest("hex")));
const holdout = new Set(groups.slice(0, Math.max(1, Math.ceil(groups.length / 5))));
for (const pair of pairs) pair.split = holdout.has(pair.faultGroup) ? "holdout" : "regression";
const output = { v: 1, kind: "canary.real-pair-corpus", projectRoot: root, collectedAt: new Date().toISOString(), targetPairs: 10,
  status: pairs.length >= 10 && groups.length >= 10 ? "collected-replay-pending" : "insufficient-real-pairs", pairs, independentFaultGroups: groups.length,
  holdoutGroups: holdout.size, replayVerifiedPairs: 0, skipped,
  limitations: ["同一原运行的多个失败检查属于同一故障组，不能当作独立样本。", "只收录本项目已发生的真实检查失败和已验证重跑，不收录注入错误的验收 fixture。", "谱系验证不等于可复现源码修复；需绑定可恢复的前后源码并执行回放。", "固定 holdout 按故障组划分；本脚本不加载经验、不训练或运行模型。"] };
const file = evidenceOutput("real-pairs", "corpus.json", args.includes("--out") ? flag("--out") : undefined); writePrivateJson(file, output);
console.log(JSON.stringify({ status: output.status, observedPairs: pairs.length, independentFaultGroups: groups.length, replayVerifiedPairs: 0, evidence: file }));
process.exitCode = output.status === "insufficient-real-pairs" ? 2 : 0;
