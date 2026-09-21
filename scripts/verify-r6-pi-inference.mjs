import { evidenceOutput } from "./lib/evidence-output.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ciResultSchema } from "../packages/core/dist/index.js";
import { redactText, verifyArtifacts, writePrivateJson, writePrivateText } from "../packages/trace/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const output = evidenceOutput("r6", "r6-pi-inference.json", option("--output"));
const report = {
  kind: "canary.r6.pi-inference",
  date: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  osRelease: release(),
  status: "blocked",
  stageComplete: false,
  model: option("--model"),
  modelCalls: 0,
  credentialDiscovery: false,
  checks: [],
};
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function checkCredentialFile(home) {
  const auth = join(home, ".pi/agent/auth.json");
  // Pi initializes an empty store even when its API key override stays in memory.
  if (existsSync(auth))
    assert.deepEqual(JSON.parse(readFileSync(auth, "utf8")), {}, "Credential store must remain empty");
}
try {
  if (option("--verify-existing")) {
    const priorPath = resolve(option("--verify-existing"));
    assert.notEqual(priorPath, output, "Keep the original attempt report");
    const prior = JSON.parse(readFileSync(priorPath, "utf8"));
    Object.assign(report, prior, {
      date: new Date().toISOString(),
      status: "failed",
      revalidationOf: { path: priorPath, sha256: sha(priorPath) },
      modelCallsThisVerification: 0,
    });
    delete report.error;
    const integrity = verifyArtifacts(dirname(prior.artifactPath));
    assert.equal(integrity.status, "verified");
    assert.equal(integrity.manifestHash, prior.manifestHash);
    const runtimeReference = existsSync(prior.runtimeEvidence.path)
      ? prior.runtimeEvidence.path
      : join(dirname(priorPath), prior.runtimeEvidence.path.split(/[\\\\/]/).at(-1));
    assert.equal(sha(runtimeReference), prior.runtimeEvidence.sha256);
    assert.equal(
      sha(join(prior.fixtureRoot, "agent.mjs")),
      prior.sourceFiles["integrations/fixtures/pi-agent/inference.mjs"],
    );
    const run = JSON.parse(readFileSync(prior.artifactPath, "utf8")),
      evaluation = run.results[0];
    assert.equal(run.status, "completed");
    assert.equal(evaluation.output, "CANARY_PI_R6_OK");
    assert.ok(evaluation.assertions.every((assertion) => assertion.passed));
    const event = evaluation.trajectory.events.find((event) => event.type === "pi.inference");
    assert.equal(event.modelCalls, 1);
    assert.equal(event.httpStatus, 200);
    assert.equal(event.requestedModel, prior.model);
    assert.ok(event.usage.totalTokens > 0);
    checkCredentialFile(join(prior.fixtureRoot, "isolated-home"));
    report.status = "verified";
    report.checks = [
      "original-manifest",
      "runtime-evidence-hash",
      "wrapper-hash",
      "real-provider-response",
      "exact-output",
      "token-usage",
      "empty-credential-store",
    ];
    report.coverageScope = "Only the Canary integration wrapper; not Pi internals or model coverage";
  } else {
    assert.ok(args.includes("--allow-inference"), "Explicit --allow-inference is required");
    assert.ok(report.model && option("--runtime-report"), "Explicit --model and --runtime-report are required");
    assert.ok(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY is required; never pass it as an argument");
    const runtime = JSON.parse(readFileSync(resolve(option("--runtime-report")), "utf8"));
    assert.equal(runtime.runtimeGate, "passed");
    const fixture = JSON.parse(readFileSync(join(root, "integrations/fixtures/pi-agent/fixture.json"), "utf8"));
    const pkgDir = join(runtime.fixtureRoot, "node_modules/@earendil-works/pi-coding-agent");
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(runtime.fixtureRoot, "package-lock.json"), "utf8"));
    assert.equal(`${pkg.name}@${pkg.version}`, fixture.package);
    assert.equal(lock.packages["node_modules/@earendil-works/pi-coding-agent"].integrity, fixture.integrity);
    const install = runtime.checks.find((check) => check.name === "pinned-runtime-install");
    assert.equal(sha(join(pkgDir, pkg.bin.pi)), install.entryHash);
    assert.equal(sha(join(runtime.fixtureRoot, "package-lock.json")), install.lockHash);
    const base = mkdtempSync(join(tmpdir(), "Canary Pi inference ")),
      home = join(base, "isolated-home");
    mkdirSync(home);
    const sdk = join(pkgDir, "dist/index.js");
    report.fixtureRoot = base;
    report.package = fixture.package;
    report.upstreamCommit = fixture.commit;
    report.runtimeEvidence = {
      path: resolve(option("--runtime-report")),
      sha256: sha(resolve(option("--runtime-report"))),
      sdkHash: sha(sdk),
      integrity: fixture.integrity,
    };
    report.sourceFiles = Object.fromEntries(
      ["integrations/fixtures/pi-agent/inference.mjs", "scripts/verify-r6-pi-inference.mjs"].map((file) => [
        file,
        sha(join(root, file)),
      ]),
    );
    cpSync(join(root, "integrations/fixtures/pi-agent/inference.mjs"), join(base, "agent.mjs"));
    const expected = "CANARY_PI_R6_OK";
    writePrivateText(
      join(base, "cases.ts"),
      `export default [{id:'pi-deepseek-smoke',input:'Reply with exactly ${expected}. Do not add punctuation or explanations.',assertions:[{type:'output.predicate',predicate: output => output === '${expected}',message:'Real Pi output must match the requested marker'},{type:'trajectory.required_event',event:'pi.inference',minCount:1}]}];`,
    );
    writePrivateText(
      join(base, "canary.config.ts"),
      `export default ${JSON.stringify({ agent: { adapter: "function", entry: "./agent.mjs" }, cases: "./cases.ts", coverage: { include: ["agent.mjs"] }, runtime: { timeoutMs: 75000, repetitions: 1, concurrency: 1 }, web: { enabled: false }, reporters: ["json", "junit", "markdown"] })};`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"].includes(key.toUpperCase()),
      ),
    );
    Object.assign(env, {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      CANARY_PI_MODULE: pathToFileURL(sdk).href,
      CANARY_PI_MODEL: report.model,
      HOME: home,
      USERPROFILE: home,
      TEMP: home,
      TMP: home,
      PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
      PI_SKIP_VERSION_CHECK: "1",
    });
    report.budget = { maxRequests: 1, maxOutputTokens: 128, timeoutMs: 75000, retries: 0, tools: 0 };
    report.status = "failed";
    const result = spawnSync(process.execPath, [join(root, "packages/cli/dist/index.js"), "run", "--ci"], {
      cwd: base,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 100000,
      maxBuffer: 2_000_000,
    });
    writePrivateText(join(base, "canary-stderr.log"), result.stderr ?? "");
    assert.ifError(result.error);
    const ci = ciResultSchema.parse(JSON.parse(result.stdout));
    report.runId = ci.runId;
    report.artifactPath = ci.artifactPath;
    report.exitCode = ci.exitCode;
    const run = JSON.parse(readFileSync(ci.artifactPath, "utf8"));
    const evaluation = run.results[0];
    const event = evaluation?.trajectory?.events.find((event) => event.type === "pi.inference");
    const failure = evaluation?.trajectory?.events.find((event) => event.type === "pi.failure");
    report.modelCalls = event?.modelCalls ?? failure?.modelCalls ?? 0;
    report.inference = event ?? failure;
    report.output = evaluation?.output;
    report.assertions = evaluation?.assertions;
    const integrity = verifyArtifacts(dirname(ci.artifactPath));
    report.manifestHash = integrity.manifestHash;
    assert.equal(integrity.status, "verified");
    assert.equal(result.status, ci.exitCode);
    assert.equal(ci.exitCode, 0, "Real Pi run failed; inspect the retained artifact");
    assert.equal(report.modelCalls, 1);
    assert.equal(report.output, expected);
    assert.ok(event?.usage?.totalTokens > 0 || event?.usage?.input > 0, "Provider token usage is missing");
    checkCredentialFile(home);
    report.status = "verified";
    report.checks = [
      "pinned-runtime",
      "real-provider-response",
      "exact-output",
      "token-usage",
      "sealed-artifact",
      "no-persisted-credential",
    ];
    report.coverageScope = "Only the Canary integration wrapper; not Pi internals or model coverage";
  }
} catch (error) {
  report.error = redactText(String(error.message)).slice(0, 2000);
  process.exitCode = 1;
} finally {
  mkdirSync(dirname(output), { recursive: true });
  writePrivateJson(output, report);
  console.log(
    JSON.stringify(
      {
        status: report.status,
        runId: report.runId,
        modelCalls: report.modelCalls,
        evidence: output,
        error: report.error,
      },
      null,
      2,
    ),
  );
}
