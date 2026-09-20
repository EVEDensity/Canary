import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArtifacts } from "../packages/trace/dist/index.js";
import { writeSourceLauncher } from "./source-launcher.mjs";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const base = realpathSync(mkdtempSync(join(tmpdir(), "canary R4 acceptance ")));
const { launcher } = writeSourceLauncher(root, join(base, "bin"));
const report = {
  v: 1,
  kind: "canary.r4.acceptance",
  date: new Date().toISOString(),
  platform: process.platform,
  osRelease: release(),
  node: process.versions.node,
  checks: [],
};
function command(args, cwd, expected = 0) {
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.COMSPEC ?? "cmd.exe", ["/d", "/c", launcher, ...args], {
          cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: 360000,
        })
      : spawnSync(launcher, args, { cwd, encoding: "utf8", timeout: 360000 });
  assert.ifError(result.error);
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(result.status),
    `exit mismatch: ${result.stderr}\n${result.stdout}`,
  );
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1, "stdout must be one JSON line");
  return JSON.parse(result.stdout);
}
function sources() {
  const found = spawnSync(
    "git",
    [
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
      "canary.project.json",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(found.status, 0);
  return Object.fromEntries(
    found.stdout
      .split("\0")
      .filter(Boolean)
      .map((path) => [
        path,
        createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex"),
      ]),
  );
}
const before = sources();
try {
  const python = spawnSync("python", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.ifError(python.error);
  assert.equal(python.status, 0);
  report.python = (python.stdout || python.stderr).trim();
  for (const language of ["node", "python"]) {
    const cwd = join(base, `${language} project`);
    cpSync(join(root, "scripts/fixtures/r4", language), cwd, { recursive: true });
    const discovery = command(["discover", "--json"], cwd);
    assert.equal(discovery.status, "declared");
    assert.equal(discovery.automaticExecution, false);
    assert.ok(discovery.languages.some((item) => item.language === language));
    const ci = command(["run", "--ci"], cwd);
    assert.equal(ci.capabilities.scope, "project-checks");
    assert.equal(ci.summary.passed, 1);
    const dir = dirname(ci.artifactPath);
    const integrity = verifyArtifacts(dir);
    assert.equal(integrity.status, "verified");
    assert.ok(readFileSync(join(dir, "report.xml"), "utf8").includes('errors="0"'));
    report.checks.push({ name: `${language}-fixture`, status: "verified", ci, integrity });
    // Make the real test runner fail; a framework failure must propagate as CI 1.
    const file = join(cwd, language === "node" ? "math.mjs" : "calculator.py");
    writeFileSync(
      file,
      language === "node" ? "export function sum() { return 999; }" : "def sum_values(values):\n    return 999\n",
    );
    const failed = command(["run", "--ci"], cwd, 1);
    assert.equal(failed.summary.failed, 1);
    report.checks.push({ name: `${language}-real-assertion-failure`, status: "verified", ci: failed });
  }
  const unknown = join(base, "unknown project");
  mkdirSync(unknown);
  const discovery = command(["discover", "--json"], unknown, 2);
  assert.equal(discovery.status, "blocked");
  const unconfigured = command(["run", "--ci"], unknown, 2);
  assert.equal(unconfigured.summary.passed, 0);
  report.checks.push({ name: "unknown-language-blocked", status: "verified", discovery, ci: unconfigured });
  writeFileSync(
    join(unknown, "docker.json"),
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      checks: [{ id: "docker.probe", type: "docker", container: "canary-r4-nonexistent-fixture", timeoutMs: 3000 }],
    }),
  );
  const docker = command(["run", "--ci", "--config", "docker.json"], unknown, [3, 4]);
  report.checks.push({ name: "docker-unavailable-does-not-pass", status: "verified", ci: docker });
  report.dockerRuntime = {
    status: "blocked",
    reason: "No running fixture container; only unavailable/timeout behavior was verified.",
  };
  const self = command(["run", "--ci", "--config", "canary.project.json"], root);
  assert.equal(self.summary.passed, JSON.parse(readFileSync(join(root, "canary.project.json"), "utf8")).checks.length);
  assert.equal(verifyArtifacts(dirname(self.artifactPath)).status, "verified");
  report.checks.push({ name: "canary-self-required-checks", status: "verified", ci: self });
  assert.deepEqual(sources(), before);
  report.checks.push({ name: "project-sources-unchanged", status: "verified", files: Object.keys(before).length });
} finally {
  assert.ok(base.startsWith(realpathSync(tmpdir())) && base.includes("canary R4 acceptance "));
  rmSync(base, { recursive: true, force: true });
}
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0) {
  const out = resolve(process.argv[outIndex + 1]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
}
assert.ok(report.checks.every((check) => check.status === "verified"));
console.log(JSON.stringify(report, null, 2));
