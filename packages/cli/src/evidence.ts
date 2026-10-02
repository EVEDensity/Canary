import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanaryConfig, ProjectChecksConfig, ProjectContext, RunEvidence, RunLineage, RunSnapshot, TestCase } from "@canary/core";
import { SECRET_KEY, sha256, stableHash } from "@canary/trace";

export function recordEvidence(
  config: CanaryConfig | ProjectChecksConfig,
  context: ProjectContext,
  cases: TestCase[],
  lineage: RunLineage,
  sourceHash: string,
  environment: NodeJS.ProcessEnv = process.env,
): RunEvidence {
  const repro = "artifacts" in config ? config.artifacts?.reproducibility : undefined;
  const environmentNames = [...new Set(repro?.envAllowlist ?? ("checks" in config ? config.checks.flatMap((check) => check.envAllowlist) : []))].filter((name) => !SECRET_KEY.test(name)).sort();
  const lockfiles: Record<string, string> = {};
  for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "uv.lock", "poetry.lock"]) {
    const file = join(context.projectRoot, name);
    if (existsSync(file)) lockfiles[name] = sha256(readFileSync(file));
  }
  let gitCommit: string | undefined;
  let gitDirty: boolean | undefined, projectPath: string | undefined;
  const toolVersions: Record<string, string> = { node: process.versions.node };
  const packageFile = fileURLToPath(new URL("../package.json", import.meta.url));
  if (existsSync(packageFile)) toolVersions.canary = JSON.parse(readFileSync(packageFile, "utf8")).version;
  const helperFile = fileURLToPath(new URL("./auto-script.js", import.meta.url));
  if (existsSync(helperFile)) toolVersions.scriptDispatcher = sha256(readFileSync(helperFile));
  const commandTools: NonNullable<RunEvidence["reproduction"]["commandTools"]> = {};
  if ("checks" in config && existsSync(helperFile)) for (const check of config.checks)
    if (check.type === "command" && check.command === "node" && check.args[0] === helperFile)
      commandTools[check.id] = { kind: "canary-script", path: helperFile, sha256: toolVersions.scriptDispatcher! };
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: context.projectRoot,
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[a-f0-9]{40,64}$/.test(value)) gitCommit = value;
    const git = (args: string[]) => execFileSync("git", args, { cwd: context.projectRoot, encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
    gitDirty = git(["status", "--porcelain", "--untracked-files=no"]) !== "";
    projectPath = relative(git(["rev-parse", "--show-toplevel"]), context.projectRoot).replaceAll("\\", "/") || ".";
    toolVersions.git = git(["--version"]);
  } catch {
    /* non-Git fixtures still have source/config hashes */
  }
  return {
    v: 1,
    lineage,
    reproduction: {
      configHash: stableHash(config),
      casesHash: stableHash("checks" in config ? config.checks : cases),
      sourceHash,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      gitCommit,
      gitDirty,
      projectPath,
      toolVersions,
      commandTools,
      lockfiles,
      environmentNames,
      environmentHash: stableHash(
        Object.fromEntries(environmentNames.map((name) => [name, environment[name] ?? null])),
      ),
      clock: repro?.clock,
      seed: repro?.seed,
      mode: repro?.clock !== undefined || repro?.seed !== undefined ? "context-clock-random" : "recorded",
    },
  };
}

/** Comparable conclusions deliberately omit wall-clock duration and generated execution/trajectory IDs. */
export function conclusionHash(run: RunSnapshot): string {
  return stableHash({
    status: run.status,
    ...(run.checks ? { checks: run.checks.map(({ id, status, category, processExit }) => ({ id, status, category, processExit })) } : {}),
    results: run.results
      .map((result) => ({
        caseId: result.caseId,
        repetition: result.repetition,
        passed: result.passed,
        failureCategory: result.failureCategory,
        assertions: result.assertions.map((assertion) => ({ id: assertion.id, passed: assertion.passed })),
        output: result.output,
      }))
      .sort((a, b) => `${a.caseId}#${a.repetition ?? 1}`.localeCompare(`${b.caseId}#${b.repetition ?? 1}`)),
  });
}
