import { evidenceOutput } from "./lib/evidence-output.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, release, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeSourceLauncher } from "./source-launcher.mjs";
import { ciResultSchema, pathsSnapshotSchema, doctorSnapshotSchema } from "../packages/core/dist/index.js";

// Bounded R0 acceptance, not a platform/distribution certification.
const root = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const temporary = realpathSync.native(mkdtempSync(join(tmpdir(), "canary R0 acceptance ")));
const evidence = {
  v: 1,
  kind: "canary.r0.acceptance",
  date: new Date().toISOString(),
  root,
  platform: platform(),
  osRelease: release(),
  node: process.versions.node,
  checks: [],
};
function command(executable, args, cwd = root, env = process.env) {
  const child = spawnSync(executable, args, { cwd, env, encoding: "utf8", windowsHide: true, timeout: 120000 });
  assert.ifError(child.error);
  assert.equal(child.signal, null, child.stderr);
  return child;
}
function hashes() {
  const files = command("git", [
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
      .map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(join(root, file)))
          .digest("hex"),
      ]),
  );
}
try {
  evidence.commit = command("git", ["rev-parse", "HEAD"]).stdout.trim();
  evidence.dirty = Boolean(command("git", ["status", "--porcelain"]).stdout.trim());
  evidence.pnpm = command(
    process.platform === "win32" ? "cmd.exe" : "pnpm",
    process.platform === "win32" ? ["/d", "/c", "pnpm --version"] : ["--version"],
  ).stdout.trim();
  evidence.shell = process.platform === "win32" ? "cmd.exe (spawned from PowerShell)" : "/bin/sh";
  const before = hashes();
  evidence.sourceHashes = before;
  const { launcher } = writeSourceLauncher(root, temporary);
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !["path", "canary_home", "init_cwd", "npm_package_name", "npm_lifecycle_event"].includes(key.toLowerCase()),
    ),
  );
  const env = { ...cleanEnv, PATH: temporary + (process.platform === "win32" ? ";" : ":") + process.env.PATH };
  const child = command(
    process.platform === "win32" ? "cmd.exe" : "/bin/sh",
    process.platform === "win32"
      ? ["/d", "/c", "canary run --ci --config canary.config.ts"]
      : ["-c", "canary run --ci --config canary.config.ts"],
    root,
    env,
  );
  const result = ciResultSchema.parse(JSON.parse(child.stdout));
  assert.equal(child.status, 0, child.stderr + child.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(result.context.projectRoot, root);
  assert(result.summary.total > 0);
  const artifactHashes = {};
  for (const name of ["ci.json", "run.json", "report.json", "report.xml"]) {
    const path = join(dirname(result.artifactPath), name);
    assert(existsSync(path));
    artifactHashes[name] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  evidence.checks.push({
    command: "canary run --ci --config canary.config.ts",
    status: "verified",
    exitCode: child.status,
    launcher,
    result,
    artifactHashes,
  });
  const cli = join(root, "packages/cli/dist/index.js");
  const invalid = command(process.execPath, [cli, "run", "--ci", "--config", join(temporary, "missing.config.ts")]);
  const invalidResult = ciResultSchema.parse(JSON.parse(invalid.stdout));
  assert.equal(invalid.status, 2);
  assert.equal(invalidResult.issues[0].code, "CONFIG_NOT_FOUND");
  assert(!existsSync(join(temporary, ".canary")));
  evidence.checks.push({
    command: "canary run --ci --config <missing.config.ts>",
    status: "verified",
    exitCode: invalid.status,
    result: invalidResult,
  });
  const paths = command(process.execPath, [cli, "paths", "--json"]);
  const doctor = command(process.execPath, [cli, "doctor", "--json"]);
  const pathValue = pathsSnapshotSchema.parse(JSON.parse(paths.stdout));
  const doctorValue = doctorSnapshotSchema.parse(JSON.parse(doctor.stdout));
  assert.equal(paths.status, 0);
  assert.equal(doctor.status, 0);
  for (const key of ["invocationRoot", "projectRoot", "artifactRoot", "installRoot"])
    assert.equal(pathValue[key], doctorValue[key]);
  evidence.checks.push({
    command: "canary paths --json / canary doctor --json",
    status: "verified",
    paths: pathValue,
    doctor: doctorValue,
  });
  const pnpmRun = command(
    process.platform === "win32" ? "cmd.exe" : "pnpm",
    process.platform === "win32"
      ? ["/d", "/c", "pnpm canary run --ci --config canary.config.ts"]
      : ["canary", "run", "--ci", "--config", "canary.config.ts"],
  );
  assert.equal(pnpmRun.status, 0, pnpmRun.stderr);
  const pnpmResult = ciResultSchema.parse(JSON.parse(pnpmRun.stdout.trim().split(/\r?\n/).at(-1)));
  assert.equal(pnpmResult.context.projectRoot, root);
  evidence.checks.push({
    command: "pnpm canary run --ci --config canary.config.ts",
    status: "verified",
    exitCode: pnpmRun.status,
    result: pnpmResult,
  });
  assert.deepEqual(hashes(), before, "Canary changed tracked project source files");
  evidence.checks.push({
    command: "SHA-256 tracked and new packages/apps/examples/scripts/config before vs after",
    status: "verified",
    files: Object.keys(before).length,
  });
  evidence.status = "verified";
} finally {
  // Only this script's mkdtemp-owned directory; never installation or project roots.
  rmSync(temporary, { recursive: true, force: true });
}
const output = JSON.stringify(evidence, null, 2) + "\n";
const out = process.argv.indexOf("--out");
const destination = evidenceOutput("r0", "r0-acceptance.json", out >= 0 ? process.argv[out + 1] : undefined);
writeFileSync(destination, output, "utf8");
console.log(output);
