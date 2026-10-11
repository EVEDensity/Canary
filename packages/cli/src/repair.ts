import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { projectChecksConfigSchema, type ProjectContext } from "@canary/core";
import { RunStore, stableHash, updateArtifact, redactValue, buildRunDiagnostics } from "@canary/trace";
import { auditTestChanges } from "@canary/structure";
import { isInsideRoot } from "./home.js";
import { runProjectChecks } from "./project-run.js";
import { blocked } from "./check-executor.js";
import { baselineMatches, executionSourceReasons, sourceFingerprint } from "./source-identity.js";
import {
  parseReproductionOptions,
  reproductionSource,
  initialConditions,
  executionConditions,
  prepareReproduction,
  executablePlan,
  baseEnvironment,
  homes,
  reproductionGit,
  reproductionDependencies,
} from "./reproduction.js";

const print = (value: unknown) =>
  console.log(JSON.stringify(redactValue(value, { maxStringLength: Infinity }), null, 2));
export async function repairCommand(args: string[]): Promise<number> {
  const [baselineId, candidateId, ...flags] = args;
  if (!baselineId || !candidateId) {
    console.error("Use canary repair <baseline> <candidate> --regression <check> --test <path> [--execute]");
    return 2;
  }
  let candidateWorkspace: string | undefined;
  const tests: string[] = [],
    regression: string[] = [],
    shared: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--candidate-workspace") {
      candidateWorkspace = flags[++i];
      if (!/^repro_[a-f0-9-]{36}$/.test(candidateWorkspace ?? "")) return 2;
      continue;
    }
    if (["--test", "--regression"].includes(flags[i]!)) {
      const target = flags[i] === "--test" ? tests : regression;
      if (!flags[i + 1] || flags[i + 1]!.startsWith("--")) return 2;
      target.push(flags[++i]!);
    } else shared.push(flags[i]!);
  }
  if (
    !tests.length ||
    !regression.length ||
    tests.some(
      (path) =>
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
        path.includes("..") ||
        path.includes("\\") ||
        path.startsWith("/"),
    )
  )
    return 2;
  try {
    // Resolve one retained original failure, then use its collection for all three runs.
    const probe = parseReproductionOptions([baselineId, "--check", "placeholder", ...shared]);
    const { resolveProjectContext } = await import("./home.js");
    const { FileArtifactRepository } = await import("@canary/trace");
    const context = resolveProjectContext({ cwd: probe.project, configPath: probe.config });
    const repository = new FileArtifactRepository(context.artifactRoot);
    const original = repository.readRun(baselineId),
      failed = original?.checks?.find((check) => check.status === "failed");
    if (!failed) throw new Error("Original failure required");
    const options = parseReproductionOptions([baselineId, "--check", failed.id, ...shared]);
    const base = reproductionSource(options);
    const integrity = repository.verify(candidateId),
      candidate = repository.readRun(candidateId);
    if (integrity.status !== "verified" || !integrity.manifestHash || !candidate?.checks || !candidate.evidence)
      throw new Error("Sealed candidate required");
    const baselinePlan = projectChecksConfigSchema.parse(repository.readJson(baselineId, "check-plan.json"));
    const candidatePlan = projectChecksConfigSchema.parse(repository.readJson(candidateId, "check-plan.json"));
    if (stableHash(candidatePlan) !== candidate.evidence.reproduction.configHash)
      throw new Error("Candidate plan mismatch");
    const candidateSource = { ...base, run: candidate, selected: candidatePlan, parentHash: integrity.manifestHash };
    const sourceProof = (runId: string): unknown => {
      try { return repository.readJson(runId, "execution-source.json"); } catch { return undefined; }
    };
    const reasons = [
      ...initialConditions(base),
      ...initialConditions(candidateSource),
      ...executionConditions(candidateSource, options),
      ...executionSourceReasons(sourceProof(baselineId), base.run, "Original"),
      ...executionSourceReasons(sourceProof(candidateId), candidate, "Candidate"),
    ];
    for (const check of baselinePlan.checks) {
      const after = candidatePlan.checks.find((next) => next.id === check.id);
      if (!after || stableHash(check) !== stableHash(after))
        reasons.push(`Original check ${check.id} was removed or changed`);
      if (candidate.checks.find((next) => next.id === check.id)?.status !== "passed")
        reasons.push(`Original check ${check.id} did not pass after repair`);
    }
    for (const id of regression) {
      const check = candidatePlan.checks.find((item) => item.id === id);
      if (
        !check ||
        check.type !== "command" ||
        check.expectedExit !== 0 ||
        !tests.some((path) =>
          check.args.some((arg) => relative(context.projectRoot, arg) === path || arg.replace(/^\.\//, "") === path),
        )
      )
        reasons.push(`Regression ${id} must explicitly execute a supplied test file`);
      if (candidate.checks.find((item) => item.id === id)?.status !== "passed")
        reasons.push(`Regression ${id} did not pass on candidate`);
    }
    const beforeSha = base.run.evidence!.reproduction.gitCommit!,
      afterSha = candidate.evidence.reproduction.gitCommit!;
    const repo = reproductionGit(context.projectRoot, ["rev-parse", "--show-toplevel"]);
    const prefix =
      candidate.evidence.reproduction.projectPath === "." ? "" : candidate.evidence.reproduction.projectPath + "/";
    const paths = reproductionGit(repo, [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      beforeSha,
      afterSha,
      "--",
      prefix || ".",
    ])
      .split("\0")
      .filter(Boolean);
    const blob = (sha: string, path: string) => {
      try {
        return reproductionGit(repo, ["show", `${sha}:${path}`]);
      } catch {
        return undefined;
      }
    };
    const findings = auditTestChanges(
      paths.map((path) => ({
        path: prefix ? path.slice(prefix.length) : path,
        before: blob(beforeSha, path),
        after: blob(afterSha, path),
      })),
    );
    reasons.push(...findings.filter((finding) => finding.certainty === "observed")
      .map((finding) => `${finding.type}: ${finding.path} (${finding.certainty})`));
    const report: Record<string, unknown> = {
      v: 1,
      kind: "canary.repair-verification",
      outcome: "evidence-insufficient",
      original: { runId: baselineId, commit: beforeSha, manifestHash: base.parentHash },
      candidate: { runId: candidateId, commit: afterSha, manifestHash: integrity.manifestHash },
      executionSources: { original: sourceProof(baselineId), candidate: sourceProof(candidateId) },
      regressionChecks: regression,
      testFiles: tests,
      changedFiles: paths,
      findings,
      reviewRequired: findings.some((finding) => finding.certainty === "advisory"),
      reasons,
      executed: false,
      scope: "selected regression files and retained original checks; no claim of overall correctness",
    };
    if ((!options.execute && !options.prepare) || reasons.length) {
      if (options.execute) updateArtifact(join(context.artifactRoot, candidateId), "repair-verification.json", report);
      print(report);
      return 4;
    }
    const beforeWork = prepareReproduction(base, options),
      afterWork = prepareReproduction(candidateSource, {
        ...options,
        runId: candidateId,
        workspace: candidateWorkspace,
      });
    if (!baselineMatches(beforeWork.checkout, beforeSha)) throw new Error("Prepared checkout no longer matches baseline tracked inputs");
    if (options.prepare) {
      print({
        ...report,
        outcome: "prepared",
        beforeWorkspace: beforeWork.id,
        candidateWorkspace: afterWork.id,
        beforeProject: beforeWork.project,
        candidateProject: afterWork.project,
        executed: false,
        reasons: reproductionDependencies(beforeWork.project, candidatePlan, beforeWork.checkout),
      });
      return 0;
    }
    const missing = reproductionDependencies(beforeWork.project, candidatePlan, beforeWork.checkout);
    if (missing.length) {
      print({ ...report, outcome: "blocked", reasons: missing });
      return 4;
    }
    const overlays = tests.map((path) => {
      const origin = join(afterWork.project, path),
        destination = join(beforeWork.project, path);
      if (
        !existsSync(origin) ||
        !isInsideRoot(origin, afterWork.project) ||
        !isInsideRoot(destination, beforeWork.project)
      )
        throw new Error("Unsafe test overlay");
      const bytes = readFileSync(origin);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
      return { path, hash: stableHash(bytes.toString("utf8")) };
    });
    const runId = `run_${randomUUID()}`,
      store = new RunStore(),
      home = join(beforeWork.dir, "home");
    mkdirSync(home);
    const environment = {
      ...baseEnvironment(),
      ...Object.fromEntries(homes.map((name) => [name, home])),
      ...Object.fromEntries(options.env.map((name) => [name, process.env[name]])),
    };
    const executionContext: ProjectContext = {
      ...context,
      projectRoot: beforeWork.project,
      invocationRoot: beforeWork.project,
      configRoot: beforeWork.project,
      configFile: join(beforeWork.project, "canary.project.json"),
    };
    const executionSource = sourceFingerprint(beforeWork.checkout);
    const lock = join(beforeWork.dir, "execution.lock"),
      fd = openSync(lock, "wx");
    let result;
    try {
      result = await runProjectChecks(
        executablePlan(candidateSource, beforeWork.project),
        executionContext,
        { headless: true, suppressOutput: true, executionEnv: environment },
        async () => blocked(4, "environment"),
        { store, runId, lineage: { replayOf: baselineId, parentManifestHash: base.parentHash } },
      );
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
    const beforeIntegrity = repository.verify(runId);
    const diagnostics = buildRunDiagnostics(result.snapshot, beforeWork.project);
    const regressionFailed = regression.every((id) => {
      const check = result.snapshot.checks?.find((item) => item.id === id);
      return (
        check?.status === "failed" &&
        check.category === "assertion" &&
        /AssertionError|ERR_ASSERTION|not ok|FAIL|expect\(/.test(check.stderr || check.stdout || "") &&
        diagnostics.failures.some(
          (failure) => failure.checkId === id && failure.locations.some((location) => tests.includes(location.path)),
        )
      );
    });
    const unchangedTests = overlays.every(
      (overlay) => stableHash(readFileSync(join(beforeWork.project, overlay.path), "utf8")) === overlay.hash,
    );
    const observedSource = sourceFingerprint(beforeWork.checkout);
    const sourceUnchanged = executionSource.commit === beforeSha && stableHash(executionSource) === stableHash(observedSource);
    const verified = regressionFailed && unchangedTests && sourceUnchanged && beforeIntegrity.status === "verified";
    const receipt = {
      ...report,
      outcome: verified ? "verified" : "evidence-insufficient",
      executed: true,
      reasons: verified
        ? []
        : ["Regression assertion did not fail reliably on baseline, or execution changed source/test inputs"],
      beforeRegression: {
        runId,
        manifestHash: beforeIntegrity.manifestHash,
        commit: beforeSha,
        sourceUnchanged,
        executionSource,
        observedSource,
        testOverlay: overlays,
        sourceBasis: "baseline production source with candidate regression files",
      },
    };
    updateArtifact(dirname(result.artifactPath), "repair-verification.json", receipt);
    updateArtifact(join(context.artifactRoot, candidateId), "repair-verification.json", receipt);
    print(receipt);
    return verified ? 0 : 4;
  } catch (error) {
    console.error("Repair evidence is unavailable or invalid; no repair verification was established: " + String(redactValue(error instanceof Error ? error.message : "Invalid evidence", { maxStringLength: 1200 })));
    return 5;
  }
}
