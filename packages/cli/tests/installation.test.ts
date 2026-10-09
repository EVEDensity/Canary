import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const stateModule = fileURLToPath(new URL("../../../scripts/lib/install-state.mjs", import.meta.url));
const runnerModule = fileURLToPath(new URL("../../../scripts/lib/command-runner.mjs", import.meta.url));
it("resolves Windows package-manager argv literally without shell mode", async () => {
  const { commandInvocation } = await import(runnerModule);
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary native argv ")));
  try {
    mkdirSync(join(root, "node_modules/pnpm/bin"), { recursive: true });
    writeFileSync(join(root, "pnpm.cmd"), "not executed");
    writeFileSync(join(root, "node_modules/pnpm/bin/pnpm.cjs"), "console.log(JSON.stringify(process.argv.slice(2)))");
    const args = ["path with spaces", "literal & echo unexpected", "$(not-a-command)"];
    const invocation = commandInvocation("pnpm", args, { PATH: root }, "win32");
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args.slice(1)).toEqual(args);
    const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8", shell: false });
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(result.stderr).not.toContain("DEP0190");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("publishes a real global entry, checks an independent project and page, and preserves active state after failed upgrade", async () => {
  const { publishInstallation, validateInstallation } = await import(stateModule);
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary installation "))),
    repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const binDir = join(root, "bin with spaces"),
    metaDir = join(root, "registry");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const runtime = validateInstallation(repo);
    publishInstallation({
      root: repo,
      binDir,
      metaDir,
      metadata: { ...runtime, commit: "fixture", channel: "working-tree" },
    });
    const saved = readFileSync(join(metaDir, "home.json"));
    expect(() => publishInstallation({ root: join(root, "missing-runtime"), binDir, metaDir, metadata: {} })).toThrow();
    expect(readFileSync(join(metaDir, "home.json"))).toEqual(saved);
    const fake = join(root, "state-switch-unit");
    mkdirSync(join(fake, "packages/cli/dist"), { recursive: true });
    writeFileSync(join(fake, "packages/cli/package.json"), '{"version":"9.0.0"}');
    writeFileSync(
      join(fake, "packages/cli/dist/index.js"),
      'console.log(JSON.stringify({kind:"canary.version",v:1,canaryVersion:"9.0.0",nodeVersion:process.versions.node}))',
    );
    mkdirSync(join(metaDir, "home.json.tmp"));
    expect(() => publishInstallation({ root: fake, binDir, metaDir, metadata: { version: "9.0.0" } })).toThrow();
    expect(readFileSync(join(metaDir, "home.json"))).toEqual(saved);
    rmSync(join(metaDir, "home.json.tmp"), { recursive: true });
    publishInstallation({ root: fake, binDir, metaDir, metadata: { channel: "unit-state-switch" } });
    const rollback = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../../../scripts/upgrade-global.mjs", import.meta.url)), "--rollback"],
      { encoding: "utf8", timeout: 30000, env: { ...process.env, CANARY_INSTALL_HOME: metaDir } },
    );
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(metaDir, "home.json"), "utf8")).root).toBe(repo);
    const project = join(root, "independent project"),
      nested = join(project, "nested directory");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "entry-fixture", private: true, scripts: { test: "node check.mjs" } }),
    );
    writeFileSync(join(project, "check.mjs"), "import assert from 'node:assert/strict'; assert.equal(2+2,4);\n");
    const env = {
      ...process.env,
      CANARY_INSTALL_HOME: metaDir,
      PATH: binDir + (process.platform === "win32" ? ";" : ":") + process.env.PATH,
    };
    const invoke = () =>
      spawnSync(
        process.platform === "win32" ? "cmd.exe" : join(binDir, "canary"),
        process.platform === "win32" ? ["/d", "/s", "/c", "canary run --ci"] : ["run", "--ci"],
        { cwd: nested, env, encoding: "utf8", timeout: 30000 },
      );
    const passed = invoke();
    expect(passed.status, passed.stderr).toBe(0);
    expect(JSON.parse(passed.stdout).summary.passed).toBe(1);
    expect(existsSync(join(project, "canary.project.json"))).toBe(false);
    writeFileSync(join(project, "check.mjs"), "throw new Error('intentional installer fixture failure');\n");
    const failed = invoke();
    expect(failed.status, failed.stderr).toBe(1);
    expect(JSON.parse(failed.stdout).summary.failed).toBe(1);
    const lease = createServer();
    await new Promise<void>((done) => lease.listen(0, "127.0.0.1", done));
    const port = (lease.address() as { port: number }).port;
    await new Promise<void>((done) => lease.close(() => done()));
    child = spawn(process.execPath, [join(binDir, "canary-run.mjs"), "run", "--port", String(port), "--no-open"], {
      cwd: nested,
      env,
      stdio: "ignore",
    });
    let data: Array<{ runId: string; status: string }> = [];
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/workspace/runs`);
        data = (await response.json()) as typeof data;
        if (data.some((row) => row.status === "failed")) break;
      } catch {
        /* Wait for the report service. */
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(data.some((row) => row.status === "failed")).toBe(true);
    const response = await fetch(
      `http://127.0.0.1:${port}/api/workspace/runs/${data.find((row) => row.status === "failed")!.runId}`,
    );
    const report = (await response.json()) as { checks: Array<{ status: string }> };
    expect(report.checks.some((check) => check.status === "failed")).toBe(true);
  } finally {
    if (child?.pid) {
      const { killProcessTree, waitForExit } = await import("@canary/isolation");
      killProcessTree(child.pid);
      await waitForExit(child.pid);
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 90000);
