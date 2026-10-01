import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubReport } from "./lib/github-report.mjs";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(toolRoot, "packages/cli/dist/index.js");
const workspace = realpathSync.native(process.env.GITHUB_WORKSPACE ?? process.cwd());
const projectRoot = realpathSync.native(resolve(workspace, process.env.CANARY_PROJECT ?? "."));
const rel = relative(workspace, projectRoot);
if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw new Error("Project must be inside the checked-out workspace");
const output = process.env.CANARY_REPORT_DIR ? resolve(process.env.CANARY_REPORT_DIR) : mkdtempSync(resolve(process.env.RUNNER_TEMP ?? toolRoot, "canary-github-"));
mkdirSync(output, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["init_cwd", "npm_package_name", "npm_lifecycle_event", "canary_home"].includes(key.toLowerCase())));
const runCli = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: projectRoot, env: { ...env, CANARY_HOME: toolRoot }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 30 * 60 * 1000 });
const git = (...args) => { try { return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } };
const actualSha = git("rev-parse", "HEAD");
const cleanBefore = git("status", "--porcelain", "--untracked-files=no") === "";
const event = process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
const expectedSha = event.pull_request?.head?.sha ?? process.env.GITHUB_SHA;
const args = ["run", "--ci", "--project", projectRoot];
const config = process.env.CANARY_CONFIG;
if (config) {
  const path = realpathSync.native(resolve(projectRoot, config));
  const configRel = relative(projectRoot, path);
  if (isAbsolute(configRel) || configRel === ".." || configRel.startsWith("../") || configRel.startsWith("..\\")) throw new Error("Config must be inside the tested project");
  args.push("--config", path);
}
// Do not execute a checkout for a different PR head.
const execution = actualSha && actualSha === expectedSha ? runCli(args) : undefined;
let ci;
try {
  ci = JSON.parse(execution?.stdout ?? "");
  if (ci.kind !== "canary.ci" || ci.v !== 1 || !Number.isInteger(ci.exitCode) || ci.exitCode < 0 || ci.exitCode > 6 || ci.exitCode !== execution.status || !ci.summary || ![ci.summary.total, ci.summary.passed, ci.summary.failed].every((n) => Number.isSafeInteger(n) && n >= 0) || (ci.runId !== null && !/^[\w-]+$/.test(ci.runId))) throw new Error("Invalid CI envelope");
} catch {
  ci = { exitCode: execution?.status || 4, runId: null, summary: { total: 0, passed: 0, failed: 0 } };
}
let diagnostics, verified = false, coverageStatus = "unavailable", checkCounts;
if (ci.runId && /^[\w-]+$/.test(ci.runId)) {
  const diagnosticArgs = ["diagnostics", ci.runId, "--out", resolve(output, "diagnostic-bundle.json")];
  if (config) diagnosticArgs.push("--config", resolve(projectRoot, config));
  const exported = runCli(diagnosticArgs);
  if (exported.status === 0) {
    const bundle = JSON.parse(readFileSync(resolve(output, "diagnostic-bundle.json"), "utf8"));
    const verification = runCli(["diagnostics", "verify", resolve(output, "diagnostic-bundle.json")]);
    verified = verification.status === 0;
    if (verified) diagnostics = bundle.files["diagnostics.json"];
    if (verified && ci.artifactPath && existsSync(ci.artifactPath)) {
      const snapshot = JSON.parse(readFileSync(ci.artifactPath, "utf8"));
      if (snapshot.runId === ci.runId) {
        coverageStatus = snapshot.coverage?.status ?? "unavailable";
        if (snapshot.checks?.length) checkCounts = {
          failed: snapshot.checks.filter((check) => check.status === "failed").length,
          blocked: snapshot.checks.filter((check) => check.status === "blocked").length,
        };
      }
    }
  }
}
const sourceUnchanged = cleanBefore && git("status", "--porcelain", "--untracked-files=no") === "" && git("rev-parse", "HEAD") === actualSha;
const tracked = new Set(git("-c", "core.quotepath=false", "ls-files", "--full-name", "-z").split("\0"));
let mappingRoot = projectRoot;
if (ci.context?.projectRoot && existsSync(ci.context.projectRoot)) {
  const effectiveRoot = realpathSync.native(ci.context.projectRoot);
  const effectiveRel = relative(workspace, effectiveRoot);
  if (!isAbsolute(effectiveRel) && effectiveRel !== ".." && !effectiveRel.startsWith("../") && !effectiveRel.startsWith("..\\")) mappingRoot = effectiveRoot;
  else verified = false;
}
const report = githubReport({ ci, diagnostics, verified, expectedSha, actualSha, projectRoot: mappingRoot, workspace, sourceUnchanged, tracked, repository: process.env.GITHUB_REPOSITORY, serverUrl: process.env.GITHUB_SERVER_URL, workflowRunId: process.env.GITHUB_RUN_ID, coverageStatus, checkCounts });
writeFileSync(resolve(output, "summary.md"), report.summary);
writeFileSync(resolve(output, "github-report.json"), JSON.stringify(report, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.summary);
for (const annotation of report.annotations) console.log(annotation);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${report.outcome}\nexit-code=${report.exitCode}\nrun-id=${report.runId ?? ""}\nreport-path=${output}\nannotation-count=${report.annotations.length}\n`);
console.log(`Canary: ${report.outcome}; commit ${actualSha || "unknown"}; run ${report.runId ?? "none"}`);
// The composite action uploads reports before propagating this exit code.
