import { afterAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { doctorSnapshotSchema, pathsSnapshotSchema } from "@canary/core";
import { diagnosticSnapshot } from "../src/diagnostics.js";

const base = realpathSync.native(mkdtempSync(join(tmpdir(), "canary R2 isolated user ")));
const home = join(base, "non default home");
const installed = join(base, "independent install");
mkdirSync(home, { recursive: true });
mkdirSync(join(installed, "packages", "cli"), { recursive: true });
writeFileSync(
  join(installed, "canary.config.ts"),
  "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] } };",
);
writeFileSync(join(installed, "agent.mjs"), "export default async input => ({ value: input });");
writeFileSync(
  join(installed, "cases.ts"),
  "export default [{ id: 'smoke', input: 'ok', assertions: [{ type: 'output.exists' }] }];",
);

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
      `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] } };`,
  );
  return project;
}

function invoke(cwd: string, args: string[], overrides: Record<string, string> = {}) {
  const child = spawnSync(process.execPath, ["--import", loader, cli, ...args], {
    cwd,
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  return child;
}

function doctor(cwd: string, args: string[] = [], overrides: Record<string, string> = {}) {
  const child = invoke(cwd, ["doctor", "--json", ...args], overrides);
  const value = doctorSnapshotSchema.parse(JSON.parse(child.stdout));
  expect(child.status, child.stderr).toBe(value.exitCode);
  expect(value.issues.every((issue) => issue.suggestion.length > 0)).toBe(true);
  expect(value.problems).toEqual(value.issues.map((issue) => issue.message));
  expect(value.suggestions).toEqual(
    value.issues.length ? value.issues.map((issue) => issue.suggestion) : ["No action required."],
  );
  expect(value.localFirst).toBe(true);
  expect(value.exporter).toEqual({ enabled: false, default: "disabled" });
  return { ...child, value };
}

describe("R2 doctor fixtures", () => {
  it("returns 2 for a missing config without creating .canary", async () => {
    const outside = join(base, "unconfigured project");
    mkdirSync(outside);
    const { value, status } = doctor(outside);
    expect(status).toBe(2);
    expect(value.issues.some((issue) => issue.code === "CONFIG_NOT_FOUND")).toBe(true);
    expect(existsSync(join(outside, ".canary"))).toBe(false);
    expect((await diagnosticSnapshot(outside)).exitCode).toBe(2);
  });

  it("returns 2 for a schema-invalid config without printing secrets", () => {
    const project = fixture({
      config: `console.log('api_key=DO_NOT_LEAK'); export default { agent: { adapter: 'function' } };`,
    });
    const { value, stdout, stderr, status } = doctor(project);
    expect(status).toBe(2);
    expect(value.issues.some((issue) => issue.code === "CONFIG_INVALID")).toBe(true);
    expect(stdout + stderr).not.toContain("DO_NOT_LEAK");
  });

  it("returns 2 when the trusted config module throws", () => {
    const project = fixture({
      config: "throw new Error('secret=DO_NOT_LEAK'); export default {};",
    });
    const { value, stdout, stderr, status } = doctor(project);
    expect(status).toBe(2);
    expect(value.issues.some((issue) => issue.code === "CONFIG_INVALID")).toBe(true);
    expect(stdout + stderr).not.toContain("DO_NOT_LEAK");
  });

  it("returns 2 when the function agent entry is missing", () => {
    const project = fixture({
      config:
        "export default { agent: { adapter: 'function', entry: './missing.mjs' }, cases: './cases.ts', coverage: { include: ['*.mjs'] } };",
    });
    const { value, status } = doctor(project);
    expect(status).toBe(2);
    expect(value.issues.some((issue) => issue.code === "AGENT_ENTRY_MISSING")).toBe(true);
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
    const corrupt = doctor(project, [], overrides).value;
    expect(corrupt.metadataStatus).toBe("invalid");
    expect(corrupt.issues.some((issue) => issue.code === "INSTALL_METADATA_INVALID")).toBe(true);
    expect(readFileSync(metadata, "utf8")).toBe("{broken");
    writeFileSync(metadata, JSON.stringify({ root: installed, binDir: join(isolatedHome, "missing bin") }));
    const missing = doctor(project, [], overrides).value;
    expect(missing.issues.some((issue) => issue.code === "LAUNCHER_MISSING")).toBe(true);
    expect(readFileSync(metadata, "utf8")).toContain("missing bin");
  }, 20000);

  it("returns 5 when artifactRoot is a file and leaves the placeholder intact", () => {
    const project = fixture();
    mkdirSync(join(project, ".canary"));
    const target = join(project, ".canary", "artifacts");
    writeFileSync(target, "preserve");
    const { value, status } = doctor(project);
    expect(status).toBe(5);
    expect(value.issues.some((issue) => issue.code === "ARTIFACT_UNWRITABLE")).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("preserve");
  });

  it("warns when --config selects the install root from an outside invocation", () => {
    const outside = join(base, "caller outside install");
    mkdirSync(outside);
    const { value, status } = doctor(outside, ["--config", join(installed, "canary.config.ts")]);
    expect(status).toBe(0);
    expect(value.projectRoot).toBe(installed);
    expect(value.installRoot).toBe(installed);
    expect(value.invocationRoot).toBe(outside);
    expect(value.issues.some((issue) => issue.code === "PROJECT_INSTALL_CONFLICT")).toBe(true);
  });

  it("returns 0 for a valid project on the frozen v1 doctor schema", () => {
    const project = fixture();
    const { value, status } = doctor(project);
    expect(status).toBe(0);
    expect(value.v).toBe(1);
    expect(value.kind).toBe("canary.doctor");
    expect(value.projectRoot).toBe(project);
    expect(value.installRoot).toBe(installed);
    expect(value.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("does not treat Canary self-test inside the install checkout as a root conflict", () => {
    const { value, status } = doctor(installed);
    expect(status).toBe(0);
    expect(value.projectRoot).toBe(installed);
    expect(value.installRoot).toBe(installed);
    expect(value.invocationRoot).toBe(installed);
    expect(value.issues.some((issue) => issue.code === "PROJECT_INSTALL_CONFLICT")).toBe(false);
  });

  it("warns about whitespace, a non-default user directory, and junction aliases", async () => {
    const project = fixture();
    const alias = join(base, `alias space ${count}`);
    symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    const { value } = doctor(alias);
    expect(value.issues.some((issue) => issue.code === "PATH_SPACES")).toBe(true);
    expect(value.issues.some((issue) => issue.code === "NON_DEFAULT_USER_DIR")).toBe(true);
    // POSIX resolves a child's cwd to its physical directory; Windows retains the junction.
    const invocation = process.platform === "win32" ? alias : project;
    expect(value.issues.some((issue) => issue.code === "PATH_ALIAS")).toBe(invocation === alias);
    expect(value.invocationRoot).toBe(invocation);
    expect(value.projectRoot).toBe(project);
    // The diagnostics API still detects an explicitly supplied alias on either platform.
    const aliased = await diagnosticSnapshot(alias, join(alias, "canary.config.ts"));
    expect(aliased.issues.some((issue) => issue.code === "PATH_ALIAS")).toBe(true);
    expect(aliased.invocationRoot).toBe(alias);
    expect(aliased.projectRoot).toBe(project);
  });

  it("lets paths locate a throwing config without executing it, while doctor reports CONFIG_INVALID", () => {
    const project = fixture({ config: "throw new Error('MUST NOT LOAD FOR PATHS'); export default {};" });
    const child = invoke(project, ["paths", "--json"]);
    expect(child.status, child.stderr).toBe(0);
    const paths = pathsSnapshotSchema.parse(JSON.parse(child.stdout));
    expect(paths.projectRoot).toBe(project);
    expect(paths.kind).toBe("canary.paths");
    expect(doctor(project).value.issues.some((issue) => issue.code === "CONFIG_INVALID")).toBe(true);
  });
});
