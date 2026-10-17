import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  flags = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!["--runtime", "--launcher", "--output"].includes(args[i]) || !args[i + 1] || flags.has(args[i]))
    throw Error("Use --runtime, --launcher and --output once with explicit paths.");
  flags.set(args[i], args[i + 1]);
}
const runtime = resolve(flags.get("--runtime") ?? repository),
  launcher = resolve(flags.get("--launcher") ?? join(runtime, "packages/cli/dist/index.js"));
const output = resolve(flags.get("--output") ?? join(repository, ".canary/verification", `release_${randomUUID()}`));
if (existsSync(output)) throw Error("Acceptance output must be a new directory.");
mkdirSync(output, { recursive: true });
const project = join(output, "project"),
  nested = join(project, "nested");
cpSync(join(repository, "scripts/tests/fixtures/agent-improvement"), project, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
writeFileSync(join(project, "package.json"), '{"name":"canary-release-fixture","private":true,"type":"module"}\n');
mkdirSync(nested);
const config = join(project, "canary.config.json"),
  common = ["--project", project, "--config", config, "--json"];
let calls = 0;
function invoke(args, expected = 0) {
  const child = spawnSync(process.execPath, [launcher, ...args], {
    cwd: nested,
    env: process.env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 4_194_304,
  });
  calls++;
  if (child.status !== expected) {
    let receipt = { kind: "unavailable-cli-receipt" };
    try {
      receipt = JSON.parse(child.stdout);
    } catch {
      /* Never retain arbitrary exception text. */
    }
    writeFileSync(
      join(output, `failed-${String(calls).padStart(2, "0")}.json`),
      JSON.stringify({ command: args[0], status: child.status, receipt }, null, 2),
    );
  }
  assert.equal(child.status, expected, `Acceptance command ${args[0]} did not return the expected exit.`);
  const parsed = JSON.parse(child.stdout);
  writeFileSync(join(output, `${String(calls).padStart(2, "0")}-${args[0]}.json`), JSON.stringify(parsed, null, 2));
  return parsed;
}
const version = invoke(["version", "--json"]);
const baseline = invoke(["run", "--ci", "--project", project, "--config", config], 1);
assert.equal(baseline.summary.total, 6);
assert.equal(baseline.summary.passed, 5);
const view = invoke(["assess", baseline.runId, ...common]),
  option = view.report.options.find((item) => item.action === "repair-behavior");
assert.ok(option);
const choice = invoke([
  "assess",
  "decide",
  baseline.runId,
  "--report-hash",
  view.report.contentHash,
  "--expected-revision",
  String(view.revision),
  "--option",
  option.id,
  "--action",
  "select",
  "--actor",
  "fixture-runner",
  "--reason",
  "Verify the fixed behavior contract",
  ...common,
]);
const prepared = invoke([
  "improvement",
  "prepare",
  baseline.runId,
  "--option",
  option.id,
  "--report-hash",
  choice.report.contentHash,
  "--expected-revision",
  String(choice.revision),
  "--entry",
  "candidate.mjs",
  "--allow",
  "candidate.mjs",
  "--allow",
  "tools.mjs",
  "--regression",
  "case-1",
  "--holdout",
  "case-5",
  "--holdout",
  "case-6",
  "--max-runs",
  "1",
  "--max-cases",
  "6",
  "--max-ms",
  "30000",
  "--max-tool-calls",
  "6",
  ...common,
]);
const execution = invoke([
  "improvement",
  "execute",
  prepared.plan.id,
  "--plan-hash",
  prepared.plan.contentHash,
  "--actor",
  "fixture-runner",
  "--reason",
  "Verify the fixed candidate",
  "--execute",
  ...common,
]);
const result = execution.attempts[0].result;
assert.equal(result.code, "IMPROVEMENT_VERIFIED");
assert.equal(result.observed.toolCalls, 6);
assert.equal(result.benefit.changes.improved, 1);
assert.equal(result.benefit.changes.regressed, 0);
assert.equal(result.benefit.scopes.holdout.paired, 2);

const trace = await import(pathToFileURL(join(runtime, "packages/trace/dist/index.js")).href),
  core = await import(pathToFileURL(join(runtime, "packages/core/dist/index.js")).href);
const artifactRoot = join(project, ".canary/artifacts"),
  repo = new trace.FileArtifactRepository(artifactRoot);
const stoppedPlan = { ...prepared.plan, id: `improvement_${randomUUID()}`, contentHash: "" };
stoppedPlan.contentHash = core.qualityContentHash(stoppedPlan);
trace.createImprovementSession(repo, stoppedPlan);
const childSource = `import{executeImprovementSession,FileArtifactRepository}from ${JSON.stringify(pathToFileURL(join(runtime, "packages/trace/dist/index.js")).href)};setInterval(()=>{},1000);await executeImprovementSession(new FileArtifactRepository(${JSON.stringify(artifactRoot)}),${JSON.stringify(stoppedPlan.id)},${JSON.stringify({ planHash: stoppedPlan.contentHash, actor: "fixture-runner", reason: "Exercise interrupted recovery" })},async()=>{process.send('charged');await new Promise(()=>{});});`;
const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  }),
  closed = once(child, "close"),
  timeout = setTimeout(() => child.kill(), 8000);
try {
  await Promise.race([
    once(child, "message"),
    closed.then(() => {
      throw Error("Interrupted fixture did not persist its charge.");
    }),
  ]);
  child.kill();
  await closed;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await closed;
}
const recovery = invoke(["improvement", "recover", stoppedPlan.id, ...common]);
assert.equal(recovery.status, "ready");
const recovered = invoke([
  "improvement",
  "recover",
  stoppedPlan.id,
  "--apply",
  "--session-hash",
  recovery.sessionHash,
  "--lock-hash",
  recovery.lockHash,
  "--actor",
  "fixture-runner",
  "--reason",
  "Close the exited fixture writer",
  ...common,
]);
assert.equal(recovered.attempts[0].result.observed.toolCalls, null);
assert.equal(recovered.attempts.length, 1);
const profile = invoke(["profile", baseline.runId, "--samples", "3", ...common]);
core.projectProfileSchema.parse(profile);
const target = join(project, ".canary/archives", "release-evidence");
const archive = invoke(["archive", "create", target, "--rotate", ...common]);
const archived = invoke([
  "archive",
  "create",
  target,
  "--rotate",
  "--apply",
  "--plan-hash",
  archive.contentHash,
  "--actor",
  "fixture-runner",
  "--reason",
  "Preserve the complete release fixture",
  ...common,
]);
assert.equal(archived.sourceReset, true);
assert.deepEqual(readdirSync(artifactRoot), []);
const restore = invoke(["archive", "restore", target, ...common]);
invoke([
  "archive",
  "restore",
  target,
  "--apply",
  "--plan-hash",
  restore.contentHash,
  "--actor",
  "fixture-runner",
  "--reason",
  "Restore verified fixture evidence",
  ...common,
]);
const restored = invoke(["improvement", "show", execution.plan.id, ...common]);
assert.equal(restored.contentHash, execution.contentHash);
assert.equal(repo.verify(result.candidateRunId).status, "verified");
assert.equal(trace.readImprovementSession(repo, stoppedPlan.id).contentHash, recovered.contentHash);
const evidence = {
  v: 1,
  kind: "canary.release-acceptance",
  version: version.canaryVersion,
  scope: "fixed deterministic six-case Agent fixture",
  baselineRunId: baseline.runId,
  candidateRunId: result.candidateRunId,
  passedCases: 6,
  improved: 1,
  regressed: 0,
  holdoutPairs: 2,
  managedToolCalls: 6,
  managedLiveModelCalls: 0,
  monetaryCost: null,
  interruptedAttemptPreserved: true,
  archiveHash: archived.archiveHash,
  restoredSessionHash: restored.contentHash,
  analysis: profile.stages.map(({ id, status, timingMs }) => ({ id, status, timingMs })),
  commands: calls,
};
writeFileSync(join(output, "acceptance.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
