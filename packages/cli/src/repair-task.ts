import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isRepairTaskPath, projectChecksConfigSchema, type ProjectContext } from "@canary/core";
import { createRepairTaskBundle, FileArtifactRepository, redactValue, stableHash, verifyRepairTaskBundle } from "@canary/trace";
import { auditTestChanges } from "@canary/structure";
import { isInsideRoot, resolveProjectContext } from "./home.js";
import { executionSourceReasons } from "./source-identity.js";
import { initialConditions, parseReproductionOptions, reproductionGit, reproductionSource } from "./reproduction.js";
import { selectProjectChecks } from "./project-session.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const testPath = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+$|_test\.[^/]+$/;
const MAX_BUNDLE_BYTES = 65_536;
export interface RepairTaskInput { runId: string; checks?: string[]; allowedPaths?: string[] }

/** Historical plans and source observations always come from the sealed run. */
export function buildProjectRepairTask(context: ProjectContext, input: RepairTaskInput) {
  if (!identifier.test(input.runId)) throw new Error("Invalid source run identity");
  const repository = new FileArtifactRepository(context.artifactRoot);
  const integrity = repository.verify(input.runId);
  if (integrity.status !== "verified" || !integrity.manifestHash) throw new Error("A sealed, verified source run is required");
  const run = repository.readRun(input.runId);
  if (!run?.checks || run.status === "running" || !run.evidence) throw new Error("A completed project check run is required");
  const plan = projectChecksConfigSchema.parse(repository.readJson(input.runId, "check-plan.json"));
  const proof = repository.readJson(input.runId, "execution-source.json");
  const checks = input.checks ?? run.checks.filter(check => check.status === "failed" || check.status === "blocked").map(check => check.id);
  if (!checks.length || checks.length > 16 || new Set(checks).size !== checks.length || checks.some(id => !identifier.test(id))) throw new Error("Select one to sixteen unique failed checks");
  if (input.allowedPaths && (!input.allowedPaths.length || input.allowedPaths.length > 32 || new Set(input.allowedPaths).size !== input.allowedPaths.length || input.allowedPaths.some(path => !isRepairTaskPath(path)))) throw new Error("Declare one to thirty-two unique project-relative repair paths");
  if (checks.some(id => !run.checks!.some(check => check.id === id && ["failed", "blocked"].includes(check.status)))) throw new Error("Selected checks require recorded failure or blocking evidence");
  const blockers = executionSourceReasons(proof, run, "Original");
  const options = parseReproductionOptions([input.runId, "--check", checks[0]!, "--project", context.projectRoot, "--config", context.configFile]);
  const source = reproductionSource(options);
  blockers.push(...initialConditions({ ...source, selected: selectProjectChecks(plan, checks) }));
  try {
    const repo = reproductionGit(context.projectRoot, ["rev-parse", "--show-toplevel"]);
    const projectPath = relative(repo, context.projectRoot).replaceAll("\\", "/") || ".";
    if (projectPath !== run.evidence.reproduction.projectPath) blockers.push("Recorded project path differs from the bound project");
    reproductionGit(repo, ["cat-file", "-e", `${run.evidence.reproduction.gitCommit}^{commit}`]);
  } catch { blockers.push("Recorded source commit is unavailable in the bound repository"); }
  return createRepairTaskBundle({ run, plan, projectRoot: context.projectRoot, manifestHash: integrity.manifestHash,
    checks, allowedPaths: input.allowedPaths, blockers: [...new Set(blockers)], executionSourceHash: proof ? stableHash(proof) : undefined });
}

function readBundle(file: string) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error("Repair task must be a regular JSON file within 65536 bytes");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Repair task JSON is invalid or incomplete"); }
  if (!verifyRepairTaskBundle(value)) throw new Error("Repair task integrity, schema or privacy verification failed");
  return value as ReturnType<typeof createRepairTaskBundle>;
}

/** This is candidate admission, never a replacement for before/after regression execution. */
export function checkProjectRepairTask(context: ProjectContext, bundle: ReturnType<typeof createRepairTaskBundle>, candidateId: string) {
  if (!verifyRepairTaskBundle(bundle) || !identifier.test(candidateId)) throw new Error("Invalid repair task or candidate identity");
  const task = bundle.task, repository = new FileArtifactRepository(context.artifactRoot);
  const originalIntegrity = repository.verify(task.source.runId), candidateIntegrity = repository.verify(candidateId);
  if (originalIntegrity.status !== "verified" || candidateIntegrity.status !== "verified" || !candidateIntegrity.manifestHash) throw new Error("Both source and candidate require sealed, verified evidence");
  if (originalIntegrity.manifestHash !== task.source.manifestHash) throw new Error("Source manifest changed; regenerate the repair task from reviewed evidence");
  const original = repository.readRun(task.source.runId), candidate = repository.readRun(candidateId);
  if (!original?.evidence || !candidate?.evidence || !original.checks || !candidate.checks || candidate.status === "running") throw new Error("Completed project runs are required");
  const originalPlan = projectChecksConfigSchema.parse(repository.readJson(original.runId, "check-plan.json"));
  const candidatePlan = projectChecksConfigSchema.parse(repository.readJson(candidateId, "check-plan.json"));
  const rebuilt = buildProjectRepairTask(context, { runId: original.runId, checks: task.selectedChecks, allowedPaths: task.scope.allowedPaths.length ? task.scope.allowedPaths : undefined });
  if (stableHash(rebuilt.task) !== stableHash(task)) throw new Error("Repair task differs from the bound source evidence or current reproduction conditions");
  if (stableHash(candidatePlan) !== candidate.evidence.reproduction.configHash) throw new Error("Candidate check plan does not match its sealed evidence");
  const reasons = [...task.blockers, ...executionSourceReasons(repository.readJson(candidateId, "execution-source.json"), candidate, "Candidate")];
  reasons.push(...initialConditions({ context, repository, run: candidate, check: candidate.checks[0]!, selected: candidatePlan, parentHash: candidateIntegrity.manifestHash }));
  if (candidateId === original.runId) reasons.push("A distinct candidate run is required");
  if (candidate.evidence.reproduction.gitDirty !== false) reasons.push("Candidate tracked source was not clean");
  if (candidate.evidence.reproduction.projectPath !== original.evidence.reproduction.projectPath) reasons.push("Candidate project path differs from original");
  for (const check of originalPlan.checks) {
    const next = candidatePlan.checks.find(item => item.id === check.id);
    if (!next || stableHash(next) !== stableHash(check)) reasons.push(`Original check ${check.id} was removed or changed`);
    if (candidate.checks.find(item => item.id === check.id)?.status !== "passed") reasons.push(`Original check ${check.id} did not pass on candidate`);
  }
  if (candidatePlan.budgetMs !== originalPlan.budgetMs || stableHash(candidatePlan.reproduction ?? null) !== stableHash(originalPlan.reproduction ?? null)) reasons.push("Original execution budget or reproduction requirements changed");
  for (const contract of originalPlan.contracts ?? []) {
    if (stableHash(candidatePlan.contracts?.find(item => item.id === contract.id) ?? null) !== stableHash(contract)) reasons.push(`Original behavior contract ${contract.id} was removed or changed`);
  }
  const changedFiles: string[] = [], changes: Array<{ path: string; before?: string; after?: string }> = [];
  try {
    const repo = reproductionGit(context.projectRoot, ["rev-parse", "--show-toplevel"]);
    const before = task.source.commit, after = candidate.evidence.reproduction.gitCommit;
    if (!before || !after || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(after)) throw new Error("Committed source identities are required");
    reproductionGit(repo, ["merge-base", "--is-ancestor", before, after]);
    const prefix = task.source.projectPath ? `${task.source.projectPath}/` : "";
    const paths = reproductionGit(repo, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", before, after, "--"], undefined, false).split("\0").filter(Boolean);
    if (paths.length > 2000) throw new Error("Changed-file budget exceeded");
    if (!paths.length) reasons.push("Candidate has no committed source changes");
    const trees = [before, after].map(sha => new Map(reproductionGit(repo, ["ls-tree", "-r", "-z", sha], undefined, false).split("\0").filter(Boolean).map(row => {
      const match = row.match(/^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/);
      if (!match) throw new Error("Unsupported Git tree entry");
      return [match[4]!, { mode: match[1]!, type: match[2]!, hash: match[3]! }] as const;
    })));
    let auditBytes = 0;
    const blob = (tree: typeof trees[number], path: string): string | undefined => {
      const entry = tree.get(path);
      if (!entry) return undefined;
      if (!/^100(?:644|755)$/.test(entry.mode) || entry.type !== "blob") throw new Error("Symlinks and submodules require separate review");
      const size = Number(reproductionGit(repo, ["cat-file", "-s", entry.hash]));
      auditBytes += size;
      if (!Number.isSafeInteger(size) || size > 262_144 || auditBytes > 4_194_304) throw new Error("Test-audit byte budget exceeded");
      return reproductionGit(repo, ["cat-file", "blob", entry.hash], undefined, false);
    };
    for (const path of paths) {
      const local = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : prefix ? undefined : path;
      changedFiles.push(local ?? path);
      if (!local || !isRepairTaskPath(local) || !task.scope.allowedPaths.some(allowed => local === allowed || local.startsWith(`${allowed}/`))) reasons.push(`Changed path is outside the declared repair scope: ${path}`);
      for (const tree of trees) {
        const entry = tree.get(path);
        if (entry && (!/^100(?:644|755)$/.test(entry.mode) || entry.type !== "blob")) reasons.push(`Changed path is not an ordinary file: ${path}`);
      }
      if (local && testPath.test(local)) changes.push({ path: local, before: blob(trees[0]!, path), after: blob(trees[1]!, path) });
    }
  } catch { reasons.push("Committed candidate diff is unavailable, unrelated, unsafe or exceeds the review budget"); }
  const findings = auditTestChanges(changes);
  for (const change of changes) {
    if (change.before !== undefined && change.before !== change.after && !findings.some(finding => finding.path === change.path)) findings.push({ path: change.path, type: "test-change-requires-review", certainty: "advisory" });
  }
  reasons.push(...findings.filter(item => item.certainty === "observed").map(item => `${item.type}: ${item.path}`));
  const uniqueReasons = [...new Set(reasons)];
  return redactValue({ v: 1, kind: "canary.repair-task-candidate", taskId: task.taskId, taskHash: stableHash(task),
    original: task.source, candidate: { runId: candidateId, manifestHash: candidateIntegrity.manifestHash, commit: candidate.evidence.reproduction.gitCommit },
    outcome: uniqueReasons.length ? "blocked" : "ready-for-regression", repairVerified: false, executed: false,
    reviewRequired: findings.some(item => item.certainty === "advisory"), changedFiles, findings, reasons: uniqueReasons,
    nextStep: "Review advisory findings, then use canary repair-verify with an explicit regression check and test file. Candidate admission does not verify a repair." }, { maxStringLength: Infinity }) as { outcome: string; [key: string]: unknown };
}

function writeNewJson(file: string, value: unknown, context?: ProjectContext) {
  const destination = resolve(file);
  const checkParents = () => {
    let current = dirname(destination);
    while (true) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Task export parent directories cannot be symbolic links or junctions");
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };
  checkParents();
  if (context && isInsideRoot(destination, context.artifactRoot)) throw new Error("Task exports cannot modify retained run artifacts");
  mkdirSync(dirname(destination), { recursive: true });
  checkParents();
  if (context && isInsideRoot(join(realpathSync.native(dirname(destination)), basename(destination)), context.artifactRoot)) throw new Error("Task exports cannot modify retained run artifacts");
  const temporary = join(dirname(destination), `.canary-task-${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    try { writeFileSync(descriptor, JSON.stringify(value) + "\n"); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    // Link publishes complete bytes and fails atomically if a destination exists.
    linkSync(temporary, destination);
  } finally { unlinkSync(temporary); }
}

export async function repairTaskCommand(args: string[]): Promise<number> {
  try {
    const [action, subject, ...rest] = args;
    if (action === "verify") {
      if (!subject || rest.length) throw new Error("Use canary repair-task verify <bundle.json>");
      const bundle = readBundle(resolve(subject));
      console.log(JSON.stringify({ v: 1, kind: "canary.repair-task-integrity", valid: true, taskId: bundle.task.taskId, trust: "integrity-only", executionGranted: false }));
      return 0;
    }
    if (!["create", "check"].includes(action ?? "") || !subject) throw new Error("Use canary repair-task create <runId> [--check <id>] [--allow <path>] [--out <bundle.json>] or check <bundle.json> <candidateRunId>");
    const candidateId = action === "check" ? rest.shift() : undefined;
    if (action === "check" && (!candidateId || !identifier.test(candidateId))) throw new Error("A candidate run ID is required");
    const values = new Map<string, string[]>();
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!;
      if (flag === "--json" && !values.has(flag)) { values.set(flag, []); continue; }
      const allowed = action === "create" ? ["--check", "--allow", "--out", "--project", "--config"] : ["--out", "--project", "--config"];
      if (!allowed.includes(flag) || !rest[i + 1] || rest[i + 1]!.startsWith("--") || (values.has(flag) && !["--check", "--allow"].includes(flag))) throw new Error("Invalid or repeated repair-task argument");
      values.set(flag, [...(values.get(flag) ?? []), rest[++i]!]);
    }
    const context = resolveProjectContext({ cwd: values.get("--project")?.[0], configPath: values.get("--config")?.[0] });
    const output = action === "create" ? buildProjectRepairTask(context, { runId: subject, checks: values.get("--check"), allowedPaths: values.get("--allow") }) : checkProjectRepairTask(context, readBundle(resolve(subject)), candidateId!);
    const file = values.get("--out")?.[0];
    if (file) writeNewJson(file, output, context);
    console.log(JSON.stringify(output));
    return action === "check" && "outcome" in output && output.outcome !== "ready-for-regression" ? 4 : 0;
  } catch (error) { console.error(redactValue(error instanceof Error ? error.message : String(error), { maxStringLength: 1024 })); return 2; }
}
