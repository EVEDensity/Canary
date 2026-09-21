import { evidenceOutput } from "./lib/evidence-output.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { beginArtifacts, verifyArtifacts, writePrivateJson } from "../packages/trace/dist/index.js";
import { recoverPartialRun, writeCheckpoint } from "../packages/runner/dist/index.js";

const root = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const fixture = realpathSync.native(mkdtempSync(join(tmpdir(), "canary R3 acceptance ")));
const cli = join(root, "packages/cli/dist/index.js");
const config = join(fixture, "canary.config.ts");
const artifactRoot = join(fixture, ".canary", "artifacts");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = {
  v: 1,
  kind: "canary.r3.acceptance",
  date: new Date().toISOString(),
  root,
  fixture,
  platform: platform(),
  osRelease: release(),
  node: process.versions.node,
  checks: [],
};
function processResult(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}
function command(args, expected = 0) {
  const result = processResult(process.execPath, [cli, ...args, "--config", config], fixture);
  assert.equal(result.status, expected, `CLI exit mismatch for ${args.join(" ")}`);
  const payload = JSON.parse(result.stdout);
  evidence.checks.push({
    command: `canary ${args.join(" ")}`,
    exitCode: result.status,
    status: "verified",
    result: payload,
  });
  return payload;
}
function sourceHashes() {
  const files = processResult("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "packages",
    "apps",
    "examples",
    "scripts",
    "package.json",
    "canary.config.ts",
  ]);
  assert.equal(files.status, 0);
  return Object.fromEntries(
    files.stdout
      .split("\0")
      .filter(Boolean)
      .map((name) => [name, hash(readFileSync(join(root, name)))]),
  );
}
function allText(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory() ? allText(join(dir, entry.name)) : readFileSync(join(dir, entry.name), "utf8"),
    )
    .join("\n");
}
try {
  evidence.commit = processResult("git", ["rev-parse", "HEAD"]).stdout.trim();
  evidence.pnpm = processResult(
    process.platform === "win32" ? "cmd.exe" : "pnpm",
    process.platform === "win32" ? ["/d", "/c", "pnpm --version"] : ["--version"],
  ).stdout.trim();
  evidence.shell = process.platform === "win32" ? "PowerShell / Node child_process" : "Node child_process";
  const before = sourceHashes();
  writeFileSync(
    join(fixture, "agent.mjs"),
    "export default (input,ctx)=>({echo:input.apiKey,random:ctx.random(),clock:ctx.now()});",
  );
  writeFileSync(
    join(fixture, "cases.ts"),
    "export default [{id:'deterministic',input:{apiKey:'opaque-r3-acceptance-value'},assertions:[{type:'output.exists'}]}];",
  );
  writeFileSync(
    config,
    "export default {agent:{adapter:'function',entry:'./agent.mjs'},cases:'./cases.ts',coverage:{include:['agent.mjs']},artifacts:{reproducibility:{seed:7,clock:'2026-01-01T00:00:00.000Z'},retention:{maxRuns:1}},web:{enabled:false}};",
  );
  const first = command(["run", "--ci"]);
  const firstDir = join(artifactRoot, first.runId);
  command(["verify", first.runId, "--json"]);
  const next = command(["run", "--ci", "--retry-of", first.runId]);
  command(["verify", next.runId, "--json"]);
  const firstRun = JSON.parse(readFileSync(first.artifactPath, "utf8"));
  const nextRun = JSON.parse(readFileSync(next.artifactPath, "utf8"));
  assert.equal(nextRun.evidence.lineage.retryOf, first.runId);
  assert.equal(nextRun.evidence.conclusionHash, firstRun.evidence.conclusionHash);
  assert(!allText(artifactRoot).includes("opaque-r3-acceptance-value"));
  evidence.checks.push({
    command: "fixed clock/seed conclusion and privacy scan",
    status: "verified",
    conclusionHash: firstRun.evidence.conclusionHash,
    manifest: JSON.parse(readFileSync(join(firstDir, "manifest.json"), "utf8")),
  });
  const retention = command(["prune", "--json"]);
  assert(retention.protectedRuns.includes(first.runId));
  assert.equal(retention.removed.length, 0);
  const recoveredDir = join(artifactRoot, "run_recovery_fixture");
  beginArtifacts(recoveredDir);
  const snapshot = { ...firstRun, runId: "run_recovery_fixture", status: "running", finishedAt: undefined };
  writePrivateJson(join(recoveredDir, "run.json"), snapshot);
  writeCheckpoint({
    v: 1,
    kind: "canary.checkpoint",
    runId: snapshot.runId,
    pid: 0,
    status: "running",
    startedAt: snapshot.startedAt,
    updatedAt: snapshot.startedAt,
    artifactDir: recoveredDir,
    tmpDir: join(recoveredDir, "tmp"),
    workDir: join(recoveredDir, "work"),
    lockPath: join(recoveredDir, "run.lock"),
    ports: [],
    childPids: [],
    completedCaseKeys: ["deterministic"],
    pendingCaseKeys: [],
  });
  writeFileSync(join(recoveredDir, "trace.jsonl"), '{"type":"done"}\n{"type":');
  await recoverPartialRun(recoveredDir, snapshot);
  command(["verify", snapshot.runId, "--json"]);
  evidence.checks.push({
    command: "partial JSONL recovery",
    status: "verified",
    result: JSON.parse(readFileSync(join(recoveredDir, "recovery.json"), "utf8")),
  });
  writeFileSync(first.artifactPath, '{"runId":"changed"}');
  const corrupt = command(["verify", first.runId, "--json"], 5);
  assert.equal(corrupt.status, "invalid");
  writeFileSync(join(artifactRoot, next.runId, "trace.jsonl"), '{"truncated":');
  assert.equal(command(["verify", next.runId, "--json"], 5).status, "invalid");
  const legacyDir = join(artifactRoot, "legacy");
  mkdirSync(legacyDir);
  const { evidence: _evidence, ...legacy } = firstRun;
  writeFileSync(join(legacyDir, "run.json"), JSON.stringify({ ...legacy, runId: "legacy" }));
  assert.equal(command(["verify", "legacy", "--json"], 5).status, "legacy");
  assert.equal(verifyArtifacts(recoveredDir).status, "verified");
  assert.deepEqual(sourceHashes(), before);
  evidence.checks.push({
    command: "source files unchanged by acceptance",
    status: "verified",
    files: Object.keys(before).length,
  });
  evidence.status = "verified";
} finally {
  // Only this script's own absolute mkdtemp directory is eligible for cleanup.
  assert.equal(dirname(fixture), realpathSync.native(tmpdir()));
  assert(fixture.split(/[/\\]/).at(-1).startsWith("canary R3 acceptance "));
  rmSync(fixture, { recursive: true, force: true });
}
const output = JSON.stringify(evidence, null, 2) + "\n";
const out = process.argv.indexOf("--out");
const destination = evidenceOutput("r3", "r3-acceptance.json", out >= 0 ? process.argv[out + 1] : undefined);
writeFileSync(destination, output, "utf8");
console.log(output);
