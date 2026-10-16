import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  projectChecksConfigSchema,
  type ProjectChecksConfig,
  type ProjectContext,
  type RunSnapshot,
} from "@canary/core";
import {
  beginArtifacts,
  FileArtifactRepository,
  RunStore,
  sealArtifacts,
  stableHash,
  updateArtifact,
  writePrivateJson,
  redactValue,
  sha256,
} from "@canary/trace";
import { resolveProjectContext, isInsideRoot } from "./home.js";
import { selectProjectChecks } from "./project-session.js";
import { runProjectChecks } from "./project-run.js";
import { projectSourceInventory } from "./discovery.js";
import { blocked } from "./check-executor.js";

interface Options {
  runId: string;
  checkId: string;
  prepare: boolean;
  execute: boolean;
  project?: string;
  config?: string;
  workspace?: string;
  env: string[];
  services: string[];
  data: string[];
}
function parse(args: string[]): Options {
  const runId = args[0];
  if (!runId || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(runId)) throw new Error("A valid source run ID is required");
  const result: Options = { runId, checkId: "", prepare: false, execute: false, env: [], services: [], data: [] };
  const values = new Map<string, string[]>(),
    seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (["--execute", "--prepare", "--json"].includes(flag)) {
      if (seen.has(flag)) throw new Error("Repeated reproduction argument");
      seen.add(flag);
      if (flag === "--execute") result.execute = true;
      if (flag === "--prepare") result.prepare = true;
      continue;
    }
    if (
      !["--check", "--project", "--config", "--workspace", "--env", "--ack-service", "--ack-data"].includes(flag) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--")
    )
      throw new Error("Invalid reproduction arguments; use canary help");
    if (seen.has(flag) && !["--env", "--ack-service", "--ack-data"].includes(flag))
      throw new Error("Repeated reproduction argument");
    seen.add(flag);
    values.set(flag, [...(values.get(flag) ?? []), args[++i]!]);
  }
  result.checkId = values.get("--check")?.[0] ?? "";
  result.project = values.get("--project")?.[0];
  result.config = values.get("--config")?.[0];
  result.workspace = values.get("--workspace")?.[0];
  result.env = values.get("--env") ?? [];
  result.services = values.get("--ack-service") ?? [];
  result.data = values.get("--ack-data") ?? [];
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result.checkId))
    throw new Error("Select one failed check with --check <id>");
  if (result.prepare && result.execute) throw new Error("Choose --prepare or --execute");
  if (result.workspace && !/^repro_[a-f0-9-]{36}$/.test(result.workspace))
    throw new Error("Invalid prepared workspace identity");
  if (result.env.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    throw new Error("Use environment names, never values, with --env");
  return result;
}
const portable = (path: string) =>
  !isAbsolute(path) && !/^[A-Za-z]:|[\r\n\0]/.test(path) && !path.replaceAll("\\", "/").split("/").includes("..");
const runtimeNames = ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"];
const homes = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"];
function baseEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      runtimeNames.some((allowed) => allowed.toLowerCase() === name.toLowerCase()),
    ),
  );
  return {
    ...env,
    CI: "true",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}
function git(cwd: string, args: string[], environment = baseEnvironment(), trim = true): string {
  const output = execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return trim ? output.trim() : output;
}
/** Configuration data is read from sealed evidence; historical config modules are never imported. */
function source(options: Options) {
  const context = resolveProjectContext({ cwd: options.project, configPath: options.config });
  const repository = new FileArtifactRepository(context.artifactRoot);
  const integrity = repository.verify(options.runId);
  if (integrity.status !== "verified" || !integrity.manifestHash)
    throw new Error("Reproduction requires sealed, verified source evidence");
  const run = repository.readRun(options.runId);
  if (!run?.checks || run.status === "running" || !run.evidence)
    throw new Error("A completed project check run is required");
  const check = run.checks.find((item) => item.id === options.checkId);
  if (!check || !["failed", "blocked"].includes(check.status))
    throw new Error("The selected check has no recorded failure or blocking evidence");
  const config = projectChecksConfigSchema.parse(repository.readJson(options.runId, "check-plan.json"));
  if (stableHash(config) !== run.evidence.reproduction.configHash)
    throw new Error("Recorded check plan does not match source evidence");
  const selected = selectProjectChecks(config, [options.checkId]);
  return { context, repository, run, check, selected, parentHash: integrity.manifestHash };
}
type Source = ReturnType<typeof source>;
function initialConditions(input: Source): string[] {
  const recorded = input.run.evidence!.reproduction,
    reasons: string[] = [];
  if (!/^[a-f0-9]{40,64}$/.test(recorded.gitCommit ?? "")) reasons.push("Recorded Git commit is unavailable");
  if (recorded.gitDirty !== false || !recorded.projectPath || !portable(recorded.projectPath))
    reasons.push("Clean tracked source and repository-relative project identity were not recorded");
  if (
    recorded.node !== process.versions.node ||
    recorded.platform !== process.platform ||
    recorded.arch !== process.arch
  )
    reasons.push("Recorded Node version, platform or architecture differs from this runtime");
  const packageFile = fileURLToPath(new URL("../package.json", import.meta.url));
  if (recorded.toolVersions?.canary !== JSON.parse(readFileSync(packageFile, "utf8")).version)
    reasons.push("Recorded Canary version differs from the executing tool");
  for (const check of input.selected.checks) {
    const dispatcher = recorded.commandTools?.[check.id];
    if (dispatcher) {
      const helper = fileURLToPath(new URL("./auto-script.js", import.meta.url));
      if (!existsSync(helper) || sha256(readFileSync(helper)) !== dispatcher.sha256)
        reasons.push(`Recorded Canary script dispatcher differs for ${check.id}`);
    }
    if (check.type === "agent")
      reasons.push(`Agent check ${check.id} requires a separately configured evaluation environment`);
    if (!portable(check.cwd)) reasons.push(`Working directory for ${check.id} is not portable`);
    if (check.type === "filesystem" && !portable(check.path))
      reasons.push(`Filesystem target for ${check.id} is not portable`);
    if (
      (check.type === "command" || check.type === "process") &&
      (!/^[\w.+-]+$/.test(check.command) || /\[redacted\]/i.test(JSON.stringify(check.args)))
    )
      reasons.push(`Command for ${check.id} is nonportable or contains redacted arguments`);
    if (check.type === "command" || check.type === "process")
      for (const arg of check.args) {
        const tool = recorded.commandTools?.[check.id];
        const path = arg.startsWith("file://") ? fileURLToPath(arg) : arg;
        const absolute = isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path);
        if (absolute && !isInsideRoot(path, input.context.projectRoot)) {
          const helper = fileURLToPath(new URL("./auto-script.js", import.meta.url));
          if (!tool || arg !== tool.path || !existsSync(helper) || sha256(readFileSync(helper)) !== tool.sha256)
            reasons.push(`External argument path for ${check.id} cannot be restored`);
        } else if (
          !absolute &&
          (arg.includes(input.context.projectRoot) || arg.includes(input.context.projectRoot.replaceAll("\\", "/")))
        )
          reasons.push(`Embedded source path for ${check.id} is not portable`);
      }
  }
  return reasons;
}
function executionConditions(input: Source, options: Options): string[] {
  const requirements = input.selected.reproduction,
    reasons: string[] = [];
  const names = new Set([
    ...input.selected.checks.flatMap((check) => check.envAllowlist),
    ...(requirements?.requiredEnvironment ?? []),
  ]);
  for (const name of options.env) {
    if (
      !names.has(name) ||
      homes.some((home) => home.toLowerCase() === name.toLowerCase()) ||
      /^GIT_|^NODE_OPTIONS$/i.test(name)
    )
      reasons.push(`Environment forwarding is not permitted for ${name}`);
    else if (!process.env[name]) reasons.push(`Environment ${name} is missing`);
  }
  for (const name of requirements?.requiredEnvironment ?? [])
    if (!options.env.includes(name) || !process.env[name])
      reasons.push(`Required environment ${name} must be supplied explicitly with --env`);
  const services = [
    ...(requirements?.services ?? []),
    ...input.selected.checks.flatMap((check) =>
      check.type === "http" ? [`http:${check.id}`] : check.type === "docker" ? [`docker:${check.id}`] : [],
    ),
  ];
  for (const service of services)
    if (!options.services.includes(service)) reasons.push(`External service ${service} requires --ack-service`);
  if (
    options.services.some((name) => !services.includes(name)) ||
    options.data.some((name) => !requirements?.data.includes(name))
  )
    reasons.push("Acknowledgements must match recorded service and data declarations");
  for (const data of requirements?.data ?? [])
    if (!options.data.includes(data)) reasons.push(`External data ${data} requires --ack-data`);
  return reasons;
}
function prepare(input: Source, options: Options) {
  const root = join(input.context.projectRoot, ".canary", "reproductions");
  if (!isInsideRoot(root, input.context.projectRoot)) throw new Error("Unsafe reproduction workspace root");
  mkdirSync(root, { recursive: true });
  const id = options.workspace ?? `repro_${randomUUID()}`;
  const dir = join(root, id),
    checkout = join(dir, "checkout");
  if (!isInsideRoot(dir, root)) throw new Error("Unsafe prepared workspace path");
  const expected = {
    v: 1,
    kind: "canary.reproduction-workspace",
    workspaceId: id,
    sourceRunId: options.runId,
    sourceManifestHash: input.parentHash,
    commit: input.run.evidence!.reproduction.gitCommit,
    projectPath: input.run.evidence!.reproduction.projectPath,
  };
  if (options.workspace) {
    if (stableHash(JSON.parse(readFileSync(join(dir, "workspace.json"), "utf8"))) !== stableHash(expected))
      throw new Error("Prepared workspace belongs to different source evidence");
  } else {
    const repo = realpathSync.native(git(input.context.projectRoot, ["rev-parse", "--show-toplevel"]));
    const entries = git(repo, ["ls-tree", "-r", expected.commit!, "-z"]).split("\0");
    if (
      entries.some(
        (row) =>
          /^(120000|160000) /.test(row) ||
          (/\t(?:.*\/)?(?:\.env(?:\.[^\0]*)?|\.npmrc|\.pypirc|\.netrc)$/.test(row) &&
            !/\.env\.(?:example|sample|template)$/.test(row)),
      )
    )
      throw new Error("Private configuration, symlinks and submodules require separate reproduction preparation");
    mkdirSync(dir);
    mkdirSync(checkout);
    git(checkout, ["init", "-q"]);
    git(checkout, ["config", "core.autocrlf", "false"]);
    git(checkout, [
      "-c",
      "protocol.file.allow=always",
      "fetch",
      "--no-tags",
      "--depth=1",
      "--",
      pathToFileURL(repo).href,
      expected.commit!,
    ]);
    git(checkout, ["-c", "core.autocrlf=false", "checkout", "--detach", expected.commit!]);
    // Windows checkout normalization may differ from stored LF bytes. Try Git's CRLF checkout too.
    const project = resolve(checkout, expected.projectPath!);
    if (
      process.platform === "win32" &&
      stableHash(projectSourceInventory(project)) !== input.run.evidence!.reproduction.sourceHash
    ) {
      git(checkout, ["config", "core.autocrlf", "true"]);
      git(checkout, ["checkout", "--force", expected.commit!, "--", "."]);
    }
    if (stableHash(projectSourceInventory(project)) !== input.run.evidence!.reproduction.sourceHash) {
      const repository = new FileArtifactRepository(input.context.artifactRoot);
      const inventory = repository.readJson<ReturnType<typeof projectSourceInventory>>(input.run.runId, "source-inventory.json");
      if (inventory?.v === 1 && stableHash(inventory) === input.run.evidence!.reproduction.sourceHash && Array.isArray(inventory.files)) {
        for (const entry of inventory.files) {
          if (typeof entry.path !== "string" || !portable(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 16_777_216 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid retained source inventory");
          const target = resolve(project, entry.path);
          if (!existsSync(target) || !isInsideRoot(target, project)) throw new Error("Unsafe retained source position");
          const bytes = readFileSync(target);
          if (sha256(bytes) === entry.sha256) continue;
          // Restore only an exact retained hash; no heuristic normalization can authorize different source.
          const lf = bytes.toString("utf8").replaceAll("\r\n", "\n");
          const candidates = [Buffer.from(lf), Buffer.from(lf.replaceAll("\n", "\r\n"))];
          const exact = candidates.find(candidate => candidate.length === entry.bytes && sha256(candidate) === entry.sha256);
          if (exact) writeFileSync(target, exact);
        }
      }
    }
    writeFileSync(join(dir, "workspace.json"), JSON.stringify(expected, null, 2), { flag: "wx", mode: 0o600 });
  }
  if (!isInsideRoot(checkout, dir)) throw new Error("Prepared checkout escapes its workspace");
  const project = realpathSync.native(resolve(checkout, expected.projectPath!));
  if (!isInsideRoot(project, checkout)) throw new Error("Prepared project escapes its checkout");
  if (
    git(checkout, ["rev-parse", "HEAD"]) !== expected.commit ||
    stableHash(projectSourceInventory(project)) !== input.run.evidence!.reproduction.sourceHash
  )
    throw new Error("Restored source differs from the sealed source inventory; no check was executed");
  return { id, dir, checkout, project };
}
function dependencies(project: string, selected: ProjectChecksConfig, checkout: string): string[] {
  const reasons: string[] = [];
  const file = join(project, "package.json");
  if (existsSync(file)) {
    const pkg = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    const declared = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])];
    const installed = (name: string) => {
      if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) return false;
      for (let dir = project; isInsideRoot(dir, checkout); dir = dirname(dir)) {
        const manifest = join(dir, "node_modules", name, "package.json");
        if (existsSync(manifest) && isInsideRoot(manifest, checkout)) return true;
        if (dir === checkout) break;
      }
      return false;
    };
    if (declared.some((name) => !installed(name)))
      reasons.push(
        "Project dependencies are not prepared: install them in the isolated checkout, then reuse --workspace",
      );
  }
  // Python installations are not copied from the caller's private environment.
  if (
    selected.checks.some((check) => check.type === "command" && /^python3?$/.test(check.command)) &&
    existsSync(join(project, "requirements.txt"))
  )
    reasons.push("Python dependencies require an explicitly prepared project interpreter");
  return reasons;
}
function executablePlan(input: Source, project: string): ProjectChecksConfig {
  const helper = fileURLToPath(new URL("./auto-script.js", import.meta.url));
  return projectChecksConfigSchema.parse({
    ...input.selected,
    checks: input.selected.checks.map((check) => {
      let args = "args" in check ? check.args : undefined;
      // Automatic script dispatch belongs to Canary, not to the project's source checkout.
      args = args?.map((arg) => {
        if (arg === input.run.evidence!.reproduction.commandTools?.[check.id]?.path) return helper;
        const path = arg.startsWith("file://") ? fileURLToPath(arg) : arg;
        if (isAbsolute(path) && isInsideRoot(path, input.context.projectRoot)) {
          const restored = resolve(project, relative(input.context.projectRoot, path));
          return arg.startsWith("file://") ? pathToFileURL(restored).href : restored;
        }
        return arg;
      });
      return {
        ...check,
        ...("args" in check ? { args } : {}),
        envAllowlist: [
          ...new Set([
            ...check.envAllowlist,
            ...(input.selected.reproduction?.requiredEnvironment ?? []),
            ...homes,
            "CI",
          ]),
        ],
      };
    }),
  });
}
function fingerprint(
  check: RunSnapshot["checks"] extends Array<infer T> | undefined ? T : never,
  root: string,
): string {
  const error = check.stderr || check.stdout || "";
  return stableHash({
    category: check.category,
    exit: check.processExit,
    error: error
      .replaceAll(root, "<project>")
      .replaceAll(root.replaceAll("\\", "/"), "<project>")
      .replaceAll("\\", "/")
      .replace(/\r\n/g, "\n"),
  });
}
function recordBlocked(input: Source, options: Options, reasons: string[], workspaceId?: string) {
  const id = `run_${randomUUID()}`,
    store = new RunStore();
  const lineage = { replayOf: options.runId, parentManifestHash: input.parentHash };
  const dir = join(input.context.artifactRoot, id);
  store.create(1, id);
  store.update(id, {
    evidence: {
      ...input.run.evidence!,
      lineage,
      reproduction: {
        ...input.run.evidence!.reproduction,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        environmentNames: [],
        environmentHash: stableHash({}),
      },
    },
    replayOf: options.runId,
    checks: [
      {
        ...input.check,
        status: "blocked",
        evidence: "blocked",
        category: "environment",
        exitCode: 4,
        durationMs: 0,
        processExit: null,
        childRun: undefined,
        httpStatus: undefined,
        observations: undefined,
        outputTruncated: false,
        stdout: "",
        stderr: "Reproduction conditions are incomplete; no check was executed",
        outputEvidence: { stdout: [], stderr: [], policy: "bounded-redacted-lines-v1" },
      },
    ],
  });
  store.finish(id, "failed");
  beginArtifacts(dir, lineage);
  writePrivateJson(join(dir, "run.json"), store.get(id));
  const result = {
    v: 1,
    kind: "canary.reproduction-result",
    sourceRunId: options.runId,
    sourceManifestHash: input.parentHash,
    runId: id,
    workspaceId,
    commit: input.run.evidence!.reproduction.gitCommit,
    executed: false,
    outcome: "blocked",
    exitCode: 4,
    reasons,
  };
  writePrivateJson(join(dir, "reproduction.json"), result);
  sealArtifacts(dir);
  return { ...result, artifactPath: join(dir, "run.json") };
}
const print = (value: unknown) =>
  console.log(JSON.stringify(redactValue(value, { maxStringLength: Infinity }), null, 2));
export async function reproductionCommand(args: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch {
    console.error("Invalid reproduction arguments; use canary help");
    return 2;
  }
  try {
    const input = source(options);
    const initial = initialConditions(input);
    const conditions = [...initial, ...executionConditions(input, options)];
    const plan = {
      v: 1,
      kind: "canary.reproduction-plan",
      sourceRunId: options.runId,
      sourceManifestHash: input.parentHash,
      targetCommit: input.run.evidence!.reproduction.gitCommit,
      checkId: options.checkId,
      checks: input.selected.checks,
      toolVersions: input.run.evidence!.reproduction.toolVersions,
      runtime: {
        node: input.run.evidence!.reproduction.node,
        platform: input.run.evidence!.reproduction.platform,
        arch: input.run.evidence!.reproduction.arch,
      },
      requirements: input.selected.reproduction,
      conditions,
      boundary: "Separate source checkout and private home; authorized project code is not an OS sandbox",
      executed: false,
    };
    if (!options.prepare && !options.execute) {
      print({ ...plan, outcome: conditions.length ? "blocked" : "ready" });
      return conditions.length ? 4 : 0;
    }
    if (initial.length || (options.execute && conditions.length)) {
      const result = recordBlocked(input, options, conditions, options.workspace);
      print(result);
      return result.exitCode;
    }
    let workspace: ReturnType<typeof prepare>;
    try {
      workspace = prepare(input, options);
    } catch {
      const result = recordBlocked(
        input,
        options,
        [
          "Cannot restore or validate the recorded checkout; commit, source inventory, private configuration, symlinks, submodules or workspace binding need attention",
        ],
        options.workspace,
      );
      print(result);
      return 4;
    }
    if (options.prepare) {
      print({
        ...plan,
        outcome: "prepared",
        workspaceId: workspace.id,
        projectRoot: workspace.project,
        conditions: [...conditions, ...dependencies(workspace.project, input.selected, workspace.checkout)],
      });
      return 0;
    }
    const missing = dependencies(workspace.project, input.selected, workspace.checkout);
    if (missing.length) {
      print(recordBlocked(input, options, missing, workspace.id));
      return 4;
    }
    const home = join(workspace.dir, "home");
    if (!isInsideRoot(home, workspace.dir)) {
      print(recordBlocked(input, options, ["Private execution home escapes the prepared workspace"], workspace.id));
      return 4;
    }
    mkdirSync(home, { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      ...baseEnvironment(),
      ...Object.fromEntries(homes.map((name) => [name, home])),
      ...Object.fromEntries(options.env.map((name) => [name, process.env[name]])),
    };
    const selected = executablePlan(input, workspace.project);
    const runId = `run_${randomUUID()}`,
      store = new RunStore();
    const lineage = { replayOf: options.runId, parentManifestHash: input.parentHash };
    const context: ProjectContext = {
      ...input.context,
      invocationRoot: workspace.project,
      projectRoot: workspace.project,
      configRoot: workspace.project,
      configFile: join(workspace.project, "canary.project.json"),
    };
    const controller = new AbortController(),
      stop = () => controller.abort();
    const lock = join(workspace.dir, "execution.lock");
    let lockFd: number;
    try {
      lockFd = openSync(lock, "wx", 0o600);
    } catch {
      print(
        recordBlocked(
          input,
          options,
          ["Prepared workspace is already executing or has an unreleased execution lock; prepare a new workspace"],
          workspace.id,
        ),
      );
      return 4;
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const run = await runProjectChecks(
        selected,
        context,
        { headless: true, noOpen: true, suppressOutput: true, executionEnv: environment, signal: controller.signal },
        async () => blocked(4, "environment"),
        { store, runId, lineage },
      );
      const check = run.snapshot.checks?.find((item) => item.id === options.checkId);
      const executed = Boolean(check && ["passed", "failed"].includes(check.status));
      const commit = git(workspace.checkout, ["rev-parse", "HEAD"]);
      const sourceUnchanged =
        commit === input.run.evidence!.reproduction.gitCommit &&
        git(workspace.checkout, ["status", "--porcelain", "--untracked-files=no"]) === "";
      const matched =
        sourceUnchanged &&
        executed &&
        input.check.status === "failed" &&
        check!.status === "failed" &&
        !input.check.outputTruncated &&
        !check!.outputTruncated &&
        Boolean((input.check.stderr || input.check.stdout)?.trim()) &&
        fingerprint(input.check, input.context.projectRoot) === fingerprint(check!, workspace.project);
      const outcome = !executed
        ? "blocked"
        : !sourceUnchanged
          ? "source-changed"
          : check!.status === "passed"
            ? "not-reproduced"
            : matched
              ? "reproduced"
              : "failure-observed";
      const result = {
        v: 1,
        kind: "canary.reproduction-result",
        sourceRunId: options.runId,
        sourceManifestHash: input.parentHash,
        runId,
        workspaceId: workspace.id,
        commit,
        executed,
        sourceUnchanged,
        outcome,
        exitCode: sourceUnchanged ? run.exitCode : 5,
        processExit: check?.processExit,
        checkId: options.checkId,
        match: "category-exit-and-normalized-error",
        originalPlanHash: input.run.evidence!.reproduction.configHash,
        forwardedEnvironmentNames: options.env,
        acknowledgedServices: options.services,
        acknowledgedData: options.data,
        rootCauseConfirmed: false,
        artifactPath: run.artifactPath,
      };
      updateArtifact(dirname(run.artifactPath), "reproduction.json", result);
      print(result);
      return result.exitCode;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      closeSync(lockFd);
      unlinkSync(lock);
    }
  } catch {
    console.error(
      "Reproduction could not be prepared. Check arguments, sealed evidence and recorded project plan; no private configuration is loaded.",
    );
    return 5;
  }
}
// Shared version restoration and environment boundary for repair verification.
export { parse as parseReproductionOptions, source as reproductionSource, initialConditions, executionConditions, prepare as prepareReproduction, executablePlan, baseEnvironment, homes, git as reproductionGit, dependencies as reproductionDependencies };
