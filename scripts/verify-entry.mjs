import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ciResultSchema } from "../packages/core/dist/index.js";
import { verifyArtifacts } from "../packages/trace/dist/index.js";

const root = realpathSync.native(resolve(import.meta.dirname, ".."));
const meta = JSON.parse(readFileSync(join(homedir(), ".canary/home.json"), "utf8"));
assert.equal(realpathSync.native(meta.root), root, "Install this checkout first");
const base = realpathSync.native(mkdtempSync(join(tmpdir(), "Canary global entry ")));
const report = {
  kind: "canary.entry.acceptance",
  date: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  installedRoot: meta.root,
  binDir: meta.binDir,
  sourceDirty: meta.sourceDirty,
  fixtureRoot: base,
  checks: [],
};
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !["path", "canary_home", "init_cwd", "npm_package_name", "npm_lifecycle_event"].includes(key.toLowerCase()),
  ),
);
if (process.platform === "win32") {
  const probe = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'))",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(probe.status, 0);
  env.PATH = probe.stdout.trim();
} else env.PATH = meta.binDir + ":" + process.env.PATH;
const binary = process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "canary";
const argv = (args) => (process.platform === "win32" ? ["/d", "/c", "canary", ...args] : args);
function invoke(args, cwd, expected = 0, timeout = 30000) {
  const child = spawnSync(binary, argv(args), {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.status, expected, child.stderr + child.stdout);
  return child;
}
function ci(cwd, args = [], expected = 0, timeout = 30000) {
  const result = invoke(["run", "--ci", ...args], cwd, expected, timeout);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  const value = ciResultSchema.parse(JSON.parse(result.stdout));
  assert.equal(value.exitCode, expected);
  if (expected === 0) assert.equal(verifyArtifacts(dirname(value.artifactPath)).status, "verified");
  return value;
}
function fixture(name) {
  const dir = join(base, name);
  mkdirSync(join(dir, "nested folder"), { recursive: true });
  writeFileSync(
    join(dir, "canary.project.json"),
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      checks: [
        {
          id: name,
          type: "command",
          command: "node",
          args: ["-e", "setTimeout(()=>console.log('entry verified'),1500)"],
        },
      ],
    }),
  );
  writeFileSync(join(dir, "agent.mjs"), "export default async input => ({value:input});");
  writeFileSync(
    join(dir, "cases.ts"),
    "export default [{id:'legacy',input:'ok',assertions:[{type:'output.exists'}]}];",
  );
  writeFileSync(
    join(dir, "canary.config.ts"),
    "export default {agent:{adapter:'function',entry:'./agent.mjs'},cases:'./cases.ts',coverage:{include:['agent.mjs']},web:{enabled:false}};",
  );
  return dir;
}
const a = fixture("project-a"),
  b = fixture("project-b"),
  outside = join(base, "unconfigured");
mkdirSync(outside);
let serverProcess;
try {
  const resolved = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["canary"], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(resolved.status, 0);
  assert.equal(
    realpathSync.native(dirname(resolved.stdout.trim().split(/\r?\n/)[0])),
    realpathSync.native(meta.binDir),
  );
  report.checks.push({
    name: "installed-command-on-user-path",
    status: "verified",
    launcher: resolved.stdout.trim().split(/\r?\n/)[0],
  });
  const first = ci(join(a, "nested folder")),
    second = ci(b);
  assert.equal(first.context.projectRoot, a);
  assert.equal(first.capabilities.scope, "project-checks");
  assert.equal(first.context.installRoot, root);
  assert.equal(second.context.projectRoot, b);
  report.checks.push({
    name: "nested-default-project-config-and-two-project-isolation",
    status: "verified",
    runs: [first.runId, second.runId],
  });
  const exported = JSON.parse(invoke(["report", first.runId, "--format", "json"], a).stdout);
  assert.equal(exported.kind, "canary.project-report");
  assert.equal(exported.checks[0].id, "project-a");
  report.checks.push({ name: "global-cli-project-report", status: "verified" });
  const legacy = ci(a, ["--config", "canary.config.ts"]);
  assert.equal(legacy.capabilities.scope, "configured-agent-cases");
  report.checks.push({ name: "explicit-legacy-agent-config", status: "verified", runId: legacy.runId });
  const plan = readFileSync(join(a, "canary.project.json"));
  writeFileSync(join(a, "canary.project.json"), "{invalid");
  try {
    assert.equal(ci(a, [], 2).issues[0].code, "CONFIG_INVALID");
  } finally {
    writeFileSync(join(a, "canary.project.json"), plan);
  }
  ci(outside, [], 2);
  assert.ok(!existsSync(join(outside, ".canary")));
  report.checks.push({ name: "bad-or-missing-config-never-falls-back-to-demo", status: "verified" });
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  serverProcess = spawn(binary, argv(["run", "--no-open", "--port", String(port)]), {
    cwd: join(a, "nested folder"),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    stderr = "";
  serverProcess.stdout.on("data", (chunk) => (output += chunk));
  serverProcess.stderr.on("data", (chunk) => (stderr += chunk));
  const exit = new Promise((done) => serverProcess.once("exit", done));
  const until = async (read, predicate) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      try {
        const value = await read();
        if (predicate(value)) return value;
      } catch {}
      await new Promise((done) => setTimeout(done, 50));
    }
    throw Error("UI wait timed out: " + stderr);
  };
  const url = await until(async () => output.match(/canary UI: (http:\/\/\S+)/)?.[1], Boolean);
  assert.equal(new URL(url).port, String(port));
  const origin = new URL(url).origin,
    id = new URL(url).searchParams.get("runId");
  const html = await fetch(url).then((r) => r.text());
  assert.ok(html.includes("项目检查"));
  const active = await fetch(origin + `/api/runs/${id}`).then((r) => r.json());
  assert.equal(active.status, "running");
  assert.equal((await fetch(origin + `/api/runs/${second.runId}`)).status, 404);
  const token = JSON.parse(html.match(/const writeToken=("[^"]+")/)[1]);
  assert.equal(
    (
      await fetch(origin + "/api/session/close", {
        method: "POST",
        headers: { "content-type": "application/json", "x-canary-write-token": token },
        body: "{}",
      })
    ).status,
    200,
  );
  let timer;
  const exitCode = await Promise.race([
    exit,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Launcher did not exit after UI close")), 20000);
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(exitCode, 0, stderr);
  assert.equal(verifyArtifacts(join(a, ".canary/artifacts", id)).status, "verified");
  report.checks.push({
    name: "installed-command-explicit-port-live-page-and-evidence-after-close",
    status: "verified",
    port,
    runId: id,
  });
  if (process.argv.includes("--self")) {
    const result = ci(join(root, "packages/cli"), [], 0, 900000);
    const run = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    const ids = JSON.parse(readFileSync(join(root, "canary.project.json"), "utf8")).checks.map((c) => c.id);
    assert.deepEqual(
      run.checks.map((c) => c.id),
      ids,
    );
    assert.ok(run.checks.every((c) => c.status === "passed"));
    report.checks.push({
      name: "installed-default-canary-self-required-gate",
      status: "verified",
      checks: ids,
      runId: result.runId,
      artifactPath: result.artifactPath,
    });
  }
  report.status = "verified";
} catch (error) {
  report.status = "failed";
  report.error = String(error.message).slice(0, 4000);
  process.exitCode = 1;
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill();
  const path = join(root, "docs/evidence/logs/entry-acceptance.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
