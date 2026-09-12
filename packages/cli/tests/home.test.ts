import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstalledHome, resolveCanaryProjectRoot, resolveConfigFile } from "../src/home.js";

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
});
