import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installationMetadata,
  readInstalledHome,
  resolveCanaryProjectRoot,
  resolveConfigFile,
  resolveProjectContext,
} from "../src/home.js";

const temporaryRoots: string[] = [];
function temporaryRoot(prefix: string): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}

const previousHome = process.env.CANARY_HOME;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.CANARY_HOME;
  else process.env.CANARY_HOME = previousHome;
});

describe("global canary home resolution", () => {
  it("walks up to find canary.config.ts before using CANARY_HOME", () => {
    const repo = temporaryRoot("canary-home-");
    const nested = join(repo, "apps", "demo");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(repo, "canary.config.ts"), "export default {};", "utf8");
    expect(resolveCanaryProjectRoot(nested)).toBe(repo);
    expect(resolveConfigFile({ cwd: nested })).toBe(join(repo, "canary.config.ts"));
  });

  it("never uses CANARY_HOME as the project when cwd has no local config", () => {
    const repo = temporaryRoot("canary-installed-");
    writeFileSync(join(repo, "canary.config.ts"), "export default {};", "utf8");
    const outside = temporaryRoot("canary-outside-");
    process.env.CANARY_HOME = repo;
    expect(resolveCanaryProjectRoot(outside)).toBe(outside);
    expect(resolveProjectContext({ cwd: outside }).source).toBe("cwd");
    expect(resolveProjectContext({ cwd: outside }).installRoot).toBe(repo);
    expect(readInstalledHome()).toBe(repo);
  });

  it("does not mix a local project with CANARY_HOME artifacts", () => {
    const installed = temporaryRoot("canary-installed-");
    writeFileSync(join(installed, "canary.config.ts"), "export default {};", "utf8");
    const local = temporaryRoot("canary 项目 ");
    writeFileSync(join(local, "canary.config.ts"), "export default {};", "utf8");
    process.env.CANARY_HOME = installed;
    const nested = join(local, "nested dir");
    mkdirSync(nested, { recursive: true });
    const context = resolveProjectContext({ cwd: nested });
    expect(context.source).toBe("walk");
    expect(context.projectRoot).toBe(local);
    expect(context.artifactRoot).toBe(join(local, ".canary", "artifacts"));
    expect(context.installRoot).toBe(installed);
    expect(context.invocationRoot).toBe(nested);
  });

  it("resolves relative --config from the invocation directory", () => {
    const invocation = temporaryRoot("canary-invoke-");
    const project = temporaryRoot("canary-target-");
    writeFileSync(join(project, "canary.config.ts"), "export default {};", "utf8");
    const relative = join("..", project.split(/[/\\]/).pop()!, "canary.config.ts");
    const context = resolveProjectContext({ cwd: invocation, configPath: relative });
    expect(context.source).toBe("config");
    expect(context.projectRoot).toBe(project);
    expect(context.artifactRoot).toBe(join(project, ".canary", "artifacts"));
    expect(context.configFile).toBe(join(project, "canary.config.ts"));
  });
});

describe("installation and path aliases", () => {
  it("validates missing, corrupt, relative and valid metadata without executing it", () => {
    const root = temporaryRoot("canary metadata ");
    const file = join(root, "home.json");
    expect(installationMetadata(file).status).toBe("missing");
    for (const contents of [
      "{broken",
      "null",
      "[]",
      '{"root":"relative"}',
      JSON.stringify({ root, binDir: "relative" }),
    ]) {
      writeFileSync(file, contents);
      expect(installationMetadata(file).status).toBe("invalid");
    }
    writeFileSync(file, JSON.stringify({ root, binDir: join(root, "bin") }));
    expect(installationMetadata(file)).toMatchObject({ status: "valid", value: { root } });
  });
  it("canonicalizes project aliases but retains the user's invocation path", () => {
    const root = temporaryRoot("canary aliases ");
    const project = join(root, "real project");
    mkdirSync(project);
    writeFileSync(join(project, "canary.config.ts"), "export default {};");
    const alias = join(root, "alias project");
    symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    const context = resolveProjectContext({ cwd: alias });
    expect(context.invocationRoot).toBe(alias);
    expect(context.projectRoot).toBe(project);
    expect(context.artifactRoot).toBe(join(project, ".canary", "artifacts"));
  });
});
