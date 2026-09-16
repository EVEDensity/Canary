import { writeSourceLauncher } from "../../../scripts/source-launcher.mjs";
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ciResultSchema, doctorSnapshotSchema, pathsSnapshotSchema, versionSnapshotSchema } from "@canary/core";

const base = realpathSync.native(mkdtempSync(join(tmpdir(), "canary R0 isolated user ")));
const home = join(base, "non default home");
const installed = join(base, "independent install");
mkdirSync(home, { recursive: true });
mkdirSync(installed, { recursive: true });
writeFileSync(join(installed, "canary.config.ts"), "throw new Error('MUST NOT LOAD INSTALL DEMO');");
const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.ts");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !["home", "userprofile", "canary_home", "init_cwd", "npm_package_name", "npm_lifecycle_event"].includes(
        key.toLowerCase(),
      ),
  ),
);
const env = {
  ...inherited,
  HOME: home,
  USERPROFILE: home,
  CANARY_HOME: installed,
  INIT_CWD: installed,
  npm_package_name: "",
};
afterAll(() => rmSync(base, { recursive: true, force: true }));
let count = 0;
function fixture(options: { agent?: string; cases?: string; config?: string } = {}) {
  const project = join(base, `project space ${++count}`);
  mkdirSync(project);
  writeFileSync(join(project, "agent.mjs"), options.agent ?? "export default async input => ({ value: input });");
  writeFileSync(
    join(project, "cases.ts"),
    options.cases ?? "export default [{ id: 'smoke', input: 'ok', assertions: [{ type: 'output.exists' }] }];",
  );
  writeFileSync(
    join(project, "canary.config.ts"),
    options.config ??
      `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] }, reporters: ['console'], web: { enabled: true, open: true, port: 1 } };`,
  );
  return project;
}
function invoke(cwd: string, args: string[], overrides: Record<string, string> = {}) {
  const child = spawnSync(process.execPath, ["--import", loader, cli, ...args], {
    cwd,
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  return child;
}
function ci(cwd: string, args: string[] = []) {
  const child = invoke(cwd, ["run", "--ci", ...args]);
  const value = ciResultSchema.parse(JSON.parse(child.stdout.trim()));
  expect(child.status, child.stderr).toBe(value.exitCode);
  expect(value.capabilities).toEqual({ scope: "configured-agent-cases", web: false, automaticExport: false });
  return { ...child, value };
}

describe("R0 executable CI contract", () => {
  it("runs real cases from a nested path without UI, preserves source, writes CI/JSON/JUnit and keeps all roots separate", () => {
    const project = fixture();
    const nested = join(project, "nested folder");
    mkdirSync(nested);
    const source = readFileSync(join(project, "agent.mjs"), "utf8");
    const { value, stdout } = ci(nested, ["--json"]);
    expect(value.exitCode).toBe(0);
    expect(value.context).toMatchObject({
      invocationRoot: nested,
      projectRoot: project,
      installRoot: installed,
      artifactRoot: join(project, ".canary", "artifacts"),
      source: "walk",
    });
    expect(value.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const runDir = dirname(value.artifactPath!);
    for (const file of ["run.json", "report.json", "report.xml", "ci.json"])
      expect(existsSync(join(runDir, file))).toBe(true);
    expect(JSON.parse(readFileSync(join(runDir, "ci.json"), "utf8"))).toEqual(value);
    expect(readFileSync(join(project, "agent.mjs"), "utf8")).toBe(source);
    expect(existsSync(join(installed, ".canary"))).toBe(false);
  });
  it("does not execute the installed demo when the project has no config", () => {
    const outside = join(base, "unconfigured project");
    mkdirSync(outside);
    const { value } = ci(outside);
    expect(value.exitCode).toBe(2);
    expect(value.issues[0]?.code).toBe("CONFIG_NOT_FOUND");
    expect(value.context.projectRoot).toBe(outside);
    expect(value.runId).toBeNull();
    expect(existsSync(join(outside, ".canary"))).toBe(false);
  });
  it("honors relative explicit config over local discovery", () => {
    const project = fixture();
    const invocation = join(base, "invoke separately");
    mkdirSync(invocation);
    const { value } = ci(invocation, ["--config", join("..", project.split(/[/\\]/).at(-1)!, "canary.config.ts")]);
    expect(value.exitCode).toBe(0);
    expect(value.context.source).toBe("config");
    expect(value.context.projectRoot).toBe(project);
  });
  it.each([
    ["invalid schema", { config: "export default { agent: 42 };" }],
    ["throwing config", { config: "throw new Error('api_key=DO_NOT_LEAK');" }],
    ["invalid cases", { cases: "export default [{id: 42}];" }],
    ["empty cases", { cases: "export default [];" }],
    ["duplicate cases", { cases: "export default [{id:'same',input:1},{id:'same',input:2}];" }],
  ] as const)("classifies %s as configuration error without exposing exceptions", (_label, options) => {
    const project = fixture(options);
    const child = ci(project);
    expect(child.value.exitCode).toBe(2);
    expect(child.stdout + child.stderr).not.toContain("DO_NOT_LEAK");
    expect(existsSync(join(project, ".canary"))).toBe(false);
  });
  it.each([
    ["--config"],
    ["--config", "--json"],
    ["--port", "9000"],
    ["--repetitions", "0"],
    ["--repetitions", "NaN"],
    ["--unknown"],
    ["--case", "smoke", "--case", "other"],
  ])("rejects invalid arguments %j before running", (...args) => {
    expect(ci(fixture(), args).value.exitCode).toBe(2);
  });
  it("fails an unknown case selection, rather than passing zero tests", () => {
    expect(ci(fixture(), ["--case", "absent"]).value.exitCode).toBe(2);
  });
  it("rejects a missing agent entry as a configuration error", () => {
    const project = fixture({
      config:
        "export default {agent:{adapter:'function',entry:'./missing.mjs'},cases:'./cases.ts',coverage:{include:['*.mjs']}};",
    });
    expect(ci(project).value.issues[0]?.code).toBe("AGENT_ENTRY_MISSING");
    expect(existsSync(join(project, ".canary"))).toBe(false);
  });
  it("diagnoses corrupt metadata and a missing launcher without rewriting user files", () => {
    const project = fixture();
    const isolatedHome = join(project, "user home");
    const metadataDir = join(isolatedHome, ".canary");
    mkdirSync(metadataDir, { recursive: true });
    const metadata = join(metadataDir, "home.json");
    writeFileSync(metadata, "{broken");
    const overrides = { HOME: isolatedHome, USERPROFILE: isolatedHome, CANARY_HOME: "" };
    const corrupt = doctorSnapshotSchema.parse(JSON.parse(invoke(project, ["doctor", "--json"], overrides).stdout));
    expect(corrupt.metadataStatus).toBe("invalid");
    expect(corrupt.issues.some((i) => i.code === "INSTALL_METADATA_INVALID")).toBe(true);
    expect(readFileSync(metadata, "utf8")).toBe("{broken");
    writeFileSync(metadata, JSON.stringify({ root: installed, binDir: join(isolatedHome, "missing bin") }));
    const missing = doctorSnapshotSchema.parse(JSON.parse(invoke(project, ["doctor", "--json"], overrides).stdout));
    expect(missing.issues.some((i) => i.code === "LAUNCHER_MISSING")).toBe(true);
    expect(missing.issues.every((i) => i.suggestion.length > 0)).toBe(true);
  }, 15000);
  it("runs the generated global launcher from an independent project with spaces", () => {
    const project = fixture();
    const repo = resolve(dirname(cli), "../../..");
    const { launcher } = writeSourceLauncher(repo, join(base, "global bin"));
    const child = spawnSync(
      process.platform === "win32" ? "cmd.exe" : launcher,
      process.platform === "win32" ? ["/d", "/c", launcher, "run", "--ci"] : ["run", "--ci"],
      {
        cwd: project,
        env: { ...env, npm_package_name: "@canary/cli", npm_lifecycle_event: "canary" },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const value = ciResultSchema.parse(JSON.parse(child.stdout));
    expect(value.context.projectRoot).toBe(project);
    expect(value.context.installRoot).toBe(repo);
    expect(value.summary.passed).toBe(1);
  });
  it("returns 6 for a real policy violation even when output assertions pass", () => {
    const project = fixture({
      agent:
        "export default async (input, ctx) => { ctx.emit({type:'policy.violation',rule:'no-exfil'}); return {value:input}; };",
    });
    expect(ci(project).value.exitCode).toBe(6);
  });
  it("returns 1 for an actual failed agent", () => {
    const project = fixture({
      agent: "export default async () => { throw new Error('deliberate fixture failure'); };",
    });
    expect(ci(project).value.exitCode).toBe(1);
  });
  it("returns 3 for a real unexpected timeout", () => {
    const project = fixture({
      agent: "export default async () => new Promise(() => {});",
      config: `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] }, runtime: { timeoutMs: 300 } };`,
    });
    expect(ci(project).value.exitCode).toBe(3);
  });
  it("returns 5 when artifactRoot is a file, without touching it", () => {
    const project = fixture();
    mkdirSync(join(project, ".canary"));
    const target = join(project, ".canary", "artifacts");
    writeFileSync(target, "preserve");
    expect(ci(project).value.exitCode).toBe(5);
    expect(readFileSync(target, "utf8")).toBe("preserve");
  });
  it("redirects and redacts config console logs without corrupting JSON stdout", () => {
    const project = fixture({
      config: `console.log('api_key=DO_NOT_LEAK'); export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] } };`,
    });
    const child = ci(project);
    expect(child.value.exitCode).toBe(0);
    expect(child.stdout + child.stderr).not.toContain("DO_NOT_LEAK");
  });
  it("paths and doctor share root resolution, version uses the executable package", () => {
    const project = fixture();
    const paths = pathsSnapshotSchema.parse(JSON.parse(invoke(project, ["paths", "--json"]).stdout));
    const doctor = doctorSnapshotSchema.parse(JSON.parse(invoke(project, ["doctor", "--json"]).stdout));
    for (const field of ["invocationRoot", "projectRoot", "installRoot", "artifactRoot", "configFile"] as const)
      expect(paths[field]).toBe(doctor[field]);
    const version = versionSnapshotSchema.parse(JSON.parse(invoke(project, ["version", "--json"]).stdout));
    const plain = invoke(project, ["version", "--plain"]);
    expect(plain.status).toBe(0);
    expect(plain.stdout.trim()).toBe(version.canaryVersion);
    expect(invoke(project, ["version", "--json", "--plain"]).status).toBe(2);
  }, 15000);
});
