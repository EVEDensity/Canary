import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  changeVerificationV2Schema,
  deriveChangeSummary,
  matchesBehaviorPath,
  parseCoverageSummary,
  parseRunSnapshot,
  projectChecksConfigSchema,
  type ChangeBehaviorContractAssessment,
  type ChangeFileAssessment,
  type ChangeVerificationSource,
  type CoverageManifest,
  type CoverageSummary,
  type ProjectCheckResult,
  type ProjectChecksConfig,
  type ProjectContext,
  type RunSnapshot,
} from "@canary/core";
import type { StructureSnapshot } from "@canary/structure";
import {
  FileArtifactRepository,
  readArtifactManifest,
  safeArtifactPath,
  sha256,
  stableHash,
  updateArtifact,
  redactValue,
  buildRunDiagnostics,
} from "@canary/trace";
import { resolveProjectContext } from "./home.js";
import { baseEnvironment, reproductionGit } from "./reproduction.js";
import { executionSourceReasons } from "./source-identity.js";
import { analyzeChangedFile } from "./changed-file.js";
export { analyzeChangedFile } from "./changed-file.js";
export { matchesBehaviorPath } from "@canary/core";

/** A maintainer's deterministic assertion report is distinct from command success. */
export function evaluateBehaviorContracts(
  config: ProjectChecksConfig,
  checks: ProjectCheckResult[],
): ChangeBehaviorContractAssessment[] {
  return (config.contracts ?? []).map((contract) => {
    const check = checks.find((item) => item.id === contract.checkId);
    let assertion: { id: string; passed: boolean } | undefined;
    try {
      const report = JSON.parse(check?.stdout ?? "");
      const exact = (value: object, keys: string[]) =>
        Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
      if (
        report &&
        typeof report === "object" &&
        exact(report, ["v", "kind", "method", "results"]) &&
        report.v === 1 &&
        report.kind === "canary.assertions" &&
        report.method === "deterministic" &&
        Array.isArray(report.results) &&
        report.results.length <= 4096 &&
        !check?.outputTruncated
      ) {
        const valid = report.results.every(
          (item: unknown) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            exact(item, ["id", "passed"]) &&
            typeof (item as { id?: unknown }).id === "string" &&
            Boolean((item as { id: string }).id) &&
            typeof (item as { passed?: unknown }).passed === "boolean",
        );
        if (valid && new Set(report.results.map((item: { id: string }) => item.id)).size === report.results.length)
          assertion = report.results.find((item: { id: string }) => item.id === contract.assertionId);
      }
    } catch {
      /* Ordinary logs, model scores and malformed reports remain unknown. */
    }
    return {
      ...contract,
      required: contract.required ?? false,
      status:
        assertion?.passed === false
          ? "failed"
          : assertion?.passed === true && check?.status === "passed"
            ? "verified"
            : "unknown",
      evidence: "maintainer-declared-check-and-deterministic-assertion",
      checkStatus: check?.status ?? "missing",
    };
  });
}
const commit = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const baseline = /^(?![-\s])(?!.*\s$)[^\0\r\n]{1,160}$/;
const runIdentity = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const interpretation = "Execution coverage, observed failures and declared behavior assertions are separate evidence";
const unavailableReason =
  "Change analysis exceeded its supported evidence bounds or its sealed Git inputs are unavailable.";

/** Read complete historical JSON, without the display reader's string truncation. */
function historicalReader(root: string, runId: string, budget: { bytes: number }) {
  const dir = safeArtifactPath(root, runId),
    manifest = readArtifactManifest(dir);
  if (!manifest) throw new Error("Sealed manifest required");
  return <T>(name: string): T | undefined => {
    const entry = manifest.files.find((item) => item.path === name);
    if (!entry) return undefined;
    budget.bytes += entry.bytes;
    if (entry.bytes > 33_554_432 || budget.bytes > 134_217_728)
      throw new Error("Historical evidence read budget exceeded");
    const file = safeArtifactPath(dir, name),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.size !== entry.bytes) throw new Error("Historical evidence changed");
    const bytes = readFileSync(file);
    if (sha256(bytes) !== entry.sha256) throw new Error("Historical evidence hash mismatch");
    return redactValue(JSON.parse(bytes.toString("utf8")), { maxStringLength: Infinity }) as T;
  };
}
function tree(repo: string, revision: string, prefix: string) {
  return new Map(
    reproductionGit(repo, ["ls-tree", "-r", "-z", revision, "--", prefix || "."], undefined, false)
      .split("\0")
      .filter(Boolean)
      .map((row) => {
        const match = row.match(/^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/);
        if (!match) throw new Error("Unknown Git tree entry");
        return [match[4]!, { mode: match[1]!, type: match[2]!, hash: match[3]! }] as const;
      }),
  );
}
function blob(repo: string, hash: string): Buffer {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "cat-file", "blob", hash],
    {
      cwd: repo,
      env: baseEnvironment(),
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1_048_576,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
function noMeasurement(
  path: string,
  status: "deleted" | "unsupported",
  reasons: string[],
  structure?: StructureSnapshot,
): ChangeFileAssessment {
  return {
    ...analyzeChangedFile({
      path,
      changedLines: [],
      source: "",
      root: structure?.source.projectRoot ?? ".",
      structure,
    }),
    status,
    behavior: "unknown",
    contracts: [],
    failureEvidence: [],
    interpretation,
    execution: {
      status: "unknown",
      lines: { total: null, covered: null },
      functions: { total: null, covered: null },
      branches: { total: null, covered: null },
      reasons,
    },
  };
}
export function buildChangeVerification(context: ProjectContext, runId: string, baseRef: string) {
  if (!runIdentity.test(runId) || !baseline.test(baseRef)) throw new Error("Invalid run or baseline identity");
  const repository = new FileArtifactRepository(context.artifactRoot),
    integrity = repository.verify(runId);
  if (integrity.status !== "verified" || !integrity.manifestHash) throw new Error("Sealed evidence required");
  const evidenceBudget = { bytes: 0 },
    read = historicalReader(context.artifactRoot, runId, evidenceBudget);
  const run = parseRunSnapshot(read("run.json")) as RunSnapshot,
    recorded = run.evidence?.reproduction;
  if (!recorded || run.runId !== runId || run.status === "running" || !commit.test(recorded.gitCommit ?? ""))
    throw new Error("Completed version-bound project evidence required");
  const current = recorded.gitCommit!;
  const repo = reproductionGit(context.projectRoot, ["rev-parse", "--show-toplevel"], undefined, false).replace(
    /\r?\n$/,
    "",
  );
  const base = reproductionGit(repo, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  if (!commit.test(base)) throw new Error("Commit baseline required");
  reproductionGit(repo, ["cat-file", "-e", `${current}^{commit}`]);
  reproductionGit(repo, ["merge-base", "--is-ancestor", base, current]);
  const projectPath = recorded.projectPath ?? ".";
  if (
    projectPath !== "." &&
    (projectPath.startsWith("/") ||
      projectPath.includes("\\") ||
      projectPath.split("/").some((part) => !part || part === "." || part === ".."))
  )
    throw new Error("Portable project identity required");
  const prefix = projectPath === "." ? "" : `${projectPath}/`;
  const proof = read<{ before?: { commitMatches?: boolean }; after?: { commitMatches?: boolean } }>(
    "execution-source.json",
  );
  const reasons = executionSourceReasons(proof, run, "Run");
  if (proof?.before?.commitMatches !== true || proof?.after?.commitMatches !== true)
    reasons.push("Execution evidence does not establish that all tracked inputs matched the recorded commit");
  if (recorded.gitDirty !== false) reasons.push("The run did not record a clean tracked source state");
  if ((relative(repo, context.projectRoot).replaceAll("\\", "/") || ".") !== projectPath)
    reasons.push("The bound project path differs from the recorded project");
  const inventory = read<{ files: Array<{ path: string; bytes: number; sha256: string }> }>("source-inventory.json");
  if (!inventory || stableHash(inventory) !== recorded.sourceHash)
    reasons.push("The retained source inventory does not match the run identity");
  const selectedPlan = projectChecksConfigSchema.parse(read("check-plan.json"));
  const checkIds = new Set((run.checks ?? []).map((check) => check.id));
  if (
    checkIds.size !== (run.checks ?? []).length ||
    (run.checks ?? []).some((check) => !selectedPlan.checks.some((item) => item.id === check.id))
  )
    throw new Error("Executed check identities do not match the retained plan");
  if (stableHash(selectedPlan) !== recorded.configHash)
    reasons.push("The retained check plan does not match the executed configuration");
  const originalRaw = read("ci-original-plan.json");
  const originalPlan = originalRaw ? projectChecksConfigSchema.parse(originalRaw) : selectedPlan;
  if (
    selectedPlan.checks.some(
      (check) => stableHash(originalPlan.checks.find((item) => item.id === check.id)) !== stableHash(check),
    )
  )
    reasons.push("The original selection plan does not preserve executed check definitions");
  if (!originalRaw && run.checkSelection?.mode === "reduced")
    reasons.push("The original check plan was not retained for this reduced run");
  const source: ChangeVerificationSource = {
    status: reasons.length ? "unavailable" : "verified",
    projectPath,
    sourceHash: recorded.sourceHash,
    configHash: recorded.configHash,
    ...(proof ? { executionSourceHash: stableHash(proof) } : {}),
    reasons: [...new Set(reasons)],
  };
  const candidateStructure = read<StructureSnapshot>("structure.json");
  const structure =
    candidateStructure?.v === 1 &&
    candidateStructure.kind === "canary.structure" &&
    candidateStructure.source?.runId === runId &&
    candidateStructure.source.gitCommit === current &&
    Array.isArray(candidateStructure.nodes)
      ? candidateStructure
      : undefined;
  const diagnostics = buildRunDiagnostics(run, structure?.source.projectRoot ?? context.projectRoot);
  const contracts = evaluateBehaviorContracts(originalPlan, run.checks ?? []).map((contract) =>
    source.status === "verified" ? contract : { ...contract, status: "unknown" as const },
  );
  const coverageSources: Array<{ coverage: CoverageSummary; manifest?: CoverageManifest }> = [];
  if (source.status === "verified") {
    const coverage = read<CoverageSummary>("coverage.json") ?? run.coverage;
    if (coverage)
      coverageSources.push({
        coverage: parseCoverageSummary(coverage) as CoverageSummary,
        manifest: read("coverage-manifest.json"),
      });
    for (const check of run.checks ?? [])
      if (check.childRun) {
        const childIntegrity = repository.verify(check.childRun.runId);
        if (childIntegrity.status !== "verified" || childIntegrity.manifestHash !== check.childRun.manifestHash)
          throw new Error("Child coverage evidence changed");
        const childRead = historicalReader(context.artifactRoot, check.childRun.runId, evidenceBudget);
        const child = parseRunSnapshot(childRead("run.json")) as RunSnapshot;
        const childCoverage = childRead<CoverageSummary>("coverage.json") ?? child.coverage;
        if (childCoverage)
          coverageSources.push({
            coverage: parseCoverageSummary(childCoverage) as CoverageSummary,
            manifest: childRead("coverage-manifest.json"),
          });
      }
  }
  const raw = reproductionGit(
    repo,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-status",
      "-z",
      base,
      current,
      "--",
      prefix || ".",
    ],
    undefined,
    false,
  ).split("\0");
  const changes: Array<{ status: string; fullPath: string; path: string }> = [];
  for (let index = 0; index < raw.length - 1; index += 2) {
    const status = raw[index]!,
      fullPath = raw[index + 1]!;
    if (!status || !fullPath || !["A", "M", "D", "T"].includes(status) || (prefix && !fullPath.startsWith(prefix)))
      throw new Error("Unsupported change identity");
    changes.push({ status, fullPath, path: prefix ? fullPath.slice(prefix.length) : fullPath });
  }
  if (changes.length > 500) throw new Error("Changed-file review budget exceeded");
  const currentTree = tree(repo, current, prefix),
    files: ChangeFileAssessment[] = [];
  let readBytes = 0,
    changedLineCount = 0;
  for (const change of changes) {
    const failureEvidence = diagnostics.failures
      .filter((failure) => failure.locations.some((location) => location.path === change.path))
      .map((failure) => failure.id);
    if (change.status === "D") {
      files.push({
        ...noMeasurement(
          change.path,
          "deleted",
          ["Deleted source has no execution measurement at the current revision"],
          structure,
        ),
        failureEvidence,
      });
      continue;
    }
    const entry = currentTree.get(change.fullPath);
    if (!entry || entry.type !== "blob" || !/^100(?:644|755)$/.test(entry.mode)) {
      files.push({
        ...noMeasurement(
          change.path,
          "unsupported",
          ["Symlinks, submodules and unknown file modes require separate review"],
          structure,
        ),
        failureEvidence,
      });
      continue;
    }
    const size = Number(reproductionGit(repo, ["cat-file", "-s", entry.hash]));
    if (!Number.isSafeInteger(size) || size > 1_048_576 || readBytes + size > 8_388_608) {
      files.push({
        ...noMeasurement(
          change.path,
          "unsupported",
          ["Historical source exceeds the supported byte budget"],
          structure,
        ),
        failureEvidence,
      });
      continue;
    }
    const bytes = blob(repo, entry.hash);
    readBytes += bytes.length;
    let text: string;
    try {
      if (bytes.includes(0)) throw new Error();
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      files.push({
        ...noMeasurement(
          change.path,
          "unsupported",
          ["Binary or non-UTF-8 source has no reliable execution mapping"],
          structure,
        ),
        failureEvidence,
      });
      continue;
    }
    const retained = inventory?.files.find((file) => file.path === change.path);
    if (retained && retained.sha256 !== sha256(bytes)) {
      const crlf = text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
      if (retained.bytes === Buffer.byteLength(crlf) && retained.sha256 === sha256(crlf)) text = crlf;
      else {
        files.push({
          ...noMeasurement(
            change.path,
            "unsupported",
            ["Historical blob does not match the retained source bytes"],
            structure,
          ),
          failureEvidence,
        });
        continue;
      }
    }
    const diff = reproductionGit(
      repo,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--text",
        "--unified=0",
        base,
        current,
        "--",
        change.fullPath,
      ],
      undefined,
      false,
    );
    const changedLines: number[] = [];
    for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(match[1]),
        length = match[2] === undefined ? 1 : Number(match[2]);
      if (changedLines.length + length > 100_000 || changedLineCount + length > 200_000)
        throw new Error("Changed-line review budget exceeded");
      changedLineCount += length;
      for (let offset = 0; offset < length; offset++) changedLines.push(start + offset);
    }
    const applicable = contracts.filter((contract) =>
      contract.paths.some((pattern) => matchesBehaviorPath(change.path, pattern)),
    );
    files.push({
      ...analyzeChangedFile({
        path: change.path,
        changedLines,
        source: text,
        structure,
        root: structure?.source.projectRoot ?? context.projectRoot,
        coverageSources,
      }),
      status: change.status === "A" ? "added" : "modified",
      failureEvidence,
      contracts: applicable,
      behavior: applicable.some((contract) => contract.status === "failed")
        ? "declared-assertion-failed"
        : applicable.length && applicable.every((contract) => contract.status === "verified")
          ? "declared-assertions-verified"
          : "unknown",
      interpretation,
    });
  }
  const checks = run.checks ?? [],
    planned = Math.max(originalPlan.checks.length, run.checkSelection?.planned ?? 0);
  const executed = checks.filter((check) => check.status !== "excluded").length;
  const excluded = checks.length - executed,
    omitted = Math.max(0, originalPlan.checks.length - selectedPlan.checks.length);
  const result = {
    v: 2,
    kind: "canary.change-verification",
    runId,
    baseline: base,
    commit: current,
    manifestHash: integrity.manifestHash,
    source,
    files,
    contracts,
    summary: deriveChangeSummary(files, source),
    assessment: source.status === "verified" ? "analyzed" : "evidence-insufficient",
    checks: {
      planned,
      executed,
      passed: checks.filter((check) => check.status === "passed").length,
      failed: checks.filter((check) => check.status === "failed").length,
      blocked: checks.filter((check) => check.status === "blocked").length,
      excluded,
      omitted,
      missing: Math.max(0, planned - executed - excluded - omitted),
    },
    limitations: [
      "Only the selected historical commit and retained check evidence are analyzed; current working-tree edits are excluded.",
      "Known execution denominators are summed separately from unknown files. Code execution does not establish behavior verification.",
      "Only explicit required behavior contracts gate project CI. Verification gaps and inferred relationships do not create new gates.",
      "Renames are assessed as deleted and added paths. Deleted, binary, oversized and unsupported source remains unknown.",
      "Source observations cover execution boundaries and declared tracked inputs, not continuous filesystem attestation or an operating-system sandbox.",
    ],
    inference: [],
    gates: "Only explicitly required project contracts affect CI",
    interpretation,
  };
  if (repository.verify(runId).manifestHash !== integrity.manifestHash)
    throw new Error("Source evidence changed during analysis");
  return changeVerificationV2Schema.parse(redactValue(result, { maxStringLength: Infinity }));
}
export function saveChangeVerification(context: ProjectContext, runId: string, baseRef: string) {
  const report = buildChangeVerification(context, runId, baseRef);
  updateArtifact(join(context.artifactRoot, runId), "change-verification.json", report, { maxStringLength: Infinity });
  return report;
}
export function saveUnavailableChangeVerification(context: ProjectContext, runId: string) {
  const result = { v: 1, kind: "canary.change-verification-unavailable", runId, reason: unavailableReason };
  if (new FileArtifactRepository(context.artifactRoot).verify(runId).status === "verified")
    updateArtifact(join(context.artifactRoot, runId), "change-verification.json", result);
  return result;
}
export async function changeVerificationCommand(args: string[]): Promise<number> {
  const runId = args[0],
    flags = new Map<string, string>(),
    toggles = new Set<string>();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!;
    if (["--json", "--summary"].includes(flag) && !toggles.has(flag)) {
      toggles.add(flag);
      continue;
    }
    if (
      !["--base", "--project", "--config"].includes(flag) ||
      flags.has(flag) ||
      !args[index + 1] ||
      args[index + 1]!.startsWith("--")
    )
      return 2;
    flags.set(flag, args[++index]!);
  }
  if (!runId || !runIdentity.test(runId) || !baseline.test(flags.get("--base") ?? "")) return 2;
  const context = resolveProjectContext({ cwd: flags.get("--project"), configPath: flags.get("--config") });
  try {
    const report = saveChangeVerification(context, runId, flags.get("--base")!);
    const summary = {
      v: 1,
      kind: "canary.change-verification-operation",
      runId,
      assessment: report.assessment,
      stored: true,
      source: report.source,
      checks: report.checks,
      summary: { ...report.summary, gaps: report.summary.gaps.slice(0, 12) },
      omittedGaps: Math.max(0, report.summary.gaps.length - 12),
    };
    console.log(
      JSON.stringify(
        toggles.has("--summary")
          ? Buffer.byteLength(JSON.stringify(summary)) <= 60_000
            ? summary
            : { v: 1, kind: summary.kind, runId, assessment: report.assessment, stored: true, evidenceOmitted: true }
          : report,
      ),
    );
    return 0;
  } catch {
    try {
      console.log(JSON.stringify(saveUnavailableChangeVerification(context, runId)));
    } catch {
      console.error(unavailableReason);
    }
    return 5;
  }
}
