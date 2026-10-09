import { createHash } from "node:crypto";
import { isAbsolute, relative, join } from "node:path";
import type { CoverageSummary, CoverageManifest, ProjectCheckResult, ProjectChecksConfig } from "@canary/core";
import type { StructureSnapshot } from "@canary/structure";
import { FileArtifactRepository, updateArtifact, redactValue, buildRunDiagnostics } from "@canary/trace";
import { resolveProjectContext } from "./home.js";
import { reproductionGit } from "./reproduction.js";

export function evaluateBehaviorContracts(config: ProjectChecksConfig, checks: ProjectCheckResult[]) {
  return (config.contracts ?? []).map((contract) => {
    const check = checks.find((item) => item.id === contract.checkId);
    let assertion: { id: string; passed: boolean } | undefined;
    try {
      const report = JSON.parse(check?.stdout ?? "");
      if (
        report.v === 1 &&
        report.kind === "canary.assertions" &&
        report.method === "deterministic" &&
        Array.isArray(report.results) &&
        !check?.outputTruncated
      ) {
        const matched = report.results.filter(
          (item: unknown) => item && typeof item === "object" && (item as { id?: string }).id === contract.assertionId,
        );
        if (matched.length === 1 && typeof matched[0].passed === "boolean") assertion = matched[0];
      }
    } catch {
      /* An ordinary passing command is not assertion evidence. */
    }
    return {
      ...contract,
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
const matches = (path: string, pattern: string) =>
  new RegExp(
    "^" +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("**", "\0")
        .replaceAll("*", "[^/]*")
        .replaceAll("\0", ".*") +
      "$",
  ).test(path);
const overlaps = (start: number, end: number, lines: number[]) => lines.some((line) => start <= line && line <= end);
/** Changed execution evidence and explicit behavior evidence remain independent axes. */
export function analyzeChangedFile(input: {
  path: string;
  changedLines: number[];
  source: string;
  coverage?: CoverageSummary;
  manifest?: CoverageManifest;
  structure?: StructureSnapshot;
  root: string;
}) {
  const hash = createHash("sha256").update(input.source).digest("hex");
  const file = input.coverage?.files?.find((file) => {
    const path = isAbsolute(file.filePath) ? relative(input.root, file.filePath).replaceAll("\\", "/") : file.filePath;
    return path === input.path;
  });
  const recordedHash = file?.sourceText ? createHash("sha256").update(file.sourceText).digest("hex") : hash;
  const sameSource =
    !file?.sourceText || file.sourceText.replace(/\r\n/g, "\n") === input.source.replace(/\r\n/g, "\n");
  const known =
    input.coverage?.status === "final" &&
    file?.status === "final" &&
    file.quality?.precision === "exact" &&
    sameSource &&
    (file.sourceHash === recordedHash || file.sourceHash === recordedHash.slice(0, 16));
  const selectedLines = known
    ? (file.executableLineNumbers ?? []).filter((line) => input.changedLines.includes(line))
    : [];
  const coveredLines = selectedLines.filter((line) => file?.coveredLineNumbers?.includes(line));
  const manifest = input.manifest?.files.find(
    (manifest) => manifest.filePath === file?.filePath && manifest.sourceHash === file?.sourceHash,
  );
  const functions =
    manifest?.functionLocations.filter((location) =>
      overlaps(location.start.line, location.end.line, input.changedLines),
    ) ?? [];
  const branches =
    manifest?.branchLocations.filter((location) =>
      overlaps(location.start.line, location.end.line, input.changedLines),
    ) ?? [];
  const metric = (locations: typeof functions, ids?: string[]) =>
    known && manifest
      ? {
          total: locations.length,
          covered: ids ? locations.filter((location) => location.id && ids.includes(location.id)).length : null,
        }
      : { total: null, covered: null };
  return {
    path: input.path,
    changedLines: input.changedLines,
    execution: {
      status: known ? "measured" : "unknown",
      lines:
        known && file?.executableLineNumbers && file.coveredLineNumbers
          ? { total: selectedLines.length, covered: coveredLines.length }
          : { total: null, covered: null },
      functions: metric(functions, file?.coveredFunctionIds),
      branches: metric(branches, file?.coveredBranchIds),
    },
    nodes: (input.structure?.nodes ?? [])
      .filter(
        (node) =>
          node.path === input.path &&
          (node.kind === "file" || (node.line && overlaps(node.line, node.endLine ?? node.line, input.changedLines))),
      )
      .map((node) => ({ id: node.id, kind: node.kind, line: node.line })),
    interpretation: "Execution coverage does not establish behavior verification",
  };
}
export async function changeVerificationCommand(args: string[]): Promise<number> {
  const runId = args[0];
  const flags = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--json") continue;
    if (
      !["--base", "--project", "--config"].includes(args[i]!) ||
      flags.has(args[i]!) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--")
    )
      return 2;
    flags.set(args[i]!, args[++i]!);
  }
  if (!runId || !flags.get("--base")) return 2;
  try {
    const context = resolveProjectContext({ cwd: flags.get("--project"), configPath: flags.get("--config") });
    const repository = new FileArtifactRepository(context.artifactRoot),
      integrity = repository.verify(runId),
      run = repository.readRun(runId);
    if (integrity.status !== "verified" || !run?.evidence || run.evidence.reproduction.gitDirty !== false)
      throw new Error("Version-bound evidence required");
    const current = run.evidence.reproduction.gitCommit!,
      repo = reproductionGit(context.projectRoot, ["rev-parse", "--show-toplevel"]);
    const base = reproductionGit(repo, ["rev-parse", "--verify", `${flags.get("--base")}^{commit}`]);
    if (!/^[a-f0-9]{40,64}$/.test(base) || !/^[a-f0-9]{40,64}$/.test(current))
      throw new Error("Commit identity required");
    const projectPath = run.evidence.reproduction.projectPath ?? ".",
      prefix = projectPath === "." ? "" : projectPath + "/";
    const raw = reproductionGit(repo, [
      "diff",
      "--no-renames",
      "--name-status",
      "-z",
      base,
      current,
      "--",
      prefix || ".",
    ]).split("\0");
    const structure = repository.readJson<StructureSnapshot>(runId, "structure.json");
    const plan =
      repository.readJson<ProjectChecksConfig>(runId, "ci-original-plan.json") ??
      repository.readJson<ProjectChecksConfig>(runId, "check-plan.json");
    const contracts = plan ? evaluateBehaviorContracts(plan, run.checks ?? []) : [];
    const diagnostics = buildRunDiagnostics(run, structure?.source.projectRoot ?? context.projectRoot);
    const coverageSources: Array<{ coverage: CoverageSummary; manifest?: CoverageManifest }> = [];
    if (run.coverage)
      coverageSources.push({ coverage: run.coverage, manifest: repository.readJson(runId, "coverage-manifest.json") });
    for (const check of run.checks ?? [])
      if (check.childRun) {
        const child = repository.readRun(check.childRun.runId);
        if (child?.coverage && repository.verify(child.runId).manifestHash === check.childRun.manifestHash)
          coverageSources.push({
            coverage: child.coverage,
            manifest: repository.readJson(child.runId, "coverage-manifest.json"),
          });
      }
    const files = [];
    for (let i = 0; i < raw.length - 1; i += 2) {
      const status = raw[i]!,
        fullPath = raw[i + 1]!,
        path = prefix ? fullPath.slice(prefix.length) : fullPath;
      if (!status || !fullPath) continue;
      if (status === "D") {
        files.push({ path, status: "deleted", execution: { status: "unknown" }, behavior: "unknown", nodes: [] });
        continue;
      }
      const source = reproductionGit(repo, ["show", `${current}:${fullPath}`]);
      // Use exact historical blob bytes, never current worktree text or guessed newlines.
      const exact = readGitBlob(repo, `${current}:${fullPath}`);
      const diff = reproductionGit(repo, ["diff", "--no-renames", "--unified=0", base, current, "--", fullPath]);
      const lines = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].flatMap((match) =>
        Array.from({ length: match[2] === undefined ? 1 : Number(match[2]) }, (_, index) => Number(match[1]) + index),
      );
      const evaluations = coverageSources.map(({ coverage, manifest }) =>
        analyzeChangedFile({
          path,
          changedLines: lines,
          source: exact ?? source,
          coverage,
          manifest,
          structure,
          root: structure?.source.projectRoot ?? context.projectRoot,
        }),
      );
      const assessment =
        evaluations.find((value) => value.execution.status === "measured") ??
        analyzeChangedFile({
          path,
          changedLines: lines,
          source: exact ?? source,
          structure,
          root: context.projectRoot,
        });
      const applicable = contracts.filter((contract) => contract.paths.some((pattern) => matches(path, pattern)));
      files.push({
        ...assessment,
        status: status === "A" ? "added" : "modified",
        failureEvidence: diagnostics.failures
          .filter((failure) => failure.locations.some((location) => location.path === path))
          .map((failure) => failure.id),
        contracts: applicable,
        behavior: applicable.some((contract) => contract.status === "failed")
          ? "declared-assertion-failed"
          : applicable.length && applicable.every((contract) => contract.status === "verified")
            ? "declared-assertions-verified"
            : "unknown",
      });
    }
    const report = {
      v: 1,
      kind: "canary.change-verification",
      runId,
      baseline: base,
      commit: current,
      manifestHash: integrity.manifestHash,
      files,
      contracts,
      inference: [],
      gates: "Only explicitly required project contracts affect CI",
      interpretation:
        "Coverage, observed failures and behavior assertions are separate evidence; missing evidence is unknown",
    };
    updateArtifact(join(context.artifactRoot, runId), "change-verification.json", report);
    console.log(JSON.stringify(redactValue(report, { maxStringLength: Infinity }), null, 2));
    return 0;
  } catch {
    console.error("Change verification requires sealed, clean, version-bound evidence and readable Git objects");
    return 5;
  }
}
function readGitBlob(repo: string, revision: string): string | undefined {
  // The generic Git helper trims terminal whitespace; hashes require exact blob bytes.
  try {
    return reproductionGit(repo, ["show", revision], undefined, false);
  } catch {
    return undefined;
  }
}
