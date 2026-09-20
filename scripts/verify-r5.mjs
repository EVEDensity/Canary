import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { join, resolve } from "node:path";
import { verifyArtifacts } from "../packages/trace/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const base = realpathSync(mkdtempSync(join(tmpdir(), "canary R5 CLI ")));
const cli = join(root, "packages/cli/dist/index.js");
const config = join(base, "checks.json");
const report = {
  kind: "canary.r5.acceptance",
  date: new Date().toISOString(),
  platform: process.platform,
  osRelease: release(),
  node: process.version,
  checks: [],
};
writeFileSync(
  config,
  JSON.stringify({
    kind: "canary.project",
    version: 1,
    checks: [
      {
        id: "slow",
        type: "command",
        command: "node",
        args: ["-e", "setTimeout(()=>console.log('Bearer r5-test-secret'),1500)"],
      },
      { id: "file", type: "filesystem", path: "ready.txt", dependsOn: ["slow"] },
      { id: "capacity", type: "resources", required: false },
    ],
  }),
);
let child;
const until = async (read, ready) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch {}
    await new Promise((done) => setTimeout(done, 50));
  }
  throw Error("Timed out");
};
try {
  child = spawn(process.execPath, [cli, "run", "--no-open", "--port", "0", "--config", config], {
    cwd: base,
    windowsHide: true,
  });
  let output = "",
    errors = "";
  child.stdout.on("data", (value) => {
    output += value;
  });
  child.stderr.on("data", (value) => {
    errors += value;
  });
  const exited = new Promise((done) => child.once("exit", done));
  const url = await until(async () => output.match(/canary UI: (http:\/\/\S+)/)?.[1], Boolean);
  const origin = new URL(url).origin,
    first = new URL(url).searchParams.get("runId");
  const get = async (path) => {
    const res = await fetch(origin + path);
    assert.equal(res.status, 200);
    return res.json();
  };
  assert.equal((await get(`/api/runs/${first}`)).status, "running");
  const html = await (await fetch(url)).text();
  const token = JSON.parse(html.match(/const writeToken=("[^"]+")/)[1]);
  assert.ok(html.includes("项目检查"));
  const post = (path, body) =>
    fetch(origin + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canary-write-token": token },
      body: JSON.stringify(body),
    });
  const initial = await until(
    () => get(`/api/runs/${first}`),
    (run) => run.status === "failed",
  );
  assert.equal(initial.checks.filter((c) => c.status === "failed").length, 1);
  report.checks.push({ name: "real-cli-live-page-and-failure", status: "verified" });
  await until(
    async () => verifyArtifacts(join(base, ".canary/artifacts", first)),
    (value) => value.status === "verified",
  );
  writeFileSync(join(base, "ready.txt"), "ready");
  const retry = await post(`/api/runs/${first}/retry`, { failed: true });
  assert.equal(retry.status, 202);
  const id = (await retry.json()).runId;
  const next = await until(
    () => get(`/api/runs/${id}`),
    (run) => run.status === "completed",
  );
  assert.deepEqual(
    next.checks.map((c) => c.id),
    ["slow", "file"],
  );
  assert.equal(next.retryOf, first);
  assert.ok(!JSON.stringify(next).includes("r5-test-secret"));
  const compare = await get(`/api/compare?baseline=${first}&candidate=${id}`);
  assert.deepEqual(
    compare.checks.find((c) => c.id === "file"),
    { id: "file", before: "failed", after: "passed" },
  );
  report.checks.push({ name: "failed-retry-dependencies-lineage-redaction-comparison", status: "verified" });
  await until(
    async () => verifyArtifacts(join(base, ".canary/artifacts", id)),
    (value) => value.status === "verified",
  );
  const single = await post(`/api/runs/${id}/retry`, { checkId: "slow" });
  assert.equal(single.status, 202);
  const singleId = (await single.json()).runId;
  assert.equal((await post("/api/session/close", {})).status, 200);
  assert.equal(await exited, 1, errors); // CLI conclusion belongs to its initial full run.
  for (const runId of [first, id, singleId])
    assert.equal(verifyArtifacts(join(base, ".canary/artifacts", runId)).status, "verified");
  report.checks.push({ name: "single-retry-close-during-execution-seals-evidence", status: "verified" });
  const ci = spawnSync(process.execPath, [cli, "run", "--ci", "--config", config], {
    cwd: base,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(ci.status, 0, ci.stderr);
  const ordinary = spawnSync(process.execPath, [cli, "run", "--artifacts-only", "--config", config], {
    cwd: base,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(ordinary.status, ci.status, ordinary.stderr);
  assert.ok(!ordinary.stdout.includes("canary UI:"));
  report.checks.push({ name: "ci-and-artifact-only-parity", status: "verified" });
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child && child.exitCode === null) {
    const stopped = new Promise((done) => child.once("exit", done));
    child.kill();
    await stopped;
  }
  const logs = join(root, "docs/evidence/logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "r5-acceptance.json"), JSON.stringify(report, null, 2) + "\n");
  // base is the absolute directory returned by mkdtemp, owned by this script.
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
