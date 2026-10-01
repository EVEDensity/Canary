import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunSnapshot } from "@canary/core";
import { sha256 } from "./artifacts.js";
import { containsSensitiveValue, redactValue, SECRET_KEY } from "./privacy.js";

export interface FailureDiagnostic {
  id: string;
  checkId?: string;
  caseId?: string;
  executionId?: string;
  category: string;
  testNames: string[];
  assertions: Array<{ id: string; message?: string; details?: unknown }>;
  originalError: { stdout: string; stderr: string; truncated: boolean };
  stack: string[];
  locations: Array<{ path: string; line: number; column?: number; mapping: "path-line" }>;
  sourceMapping: "path-line" | "missing";
  relatedFailures: Array<{ id: string; evidence: "declared-dependency" }>;
  rootCause: { status: "unknown" | "hypothesis"; reason: string };
  nextSteps: string[];
}
export interface RunDiagnostics {
  v: 1;
  kind: "canary.diagnostics";
  runId: string;
  reproduction: {
    gitCommit?: string;
    identity: { runId: string; startedAt: string };
    runtime?: { node: string; platform: string; arch: string };
    lockfiles: Record<string, string>;
    environmentNames: string[];
    sourceHash?: string;
    configHash?: string;
    commands: Array<{ checkId: string; command?: string; args?: string[]; cwd: string; environmentNames: string[] }>;
  };
  failures: FailureDiagnostic[];
  limitations: string[];
}

const clean = <T>(value: T): T => redactValue(value, { maxStringLength: Infinity }) as T;
const stripAnsi = (value: string) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
function locations(text: string, root: string, cwd: string): FailureDiagnostic["locations"] {
  const found: FailureDiagnostic["locations"] = [];
  for (const row of stripAnsi(text).split(/\r?\n/)) {
    const python = row.match(/\bFile ["']([^"']+)["'], line (\d+)/);
    const frame = row.match(/(?:\(|\s|^)([^\s()]+\.(?:[cm]?[jt]sx?|py|go|rs|java|vue|svelte)):(\d+)(?::(\d+))?/);
    const match = python ?? frame;
    if (!match) continue;
    let raw = match[1]!;
    if (raw.startsWith("file://")) { try { raw = fileURLToPath(raw); } catch { continue; } }
    const path = relative(resolve(root), resolve(root, cwd, raw)).replaceAll("\\", "/");
    const line = Number(match[2]);
    if (!path || isAbsolute(path) || path === ".." || path.startsWith("../") || !Number.isSafeInteger(line) || line < 1) continue;
    const column = !python && match[3] ? Number(match[3]) : undefined;
    if (!found.some((item) => item.path === path && item.line === line && item.column === column))
      found.push({ path, line, ...(column ? { column } : {}), mapping: "path-line" });
  }
  return found.slice(0, 40);
}
function failure(id: string, category: string, stdout: string, stderr: string, root: string, cwd: string): FailureDiagnostic {
  const text = [stderr, stdout].join("\n");
  const mapped = locations(text, root, cwd);
  return {
    id, category, testNames: [], assertions: [], originalError: { stdout, stderr, truncated: false },
    stack: stripAnsi(text).split(/\r?\n/).filter((row) => /^\s*at\s|\bFile ["']/.test(row)).slice(0, 80),
    locations: mapped, sourceMapping: mapped.length ? "path-line" : "missing", relatedFailures: [],
    rootCause: { status: "unknown", reason: "No evidence establishes a root cause; stack locations are reported positions, not verified source maps." },
    nextSteps: ["Inspect the original redacted error and failed assertions.", "Confirm the recorded commit, runtime, working directory and required environment names.", "Inspect the reported source location; repair and rerun the same check or case."],
  };
}
/** Derive one shared view without changing the original report or evaluation result. */
export function buildRunDiagnostics(input: RunSnapshot, projectRoot: string): RunDiagnostics {
  const commandSecrets: string[] = [];
  for (const check of input.checks ?? []) for (const [index, arg] of (check.args ?? []).entries()) {
    if (!arg.startsWith("-")) continue;
    const [name, ...value] = arg.split("=");
    if (!SECRET_KEY.test(name!.replace(/^-+/, ""))) continue;
    const secret = value.length ? value.join("=") : check.args?.[index + 1];
    if (secret && !secret.startsWith("--")) commandSecrets.push(secret);
  }
  const run = redactValue(input, { maxStringLength: Infinity, secretValues: commandSecrets }) as RunSnapshot;
  const failures: FailureDiagnostic[] = [];
  for (const check of run.checks ?? []) {
    if (check.status !== "failed" && check.status !== "blocked") continue;
    const stdout = check.outputEvidence?.stdout.join("\n") || check.stdout || "";
    const stderr = check.outputEvidence?.stderr.join("\n") || check.stderr || "";
    const item = failure(`${run.runId}:check:${check.id}`, check.category, stdout, stderr, projectRoot, check.cwd);
    item.checkId = check.id;
    item.originalError.truncated = Boolean(check.outputTruncated);
    item.testNames = stripAnsi([stderr, stdout].join("\n")).split(/\r?\n/).flatMap((row) => {
      const match = row.match(/^\s*(?:FAIL\s+|[×✕]\s+|not ok \d+\s*-?\s*)(.+)/);
      return match ? [match[1]!.trim()] : [];
    }).slice(0, 80);
    failures.push(item);
  }
  for (const result of run.results.filter((item) => !item.passed)) {
    const assertions = result.assertions.filter((item) => !item.passed).map(({ id, message, details }) => ({ id, message, details }));
    const errors = run.events.flatMap((event) => event.type === "execution.failed" && event.executionId === result.executionId ? [event.error] : []);
    const assertionEvidence = assertions.map((a) => [a.message, a.details ? JSON.stringify(a.details) : ""].filter(Boolean).join("\n"));
    const item = failure(`${run.runId}:case:${result.executionId}`, result.failureCategory ?? "assertion", "", [...errors, ...assertionEvidence].join("\n"), projectRoot, ".");
    Object.assign(item, { caseId: result.caseId, executionId: result.executionId, testNames: [result.caseId], assertions });
    failures.push(item);
  }
  for (const [index, gate] of (run.gate?.passed === false ? run.gate.failures : []).entries()) {
    failures.push(failure(`${run.runId}:gate:${index}`, "coverage_below_threshold", "", gate.message, projectRoot, "."));
  }
  for (const item of failures) {
    const check = run.checks?.find((check) => check.id === item.checkId);
    if (check?.category !== "dependency") continue;
    for (const dependency of check.dependsOn ?? []) {
      const parent = failures.find((other) => other.checkId === dependency);
      if (parent) item.relatedFailures.push({ id: parent.id, evidence: "declared-dependency" });
    }
    if (item.relatedFailures.length) item.rootCause = { status: "hypothesis", reason: "A declared prerequisite failed. This explains blocking, but does not establish the prerequisite's root cause." };
  }
  const recorded = run.evidence?.reproduction;
  return clean({
    v: 1, kind: "canary.diagnostics", runId: run.runId,
    reproduction: {
      gitCommit: recorded?.gitCommit,
      identity: { runId: run.runId, startedAt: run.startedAt },
      runtime: recorded ? { node: recorded.node, platform: recorded.platform, arch: recorded.arch } : undefined,
      lockfiles: recorded?.lockfiles ?? {},
      environmentNames: recorded?.environmentNames ?? [],
      sourceHash: recorded?.sourceHash,
      configHash: recorded?.configHash,
      commands: (run.checks ?? []).map((check) => ({ checkId: check.id, command: check.command, args: check.args, cwd: check.cwd, environmentNames: check.envAllowlist })),
    }, failures,
    limitations: ["Only retained redacted evidence is included; credentials and environment values are omitted.", "Missing source maps and unknown causes remain explicit. Similar messages never establish a failure relationship.", ...(!recorded ? ["This historical run has no recorded runtime or commit context."] : [])],
  } as RunDiagnostics);
}

export interface DiagnosticBundle {
  v: 1;
  kind: "canary.diagnostic-bundle";
  files: { "diagnostics.json": RunDiagnostics; "NEXT-STEPS.txt": string };
  manifest: Array<{ path: string; bytes: number; sha256: string }>;
}
const fileContent = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
export function createDiagnosticBundle(run: RunSnapshot, projectRoot: string): DiagnosticBundle {
  const files = clean({
    "diagnostics.json": buildRunDiagnostics(run, projectRoot),
    "NEXT-STEPS.txt": "Verify with canary diagnostics verify <bundle.json>. Inspect originalError, assertions and locations for each failure. Restore the recorded commit and runtime, supply required environment variables locally, fix the failing check, then rerun it. Hypotheses need confirmation; missing mappings need manual inspection. Hashes detect corruption, not authorship.\n",
  });
  if (containsSensitiveValue(files, { maxStringLength: Infinity })) throw new Error("Diagnostic privacy scan failed");
  return { v: 1, kind: "canary.diagnostic-bundle", files, manifest: Object.entries(files).map(([path, value]) => ({ path, bytes: Buffer.byteLength(fileContent(value)), sha256: sha256(fileContent(value)) })) };
}
export function verifyDiagnosticBundle(input: unknown): boolean {
  try {
    const bundle = input as DiagnosticBundle;
    if (bundle.v !== 1 || bundle.kind !== "canary.diagnostic-bundle" || Object.keys(bundle).sort().join() !== "files,kind,manifest,v") return false;
    if (Object.keys(bundle.files).sort().join() !== "NEXT-STEPS.txt,diagnostics.json" || bundle.files["diagnostics.json"].kind !== "canary.diagnostics" || bundle.files["diagnostics.json"].v !== 1 || typeof bundle.files["NEXT-STEPS.txt"] !== "string") return false;
    if (!Array.isArray(bundle.manifest) || bundle.manifest.length !== 2 || new Set(bundle.manifest.map((item) => item.path)).size !== 2 || containsSensitiveValue(bundle.files, { maxStringLength: Infinity })) return false;
    return bundle.manifest.every((entry) => Object.hasOwn(bundle.files, entry.path) && entry.bytes === Buffer.byteLength(fileContent(bundle.files[entry.path as keyof typeof bundle.files])) && entry.sha256 === sha256(fileContent(bundle.files[entry.path as keyof typeof bundle.files])));
  } catch { return false; }
}
