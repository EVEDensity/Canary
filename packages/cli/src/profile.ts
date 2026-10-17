import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { PROFILE_LIMITS, projectProfileSchema, type ProjectContext, type ProjectProfile, type ProfileStage } from "@canary/core";
import { buildStructure } from "@canary/structure";
import {
  FileArtifactRepository,
  QualityAssessmentError,
  readArtifactManifest,
  readQualityAssessment,
  stableHash,
} from "@canary/trace";
import { discoverProject, projectSourceInventory } from "./discovery.js";
import { resolveProjectContext } from "./home.js";
import { queryProjectMemory } from "./project-memory.js";

export { PROFILE_LIMITS } from "@canary/core";
export type { ProjectProfile, ProfileStage } from "@canary/core";
type StageId = ProfileStage["id"];
type Observation = Omit<ProfileStage, "id" | "timingMs" | "consistent">;
export class ProfileInputError extends Error {
  readonly code = "PROFILE_INPUT";
}
class ProfileBoundError extends Error {}
const excluded = new Set([
  ".git",
  ".canary",
  "node_modules",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  "target",
]);

/** Bound directory traversal before calling the existing read-only analysis helpers. */
function inspectTree(root: string, source: boolean): { files: number; bytes: number } {
  let entries = 0,
    files = 0,
    bytes = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > PROFILE_LIMITS.depth) throw new ProfileBoundError();
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProfileBoundError();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > PROFILE_LIMITS.entries) throw new ProfileBoundError();
      if (source && excluded.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        // Root declarations are read directly by discovery and TypeScript configuration lookup.
        if (!source || depth === 0) throw new ProfileBoundError();
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path, depth + 1);
      } else if (entry.isFile()) {
        if (source && !/\.(?:[cm]?[jt]sx?|py|toml|json|ya?ml|go|rs|lock)$/i.test(entry.name) && entry.name !== "go.mod")
          continue;
        const file = lstatSync(path);
        if (!file.isFile() || file.isSymbolicLink() || (!source && file.nlink !== 1)) throw new ProfileBoundError();
        files++;
        bytes += file.size;
        if (
          file.size > PROFILE_LIMITS.fileBytes ||
          files > PROFILE_LIMITS.sourceFiles ||
          bytes > (source ? PROFILE_LIMITS.sourceBytes : PROFILE_LIMITS.artifactBytes)
        )
          throw new ProfileBoundError();
      } else if (!source) throw new ProfileBoundError();
    }
  };
  visit(root, 0);
  return { files, bytes };
}

/** Git status must not refresh the index or invoke a configured fsmonitor while profiling. */
function readOnlyGit<T>(operation: () => T): T {
  const overrides = {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: "/dev/null",
  };
  const before = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return operation();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const unavailable = (code: string, nextAction: string): Observation => ({ status: "unavailable", code, nextAction });
const blocked = (code: string, nextAction: string): Observation => ({ status: "blocked", code, nextAction });
const measured = (code: string, counts: Record<string, number>, bytes?: number, inputHash?: string): Observation => ({
  status: "measured",
  code,
  counts,
  ...(bytes === undefined ? {} : { bytes }),
  ...(inputHash ? { inputHash } : {}),
  nextAction: "No action required for this measurement.",
});

/** Measures Canary analysis only. It never imports project config/cases or executes a check, Agent or model. */
export function profileProject(context: ProjectContext, runId: string, samples = 1): ProjectProfile {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(runId) ||
    [".", ".."].includes(runId) ||
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > PROFILE_LIMITS.samples
  )
    throw new ProfileInputError("Provide a run identity and --samples between 1 and 5.");
  const repository = new FileArtifactRepository(context.artifactRoot),
    started = performance.now();
  const stages: ProfileStage[] = [];
  let sourceReady = false,
    evidenceReady = false;
  let evidenceHash: string | undefined;
  const stage = (id: StageId, operation: () => Observation) => {
    const durations: number[] = [],
      observations: Observation[] = [];
    for (let index = 0; index < samples; index++) {
      if (performance.now() - started >= PROFILE_LIMITS.elapsedMs) {
        observations.push(
          blocked("PROFILE_TIME_BUDGET", "Retry with --samples 1 or a smaller project/evidence collection."),
        );
        break;
      }
      const start = performance.now();
      try {
        observations.push(operation());
      } catch (error) {
        observations.push(
          error instanceof QualityAssessmentError
            ? error.code === "QUALITY_EVIDENCE"
              ? unavailable(
                  "PROFILE_QUALITY_UNAVAILABLE",
                  "Select a finished, schema-valid run with complete assessment evidence.",
                )
              : blocked(
                  "PROFILE_QUALITY_BLOCKED",
                  "Inspect quality decision storage, integrity and concurrent writers before retrying.",
                )
            : blocked(
                error instanceof ProfileBoundError ? "PROFILE_INPUT_BUDGET" : "PROFILE_READ_BLOCKED",
                "Inspect input sizes, ordinary file permissions and concurrent writers; retry with a supported snapshot.",
              ),
        );
      }
      durations.push(performance.now() - start);
      if (observations.at(-1)!.status !== "measured") break;
    }
    const sorted = [...durations].sort((a, b) => a - b),
      middle = Math.floor(sorted.length / 2),
      consistent = observations.every((value) => JSON.stringify(value) === JSON.stringify(observations[0])),
      outcome =
        observations.find((value) => value.status === "blocked") ??
        observations.find((value) => value.status === "unavailable") ??
        observations.at(-1)!;
    const result: ProfileStage = {
      ...outcome,
      id,
      consistent,
      timingMs: {
        samples: durations,
        min: sorted[0] ?? null,
        median: sorted.length
          ? sorted.length % 2
            ? sorted[middle]!
            : (sorted[middle - 1]! + sorted[middle]!) / 2
          : null,
        max: sorted.at(-1) ?? null,
      },
    };
    stages.push(result);
    return result.status === "measured";
  };
  sourceReady = stage("discovery", () => {
    inspectTree(context.projectRoot, true);
    const discovery = discoverProject(context.projectRoot),
      inventory = projectSourceInventory(context.projectRoot);
    return measured(
      "PROFILE_DISCOVERY_MEASURED",
      {
        files: inventory.files.length,
        languages: discovery.languages.length,
        declaredChecks: discovery.languages.reduce((sum, language) => sum + language.suggestions.length, 0),
      },
      inventory.files.reduce((sum, file) => sum + file.bytes, 0),
      stableHash(inventory),
    );
  });
  stage("structure-build", () => {
    if (!sourceReady)
      return blocked("PROFILE_SOURCE_UNAVAILABLE", "Resolve the discovery stage before profiling structure.");
    const structure = readOnlyGit(() => buildStructure(context.projectRoot));
    return measured(
      "PROFILE_STRUCTURE_MEASURED",
      {
        files: structure.limits.files,
        nodes: structure.nodes.length,
        edges: structure.edges.length,
        unknownRelations: structure.unknown.length,
      },
      structure.limits.bytes,
      structure.source.inventoryHash,
    );
  });
  evidenceReady = stage("evidence-verify", () => {
    const root = lstatSync(context.artifactRoot, { throwIfNoEntry: false });
    if (!root) return unavailable("PROFILE_EVIDENCE_MISSING", "Select an existing sealed run produced by canary run.");
    // Verification can follow child runs and quality history; bound the entire collection first.
    inspectTree(context.artifactRoot, false);
    const integrity = repository.verify(runId);
    if (integrity.status === "missing")
      return unavailable("PROFILE_EVIDENCE_MISSING", "Select an existing sealed run produced by canary run.");
    if (integrity.status !== "verified")
      return blocked(
        "PROFILE_EVIDENCE_UNVERIFIED",
        "Run canary verify for the selected run and resolve missing, partial or corrupt evidence.",
      );
    const manifest = readArtifactManifest(join(context.artifactRoot, runId))!;
    if (evidenceHash && integrity.manifestHash !== evidenceHash)
      return blocked(
        "PROFILE_EVIDENCE_CHANGED",
        "Run evidence changed between samples; retry after its writer finishes.",
      );
    evidenceHash = integrity.manifestHash;
    return measured(
      "PROFILE_EVIDENCE_MEASURED",
      { files: manifest.files.length, revision: manifest.revision },
      manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      evidenceHash,
    );
  });
  stage("quality-brief", () => {
    if (!evidenceReady)
      return unavailable("PROFILE_QUALITY_EVIDENCE_REQUIRED", "Select verified, finished run evidence first.");
    const view = readQualityAssessment(repository, runId);
    if (view.report.binding.manifestHash !== evidenceHash)
      return blocked(
        "PROFILE_EVIDENCE_CHANGED",
        "Run evidence changed before assessment; retry after its writer finishes.",
      );
    return measured(
      "PROFILE_QUALITY_MEASURED",
      {
        issues: view.report.issues.length,
        omittedIssues: view.report.omittedIssues,
        options: view.report.options.length,
        decisions: view.decisions.length,
      },
      Buffer.byteLength(JSON.stringify(view)),
      view.report.contentHash,
    );
  });
  stage("project-memory", () => {
    const memory = lstatSync(join(context.projectRoot, ".canary", "memory"), { throwIfNoEntry: false });
    if (!memory)
      return unavailable(
        "PROFILE_MEMORY_MISSING",
        "Record a reviewed, verified project repair before measuring memory lookup; no directory was created.",
      );
    if (!evidenceReady)
      return unavailable(
        "PROFILE_MEMORY_EVIDENCE_REQUIRED",
        "Select a verified failed project-check run with retained source proof.",
      );
    // ProjectMemoryStore list/query are inert: pending transactions are rejected, never recovered by reads.
    const result = readOnlyGit(() => queryProjectMemory(context, { runId, maxItems: 5, maxChars: 8000 }));
    if (result.status !== "available")
      return unavailable(
        "PROFILE_MEMORY_QUERY_UNAVAILABLE",
        "Select a failed project-check run with retained source proof and inspect memory storage/evidence.",
      );
    return measured(
      "PROFILE_MEMORY_MEASURED",
      {
        records: result.total ?? 0,
        matched: result.items.length,
        skipped: result.skipped.length,
        omitted: result.omitted ?? 0,
      },
      Buffer.byteLength(JSON.stringify(result)),
    );
  });
  return projectProfileSchema.parse({
    v: 1,
    kind: "canary.profile",
    runId,
    requestedSamples: samples,
    readOnly: true,
    executionGranted: false,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    limits: PROFILE_LIMITS,
    stages,
    limitations: [
      "Measurements cover analysis of the current source and selected retained evidence; they do not execute or grade the project.",
      "Samples are sequential warm-process observations; they are not a production latency guarantee or a before/after improvement claim.",
      "Source and artifact input traversal is bounded. Installed TypeScript declarations and trusted Git/Python parsing helpers may also be read or invoked.",
      "The elapsed budget is checked between operations; synchronous analysis already in progress cannot be interrupted by this command.",
      "Counts and bytes describe each stage's returned scope, not total process I/O. Missing or blocked stages are not successful validations.",
    ],
  });
}

export function profileCommand(args: string[]): number {
  const json = args.includes("--json");
  try {
    const runId = args[0];
    if (!runId || runId.startsWith("--"))
      throw new ProfileInputError("Use canary profile <runId> [--samples 1..5] [--json].");
    const flags = new Map<string, string>();
    let seenJson = false;
    for (let index = 1; index < args.length; index++) {
      const name = args[index]!;
      if (name === "--json" && !seenJson) {
        seenJson = true;
        continue;
      }
      const value = args[++index];
      if (!["--config", "--project", "--samples"].includes(name) || flags.has(name) || !value || value.startsWith("--"))
        throw new ProfileInputError("Unknown, duplicate or incomplete profile option.");
      flags.set(name, value);
    }
    const rawSamples = flags.get("--samples") ?? "1";
    if (!/^[1-5]$/.test(rawSamples)) throw new ProfileInputError("--samples must be an integer between 1 and 5.");
    const context = resolveProjectContext({
      cwd: flags.has("--project") ? resolve(flags.get("--project")!) : undefined,
      configPath: flags.get("--config"),
    });
    const result = profileProject(context, runId, Number(rawSamples));
    console.log(
      json
        ? JSON.stringify(result)
        : [
            `Analysis profile: ${runId} (${result.requestedSamples} requested sample(s))`,
            ...result.stages.map(
              (stage) =>
                `${stage.id}: ${stage.status} [${stage.code}]${
                  stage.timingMs.median === null ? "" : `; median ${stage.timingMs.median.toFixed(2)} ms`
                }${stage.status === "measured" ? "" : `; ${stage.nextAction}`}`,
            ),
            "No checks, Agents, models or project configuration modules were executed.",
          ].join("\n"),
    );
    return result.stages.some((stage) => stage.status === "blocked") ? 1 : 0;
  } catch (error) {
    const output = {
      v: 1,
      kind: "canary.profile-error",
      code: error instanceof ProfileInputError ? "PROFILE_INPUT" : "PROFILE_READ_BLOCKED",
      message: error instanceof ProfileInputError ? error.message : "Profile inputs could not be safely read.",
      readOnly: true,
      executionGranted: false,
    };
    if (json) console.log(JSON.stringify(output));
    else console.error(`${output.code}: ${output.message}`);
    return error instanceof ProfileInputError ? 2 : 1;
  }
}
