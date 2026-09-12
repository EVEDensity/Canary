import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstalledHome, resolveCanaryProjectRoot, resolveConfigFile, resolveProjectContext } from "../src/home.js";

const previousHome = process.env.CANARY_HOME;

afterEach(() => {
  if (previousHome === undefined) delete process.env.CANARY_HOME;
  else process.env.CANARY_HOME = previousHome;
});

describe("global canary home resolution", () => {
  it("walks up to find canary.config.ts before using CANARY_HOME", () => {
    const repo = mkdtempSync(join(tmpdir(), "canary-home-"));
    const nested = join(repo, "apps", "demo");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(repo, "canary.config.ts"), "export default {};", "utf8");
    expect(resolveCanaryProjectRoot(nested)).toBe(repo);
    expect(resolveConfigFile({ cwd: nested })).toBe(join(repo, "canary.config.ts"));
  });

  it("uses CANARY_HOME when cwd has no local config", () => {
    const repo = mkdtempSync(join(tmpdir(), "canary-installed-"));
    writeFileSync(join(repo, "canary.config.ts"), "export default {};", "utf8");
    const outside = mkdtempSync(join(tmpdir(), "canary-outside-"));
    process.env.CANARY_HOME = repo;
    expect(resolveCanaryProjectRoot(outside)).toBe(repo);
    expect(readInstalledHome()).toBe(repo);
  });

  it("does not mix a local project with CANARY_HOME artifacts", () => {
    const installed = mkdtempSync(join(tmpdir(), "canary-installed-"));
    writeFileSync(join(installed, "canary.config.ts"), "export default {};", "utf8");
    const local = mkdtempSync(join(tmpdir(), "canary 项目 "));
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
    const invocation = mkdtempSync(join(tmpdir(), "canary-invoke-"));
    const project = mkdtempSync(join(tmpdir(), "canary-target-"));
    writeFileSync(join(project, "canary.config.ts"), "export default {};", "utf8");
    const relative = join("..", project.split(/[/\\]/).pop()!, "canary.config.ts");
    const context = resolveProjectContext({ cwd: invocation, configPath: relative });
    expect(context.source).toBe("config");
    expect(context.projectRoot).toBe(project);
    expect(context.artifactRoot).toBe(join(project, ".canary", "artifacts"));
    expect(context.configFile).toBe(join(project, "canary.config.ts"));
  });
});
