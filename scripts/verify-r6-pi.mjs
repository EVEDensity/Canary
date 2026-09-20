import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { verifyArtifacts } from "../packages/trace/dist/index.js";
import { ciResultSchema } from "../packages/core/dist/index.js";

// This entry deliberately verifies runtime integration only. It never invokes a model.
const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(readFileSync(join(root, "integrations/fixtures/pi-agent/fixture.json"), "utf8"));
const output = resolve(process.env.CANARY_R6_PI_OUTPUT ?? "docs/evidence/logs/r6-pi-runtime.json");
const base = realpathSync(mkdtempSync(join(tmpdir(), "Canary Pi runtime ")));
const home = join(base, "isolated-home");
mkdirSync(home);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"].includes(key.toUpperCase()),
  ),
);
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  TEMP: home,
  TMP: home,
  PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
  npm_config_cache: join(home, "npm-cache"),
  npm_config_userconfig: join(home, ".npmrc"),
  npm_config_registry: "https://registry.npmjs.org/",
});
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const report = {
  kind: "canary.r6.pi-runtime",
  date: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  osRelease: release(),
  fixtureRoot: base,
  package: fixture.package,
  upstreamCommit: fixture.commit,
  checks: [],
  stageComplete: false,
  inference: {
    status: "blocked",
    reason:
      "No user-selected authorized provider/model or credential injection was supplied. Runtime probes do not prove inference.",
    modelCalls: 0,
    credentialDiscovery: false,
  },
};
function command(binary, args, timeout = 120000) {
  const r = spawnSync(binary, args, {
    cwd: base,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, (r.stderr + r.stdout).slice(-3000));
  return r;
}
try {
  assert.ok(
    process.argv.includes("--install"),
    "Explicit --install is required to download the pinned external runtime",
  );
  writeFileSync(
    join(base, "package.json"),
    JSON.stringify({ private: true, name: "canary-pi-runtime-fixture", version: "1.0.0" }),
  );
  const args = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", fixture.package];
  const installed = command(
    process.platform === "win32" ? "cmd.exe" : "npm",
    process.platform === "win32" ? ["/d", "/c", "npm", ...args] : args,
    180000,
  );
  writeFileSync(join(base, "install.log"), installed.stdout + installed.stderr);
  const packageDir = join(base, "node_modules/@earendil-works/pi-coding-agent");
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.86.0");
  assert.equal(pkg.name, "@earendil-works/pi-coding-agent");
  const lock = JSON.parse(readFileSync(join(base, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@earendil-works/pi-coding-agent"].integrity, fixture.integrity);
  const entry = join(packageDir, pkg.bin.pi);
  report.checks.push({
    name: "pinned-runtime-install",
    status: "verified",
    version: pkg.version,
    integrity: fixture.integrity,
    entryHash: sha(entry),
    lockHash: sha(join(base, "package-lock.json")),
  });
  writeFileSync(
    join(base, "canary.project.json"),
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      budgetMs: 60000,
      checks: ["version", "help"].map((probe) => ({
        id: `pi.${probe}`,
        type: "command",
        command: process.execPath,
        args: [entry, `--${probe}`],
        timeoutMs: 20000,
      })),
    }),
  );
  const result = command(process.execPath, [join(root, "packages/cli/dist/index.js"), "run", "--ci"], 90000);
  const ci = ciResultSchema.parse(JSON.parse(result.stdout));
  assert.equal(ci.exitCode, 0);
  const snapshot = JSON.parse(readFileSync(ci.artifactPath, "utf8"));
  assert.equal(snapshot.checks[0].stdout.trim(), "0.86.0");
  assert.match(snapshot.checks[1].stdout, /--provider/);
  assert.ok(snapshot.checks.every((c) => c.status === "passed"));
  assert.equal(verifyArtifacts(dirname(ci.artifactPath)).status, "verified");
  report.checks.push({
    name: "real-pi-cli-through-canary",
    status: "verified",
    runId: ci.runId,
    artifactPath: ci.artifactPath,
    manifestHash: sha(join(dirname(ci.artifactPath), "manifest.json")),
    probes: ["--version", "--help"],
  });
  report.runtimeGate = "passed";
} catch (error) {
  report.runtimeGate = "failed";
  report.error = String(error.message).slice(0, 3000);
  process.exitCode = 1;
} finally {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
