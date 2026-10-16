import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  artifactManifestSchema,
  isRepairTaskPath,
  parseRunSnapshot,
  projectChecksConfigSchema,
  projectMemoryProjectId,
  projectMemoryQueryChars,
  projectMemoryQuerySchema,
  repairVerificationSchema,
  type ProjectContext,
  type ProjectMemoryInput,
  type ProjectMemoryQuery,
  type ProjectMemoryRecord,
  type RunSnapshot,
} from "@canary/core";
import { ProjectMemoryStore } from "@canary/experience";
import {
  FileArtifactRepository,
  buildRunDiagnostics,
  containsSensitiveValue,
  readArtifactManifest,
  redactValue,
  safeArtifactPath,
  sha256,
  stableHash,
} from "@canary/trace";
import { canonicalPath, resolveProjectContext } from "./home.js";
import { baseEnvironment, executablePlan } from "./reproduction.js";
import { executionSourceReasons, type ExecutionSourceProof } from "./source-identity.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const commit = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const critical = ["run.json", "check-plan.json", "source-inventory.json", "execution-source.json"];
const unavailable =
  "Retained project memory or its versioned evidence is unavailable; inspect the sealed evidence before retrying.";
type Identity = ProjectMemoryRecord["source"]["original"];
export interface ProjectMemoryQueryInput {
  runId: string;
  checks?: string[];
  maxItems?: number;
  maxChars?: number;
}
export interface ProjectMemoryRecordOptions {
  actor: string;
  reason: string;
  days?: number;
  acknowledgeReview?: boolean;
}

/** Bounded snapshot reader: display truncation never substitutes for retained evidence. */
class MemoryEvidence {
  readonly repository: FileArtifactRepository;
  private readonly snapshots = new Map<
    string,
    { hash: string; manifest: ReturnType<typeof artifactManifestSchema.parse> }
  >();
  constructor(
    readonly context: ProjectContext,
    readonly deadline = Date.now() + 15_000,
    readonly budget = { bytes: 0 },
  ) {
    this.repository = new FileArtifactRepository(context.artifactRoot);
  }
  remaining() {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new Error("Memory evidence time budget exceeded");
    return Math.min(5000, remaining);
  }
  private open(runId: string) {
    if (!identifier.test(runId)) throw new Error("Invalid run identity");
    const existing = this.snapshots.get(runId);
    if (existing) return existing;
    this.remaining();
    const integrity = this.repository.verify(runId),
      dir = safeArtifactPath(this.context.artifactRoot, runId);
    if (integrity.status !== "verified" || !integrity.manifestHash) throw new Error("Sealed evidence is required");
    const manifest = readArtifactManifest(dir);
    if (!manifest || sha256(readFileSync(join(dir, "manifest.json"))) !== integrity.manifestHash)
      throw new Error("Evidence revision changed");
    const snapshot = { hash: integrity.manifestHash, manifest };
    this.snapshots.set(runId, snapshot);
    return snapshot;
  }
  hash(runId: string) {
    return this.open(runId).hash;
  }
  read<T>(runId: string, name: string): T {
    const entry = this.open(runId).manifest.files.find((file) => file.path === name);
    if (!entry) throw new Error("Required retained evidence is missing");
    this.budget.bytes += entry.bytes;
    this.remaining();
    if (entry.bytes > 8_388_608 || this.budget.bytes > 33_554_432)
      throw new Error("Memory evidence byte budget exceeded");
    const path = safeArtifactPath(safeArtifactPath(this.context.artifactRoot, runId), name),
      stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes)
      throw new Error("Evidence must be an unchanged ordinary file");
    const bytes = readFileSync(path);
    if (sha256(bytes) !== entry.sha256) throw new Error("Evidence content changed");
    return JSON.parse(bytes.toString("utf8")) as T;
  }
  run(runId: string) {
    const run = parseRunSnapshot(this.read(runId, "run.json")) as RunSnapshot;
    if (
      run.runId !== runId ||
      !run.checks?.length ||
      run.status === "running" ||
      !run.evidence?.reproduction ||
      !commit.test(run.evidence.reproduction.gitCommit ?? "")
    )
      throw new Error("Completed, version-bound project evidence is required");
    const plan = projectChecksConfigSchema.parse(this.read(runId, "check-plan.json"));
    if (
      stableHash(plan) !== run.evidence.reproduction.configHash ||
      new Set(run.checks.map((check) => check.id)).size !== run.checks.length ||
      run.checks.some((check) => !plan.checks.some((item) => item.id === check.id))
    )
      throw new Error("Check plan and executed check identities differ");
    const inventory = this.read<{ files: Array<{ path: string; sha256: string; bytes: number }> }>(
      runId,
      "source-inventory.json",
    );
    if (!Array.isArray(inventory.files) || stableHash(inventory) !== run.evidence.reproduction.sourceHash)
      throw new Error("Source inventory identity differs");
    return { run, plan, inventory };
  }
  reference(reference: Identity, names = critical) {
    const current = this.open(reference.runId),
      dir = safeArtifactPath(this.context.artifactRoot, reference.runId);
    let manifest = current.manifest,
      hash = current.hash;
    while (hash !== reference.manifestHash) {
      if (!manifest.previousManifestHash) throw new Error("Referenced manifest is not in the retained history");
      hash = manifest.previousManifestHash;
      const file = safeArtifactPath(safeArtifactPath(dir, "manifest-history"), `${hash}.json`),
        bytes = readFileSync(file);
      this.budget.bytes += bytes.length;
      this.remaining();
      if (bytes.length > 8_388_608 || this.budget.bytes > 33_554_432 || sha256(bytes) !== hash)
        throw new Error("Manifest history is invalid or exceeds its budget");
      manifest = artifactManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    }
    if (manifest.runId !== reference.runId) throw new Error("Referenced manifest belongs to another run");
    for (const name of names) {
      const prior = manifest.files.find((file) => file.path === name),
        now = current.manifest.files.find((file) => file.path === name);
      if (!prior || !now || prior.sha256 !== now.sha256 || prior.bytes !== now.bytes)
        throw new Error("Referenced execution inputs changed after verification");
    }
  }
  proof(run: RunSnapshot, requireCommit = true) {
    const proof = this.read<ExecutionSourceProof>(run.runId, "execution-source.json");
    if (requireCommit) {
      if (
        executionSourceReasons(proof, run, "Memory").length ||
        proof.before?.commitMatches !== true ||
        proof.after?.commitMatches !== true ||
        run.evidence!.reproduction.gitDirty !== false
      )
        throw new Error("Tracked execution inputs did not establish the recorded commit");
    } else {
      const normalized = structuredClone(proof);
      if (normalized.before) delete normalized.before.commitMatches;
      if (normalized.after) delete normalized.after.commitMatches;
      if (
        executionSourceReasons(normalized, run, "Regression").length ||
        !proof.before ||
        stableHash(proof.before) !== stableHash(proof.after)
      )
        throw new Error("Regression execution source proof is incomplete or changed");
    }
    return proof;
  }
  finish() {
    for (const [id, snapshot] of this.snapshots) {
      this.remaining();
      if (this.repository.verify(id).manifestHash !== snapshot.hash)
        throw new Error("Evidence changed during memory assessment");
    }
  }
  git(repo: string, args: string[]) {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
      cwd: repo,
      env: baseEnvironment(),
      encoding: "utf8",
      timeout: this.remaining(),
      maxBuffer: 8_388_608,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}
function projectScope(context: ProjectContext, evidence: MemoryEvidence, run: RunSnapshot) {
  const repo = evidence.git(context.projectRoot, ["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, ""),
    path = relative(repo, context.projectRoot).replaceAll("\\", "/") || ".";
  if ((path !== "." && !isRepairTaskPath(path)) || run.evidence!.reproduction.projectPath !== path)
    throw new Error("Evidence belongs to another project scope");
  return { repo, path, prefix: path === "." ? "" : `${path}/` };
}
function tree(evidence: MemoryEvidence, repo: string, revision: string) {
  const entries = new Map<string, { mode: string; blob: string }>();
  for (const row of evidence.git(repo, ["ls-tree", "-r", "-z", revision]).split("\0").filter(Boolean)) {
    const match = row.match(/^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) throw new Error("Unknown Git tree entry");
    entries.set(match[4]!, { mode: match[1]!, blob: match[3]! });
  }
  return entries;
}
function rawSource(
  evidence: MemoryEvidence,
  repo: string,
  revision: string,
  fullPath: string,
  retained: { sha256: string; bytes: number } | undefined,
) {
  if (!retained) throw new Error("Regression source inventory is missing");
  const text = evidence.git(repo, ["show", `${revision}:${fullPath}`]);
  if (Buffer.byteLength(text) > 262_144) throw new Error("Regression source exceeds its supported budget");
  if (sha256(text) === retained.sha256) return text;
  const converted = text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  if (Buffer.byteLength(converted) === retained.bytes && sha256(converted) === retained.sha256) return converted;
  throw new Error("Historical regression source does not match retained execution bytes");
}

/** Rebind all three runs; a schema-valid or green rerun alone is not repair proof. */
function verifiedRepair(
  context: ProjectContext,
  candidateId: string,
  evidence: MemoryEvidence,
  receiptRunId = candidateId,
) {
  const receipt = repairVerificationSchema.parse(evidence.read(receiptRunId, "repair-verification.json"));
  if (
    receipt.outcome !== "verified" ||
    !receipt.executed ||
    !receipt.beforeRegression ||
    receipt.candidate.runId !== candidateId
  )
    throw new Error("An executed, verified repair receipt is required");
  if (receiptRunId !== candidateId && receipt.beforeRegression.runId !== receiptRunId)
    throw new Error("Historical receipt must belong to its retained regression run");
  const original = evidence.run(receipt.original.runId),
    candidate = evidence.run(candidateId),
    before = evidence.run(receipt.beforeRegression.runId);
  const scope = projectScope(context, evidence, candidate.run);
  for (const item of [original, before])
    if (item.run.evidence!.reproduction.projectPath !== scope.path)
      throw new Error("Repair evidence mixes project scopes");
  for (const [identity, item] of [
    [receipt.original, original],
    [receipt.candidate, candidate],
    [receipt.beforeRegression, before],
  ] as const) {
    if (item.run.evidence!.reproduction.gitCommit !== identity.commit)
      throw new Error("Repair commit does not match its run");
    evidence.reference(identity);
  }
  const originalProof = evidence.proof(original.run),
    candidateProof = evidence.proof(candidate.run),
    beforeProof = evidence.proof(before.run, false);
  if (
    stableHash(receipt.executionSources?.original) !== stableHash(originalProof) ||
    stableHash(receipt.executionSources?.candidate) !== stableHash(candidateProof)
  )
    throw new Error("Receipt source observations do not match sealed evidence");
  if (
    stableHash(beforeProof.before) !== stableHash(receipt.beforeRegression.executionSource) ||
    stableHash(beforeProof.after) !== stableHash(receipt.beforeRegression.observedSource)
  )
    throw new Error("Regression observations do not match the complete retained source scope");
  if (
    before.run.evidence!.lineage.replayOf !== original.run.runId ||
    before.run.evidence!.lineage.parentManifestHash !== receipt.original.manifestHash
  )
    throw new Error("Regression lineage does not bind the original failure");
  const failures = original.run.checks!.filter((check) => check.status === "failed");
  if (!failures.length || failures.length > 16) throw new Error("Memory retains one to sixteen original failed checks");
  if (candidate.run.status !== "completed") throw new Error("Candidate did not complete successfully");
  for (const check of original.plan.checks)
    if (
      stableHash(candidate.plan.checks.find((item) => item.id === check.id)) !== stableHash(check) ||
      candidate.run.checks!.find((item) => item.id === check.id)?.status !== "passed"
    )
      throw new Error("Original check declarations and passing results must be preserved");
  if (
    original.plan.budgetMs !== candidate.plan.budgetMs ||
    stableHash(original.plan.reproduction ?? null) !== stableHash(candidate.plan.reproduction ?? null) ||
    (original.plan.contracts ?? []).some(
      (contract) =>
        stableHash(candidate.plan.contracts?.find((item) => item.id === contract.id)) !== stableHash(contract),
    )
  )
    throw new Error("Original requirements or behavior contracts changed");
  const structure = evidence.read<{ source: { projectRoot: string } }>(before.run.runId, "structure.json");
  const expected = executablePlan(
    {
      context,
      repository: evidence.repository,
      run: candidate.run,
      check: candidate.run.checks![0]!,
      selected: candidate.plan,
      parentHash: evidence.hash(candidateId),
    },
    structure.source.projectRoot,
  );
  if (stableHash(expected) !== stableHash(before.plan))
    throw new Error("Before-regression checks differ from the retained candidate execution plan");
  const diagnostics = buildRunDiagnostics(before.run, structure.source.projectRoot);
  for (const id of receipt.regressionChecks) {
    const failed = before.run.checks!.find((check) => check.id === id),
      declaration = candidate.plan.checks.find((check) => check.id === id);
    if (
      declaration?.type !== "command" ||
      !receipt.testFiles.some((file) => declaration.args.includes(file)) ||
      failed?.status !== "failed" ||
      failed.category !== "assertion" ||
      candidate.run.checks!.find((check) => check.id === id)?.status !== "passed" ||
      !diagnostics.failures.some(
        (failure) =>
          failure.checkId === id && failure.locations.some((location) => receipt.testFiles.includes(location.path)),
      )
    )
      throw new Error("Regression assertions must fail at a retained test location before the fix and pass after it");
  }
  evidence.git(scope.repo, ["merge-base", "--is-ancestor", receipt.original.commit, receipt.candidate.commit]);
  const candidateTree = tree(evidence, scope.repo, receipt.candidate.commit);
  for (const file of receipt.testFiles) {
    if (!isRepairTaskPath(file)) throw new Error("Unsafe regression path");
    const entry = candidate.inventory.files.find((item) => item.path === file),
      beforeEntry = before.inventory.files.find((item) => item.path === file);
    const text = rawSource(evidence, scope.repo, receipt.candidate.commit, scope.prefix + file, entry);
    if (
      entry?.sha256 !== beforeEntry?.sha256 ||
      receipt.beforeRegression.testOverlay?.find((item) => item.path === file)?.hash !== stableHash(text)
    )
      throw new Error("Regression inputs differ between the retained executions");
  }
  const changed = evidence
    .git(scope.repo, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-only",
      "-z",
      receipt.original.commit,
      receipt.candidate.commit,
      "--",
    ])
    .split("\0")
    .filter(Boolean);
  if (
    !changed.length ||
    changed.length > 256 ||
    changed.some((path) => !path.startsWith(scope.prefix) || !isRepairTaskPath(path.slice(scope.prefix.length)))
  )
    throw new Error("Repair changes exceed the supported project scope");
  const originalDiagnostics = buildRunDiagnostics(original.run, context.projectRoot);
  const failureFacts = failures.map((check) => ({
    checkId: check.id,
    checkType: check.type,
    category: check.category,
    declarationHash: stableHash(original.plan.checks.find((item) => item.id === check.id)),
    paths: [
      ...new Set(
        originalDiagnostics.failures
          .filter((failure) => failure.checkId === check.id)
          .flatMap((failure) => failure.locations.map((location) => location.path))
          .filter(isRepairTaskPath),
      ),
    ].slice(0, 32),
  }));
  const paths = [
    ...new Set([
      ...changed.map((path) => path.slice(scope.prefix.length)),
      ...receipt.testFiles,
      ...failureFacts.flatMap((failure) => failure.paths),
    ]),
  ].sort();
  if (paths.length > 256) throw new Error("Memory source scope exceeds 256 files");
  const files = paths.map((path) => {
    const entry = candidateTree.get(scope.prefix + path);
    if (entry && !["100644", "100755"].includes(entry.mode))
      throw new Error("Special source files cannot establish memory scope");
    return { path, mode: (entry?.mode ?? "100644") as "100644" | "100755", blob: entry?.blob ?? null };
  });
  return { receipt, scope, failures: failureFacts, files, original, candidate, before };
}
function store(context: ProjectContext) {
  return new ProjectMemoryStore(
    join(context.projectRoot, ".canary", "memory"),
    projectMemoryProjectId(canonicalPath(context.projectRoot)),
  );
}
function safeDocument(value: unknown) {
  if (
    containsSensitiveValue(value) ||
    JSON.stringify(redactValue(value, { maxStringLength: Infinity })) !== JSON.stringify(value)
  )
    throw new Error("Memory contains private or unsupported text");
}
export function recordProjectMemory(
  context: ProjectContext,
  candidateId: string,
  options: ProjectMemoryRecordOptions,
): ProjectMemoryRecord {
  const days = options.days ?? 90;
  if (!options.actor?.trim() || !options.reason?.trim() || options.actor.length > 96 || options.reason.length > 512)
    throw new Error("Explicit bounded operator and reason are required");
  safeDocument({ actor: options.actor, reason: options.reason });
  if (!identifier.test(candidateId) || !Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("Invalid memory candidate or expiry");
  const evidence = new MemoryEvidence(context),
    verified = verifiedRepair(context, candidateId, evidence);
  if (verified.receipt.reviewRequired && !options.acknowledgeReview)
    throw new Error("Review advisories require an explicit --ack-review before recording memory");
  const createdAt = new Date().toISOString();
  const identity = (run: RunSnapshot): Identity => ({
    runId: run.runId,
    commit: run.evidence!.reproduction.gitCommit!,
    manifestHash: evidence.hash(run.runId),
  });
  const input: ProjectMemoryInput = {
    v: 1,
    kind: "canary.project-memory",
    projectId: projectMemoryProjectId(canonicalPath(context.projectRoot)),
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + days * 86_400_000).toISOString(),
    operator: { actor: options.actor, reason: options.reason, reviewAcknowledged: Boolean(options.acknowledgeReview) },
    source: {
      original: identity(verified.original.run),
      candidate: identity(verified.candidate.run),
      beforeRegression: identity(verified.before.run),
      receiptHash: stableHash(verified.receipt),
    },
    failures: verified.failures,
    regressionChecks: verified.receipt.regressionChecks,
    testFiles: verified.receipt.testFiles,
    scope: { projectPath: verified.scope.path, files: verified.files },
  };
  safeDocument(input);
  evidence.finish();
  return store(context).record(input);
}

export function queryProjectMemory(context: ProjectContext, input: ProjectMemoryQueryInput): ProjectMemoryQuery {
  const maxItems = input.maxItems ?? 5,
    maxChars = input.maxChars ?? 8000;
  if (
    !identifier.test(input.runId) ||
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 10 ||
    !Number.isInteger(maxChars) ||
    maxChars < 512 ||
    maxChars > 32768 ||
    (input.checks &&
      (!input.checks.length ||
        input.checks.length > 16 ||
        new Set(input.checks).size !== input.checks.length ||
        input.checks.some((id) => !identifier.test(id))))
  )
    throw new Error("Invalid memory query scope or budget");
  const result: ProjectMemoryQuery = {
    v: 1,
    kind: "canary.project-memory-query",
    runId: input.runId,
    projectId: projectMemoryProjectId(canonicalPath(context.projectRoot)),
    status: "available",
    items: [],
    skipped: [],
    total: 0,
    omitted: 0,
    omittedSkipped: 0,
    budget: { maxItems, maxChars, usedChars: 0 },
    advisoryOnly: true,
    executionGranted: false,
    reasons: [],
  };
  const skip = (id: string, reason: string) => {
    if (result.skipped.length < 32) result.skipped.push({ id, reason });
    else result.omittedSkipped++;
  };
  try {
    const evidence = new MemoryEvidence(context),
      target = evidence.run(input.runId);
    evidence.proof(target.run);
    const scope = projectScope(context, evidence, target.run);
    const failures = target.run.checks!.filter(
      (check) => ["failed", "blocked"].includes(check.status) && (!input.checks || input.checks.includes(check.id)),
    );
    if (!failures.length || input.checks?.some((id) => !failures.some((check) => check.id === id)))
      throw new Error("Select recorded failed or blocked project checks");
    const memories = store(context).list(),
      currentTree = tree(evidence, scope.repo, target.run.evidence!.reproduction.gitCommit!),
      diagnostics = buildRunDiagnostics(target.run, context.projectRoot);
    result.total = memories.length;
    let assessed = 0;
    for (const record of memories) {
      evidence.remaining();
      if (record.status === "revoked") {
        skip(record.id, "revoked");
        continue;
      }
      if (Date.parse(record.expiresAt) <= Date.now()) {
        skip(record.id, "expired");
        continue;
      }
      const matches = record.failures.filter((fact) =>
        failures.some(
          (check) =>
            check.id === fact.checkId &&
            check.type === fact.checkType &&
            check.category === fact.category &&
            stableHash(target.plan.checks.find((item) => item.id === check.id)) === fact.declarationHash,
        ),
      );
      if (!matches.length) {
        skip(record.id, "check-scope-mismatch");
        continue;
      }
      const queryPaths = diagnostics.failures
        .filter((failure) => matches.some((fact) => fact.checkId === failure.checkId))
        .flatMap((failure) => failure.locations.map((location) => location.path));
      if (
        queryPaths.length &&
        matches.every((fact) => fact.paths.length && !fact.paths.some((path) => queryPaths.includes(path)))
      ) {
        skip(record.id, "failure-location-mismatch");
        continue;
      }
      if (assessed++ >= 20 || result.items.length >= maxItems) {
        result.omitted!++;
        skip(record.id, "context-budget");
        continue;
      }
      const reasons: string[] = [];
      try {
        const history = new MemoryEvidence(context, evidence.deadline, evidence.budget),
          verified = verifiedRepair(
            context,
            record.source.candidate.runId,
            history,
            record.source.beforeRegression.runId,
          );
        for (const identity of [record.source.original, record.source.candidate, record.source.beforeRegression])
          history.reference(identity, [
            ...critical,
            ...(identity.runId === record.source.beforeRegression.runId ? ["repair-verification.json"] : []),
          ]);
        if (
          record.source.receiptHash !== stableHash(verified.receipt) ||
          record.scope.projectPath !== scope.path ||
          stableHash(record.failures) !== stableHash(verified.failures) ||
          stableHash(record.scope.files) !== stableHash(verified.files) ||
          stableHash(record.regressionChecks) !== stableHash(verified.receipt.regressionChecks) ||
          stableHash(record.testFiles) !== stableHash(verified.receipt.testFiles)
        )
          throw new Error("Memory no longer matches its retained repair evidence");
        const prior = verified.candidate.run.evidence!.reproduction,
          current = target.run.evidence!.reproduction;
        if (
          ["node", "platform", "arch", "environmentHash"].some(
            (key) => prior[key as keyof typeof prior] !== current[key as keyof typeof current],
          ) ||
          stableHash(prior.toolVersions) !== stableHash(current.toolVersions) ||
          stableHash(prior.lockfiles) !== stableHash(current.lockfiles)
        )
          reasons.push("execution-context-changed");
        history.finish();
      } catch {
        skip(record.id, "evidence-unavailable");
        continue;
      }
      try {
        evidence.git(scope.repo, [
          "merge-base",
          "--is-ancestor",
          record.source.candidate.commit,
          target.run.evidence!.reproduction.gitCommit!,
        ]);
      } catch {
        reasons.push("candidate-not-established-as-ancestor");
      }
      const changedScope = record.scope.files.filter((file) => {
        const entry = currentTree.get(scope.prefix + file.path);
        return file.blob === null ? Boolean(entry) : !entry || entry.blob !== file.blob || entry.mode !== file.mode;
      });
      if (changedScope.length)
        reasons.push(
          "related-source-changed",
          ...changedScope.slice(0, 8).map((file) => `scope-file-changed:${file.path}`),
        );
      if (!queryPaths.length || matches.some((fact) => !fact.paths.length))
        reasons.push("failure-location-unavailable");
      const item = {
        record,
        match: reasons.length ? ("needs-revalidation" as const) : ("related" as const),
        checkIds: matches.map((fact) => fact.checkId),
        reasons: reasons.length
          ? reasons
          : ["same-declared-check-category-and-reported-path", "historical-repair-only-not-current-fix-proof"],
      };
      if (projectMemoryQueryChars([...result.items, item]) > maxChars) {
        result.omitted!++;
        skip(record.id, "context-budget");
        continue;
      }
      result.items.push(item);
    }
    result.budget.usedChars = projectMemoryQueryChars(result.items);
    evidence.finish();
    safeDocument(result);
    const parsed = projectMemoryQuerySchema.parse(result);
    if (Buffer.byteLength(JSON.stringify(parsed)) > 65_536)
      throw new Error("Memory query exceeds the encoded response budget");
    return parsed;
  } catch {
    return projectMemoryQuerySchema.parse({
      ...result,
      status: "unavailable",
      items: [],
      skipped: [],
      omittedSkipped: 0,
      total: null,
      omitted: null,
      budget: { maxItems, maxChars, usedChars: 0 },
      reasons: [unavailable],
    });
  }
}
export async function projectMemoryCommand(args: string[]): Promise<number> {
  try {
    const [action, ...remaining] = args;
    if (!["record", "query", "list", "revoke"].includes(action ?? ""))
      throw new Error("Use canary memory record|query|list|revoke");
    const subject = action === "list" ? undefined : remaining.shift(),
      flags = new Map<string, string[]>();
    for (let index = 0; index < remaining.length; index++) {
      const flag = remaining[index]!;
      if (flag === "--json" || flag === "--ack-review") {
        if (flags.has(flag) || (flag === "--ack-review" && action !== "record"))
          throw new Error("Invalid repeated memory flag");
        flags.set(flag, []);
        continue;
      }
      const allowed = [
        "--project",
        "--config",
        ...(action === "query"
          ? ["--check", "--max-items", "--max-chars"]
          : action === "record"
            ? ["--actor", "--reason", "--days"]
            : action === "revoke"
              ? ["--actor", "--reason"]
              : []),
      ];
      if (
        !allowed.includes(flag) ||
        !remaining[index + 1] ||
        remaining[index + 1]!.startsWith("--") ||
        (flags.has(flag) && flag !== "--check")
      )
        throw new Error("Invalid memory argument");
      flags.set(flag, [...(flags.get(flag) ?? []), remaining[++index]!]);
    }
    if (action !== "list" && (!subject || !identifier.test(subject)))
      throw new Error("A memory or run identity is required");
    const value = (flag: string) => flags.get(flag)?.[0],
      context = resolveProjectContext({ cwd: value("--project"), configPath: value("--config") });
    const number = (flag: string) => {
      const text = value(flag);
      if (text !== undefined && !/^\d+$/.test(text)) throw new Error("Memory budgets must be integers");
      return text === undefined ? undefined : Number(text);
    };
    let result: unknown;
    if (action === "record")
      result = recordProjectMemory(context, subject!, {
        actor: value("--actor") ?? "",
        reason: value("--reason") ?? "",
        days: number("--days"),
        acknowledgeReview: flags.has("--ack-review"),
      });
    else if (action === "query")
      result = queryProjectMemory(context, {
        runId: subject!,
        checks: flags.get("--check"),
        maxItems: number("--max-items"),
        maxChars: number("--max-chars"),
      });
    else if (action === "revoke") {
      safeDocument({ actor: value("--actor"), reason: value("--reason") });
      result = store(context).revoke(subject!, value("--actor") ?? "", value("--reason") ?? "");
    } else {
      const records = store(context).list();
      result = {
        v: 1,
        kind: "canary.project-memory-list",
        projectId: projectMemoryProjectId(canonicalPath(context.projectRoot)),
        total: records.length,
        omittedRecords: Math.max(0, records.length - 32),
        records: records.slice(0, 32).map((record) => ({
          id: record.id,
          status: record.status,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          candidateRunId: record.source.candidate.runId,
          checkIds: record.failures.slice(0, 4).map((failure) => failure.checkId),
          omittedChecks: Math.max(0, record.failures.length - 4),
        })),
      };
    }
    safeDocument(result);
    console.log(JSON.stringify(result));
    return action === "query" && (result as ProjectMemoryQuery).status === "unavailable" ? 4 : 0;
  } catch {
    console.error("Project memory operation was rejected; check the arguments, retained evidence and memory state.");
    return 2;
  }
}
