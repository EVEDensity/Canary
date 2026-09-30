import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { automaticProjectConfig } from "../src/auto-project.js";
import { canonicalPath, resolveProjectContext } from "../src/home.js";
import { runCommandDetailed } from "../src/index.js";
import { parseCiOptions } from "../src/ci.js";
import { verifyArtifacts } from "@canary/trace";

const fixture = (pkg: unknown) => {
  const root = mkdtempSync(join(tmpdir(), "canary-auto-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  return canonicalPath(root);
};
describe("automatic project verification", () => {
  it("uses finite CI scripts, avoids duplicate tests and does not write a config", () => {
    const root = fixture({
      scripts: {
        typecheck: "node --version",
        lint: "node --version",
        "format:check": "node --version",
        "test:ci": "node --version",
        test: "vitest --watch",
        build: "node --version",
        dev: "vite",
        deploy: "deploy",
      },
    });
    const plan = automaticProjectConfig(root);
    expect(plan.checks.map((check) => check.id)).toEqual([
      "node.build",
      "node.typecheck",
      "node.lint",
      "node.format.check",
      "node.test.ci",
    ]);
    expect(existsSync(join(root, "canary.project.json"))).toBe(false);
  });
  it("locates projects from nested directories and honors explicit configuration", () => {
    const root = fixture({ scripts: { test: "node --version" } }),
      nested = join(root, "src", "nested");
    mkdirSync(nested, { recursive: true });
    expect(resolveProjectContext({ cwd: nested }).projectRoot).toBe(root);
    expect(resolveProjectContext({ cwd: nested, configPath: "custom.json" }).configFile).toBe(
      join(nested, "custom.json"),
    );
    expect(parseCiOptions(["--ci", "--project", root]).cwd).toBe(root);
  });
  it("selects declared workspace members rather than unrelated examples", () => {
    const root = fixture({ workspaces: ["packages/*", "!packages/excluded"] });
    for (const dir of ["packages/one", "packages/excluded", "examples/unrelated"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify({ scripts: { test: "node --version" } }));
    }
    const plan = automaticProjectConfig(root);
    expect(plan.checks).toHaveLength(1);
    expect(plan.checks[0]?.cwd).toBe(join("packages", "one"));
    const nested = join(root, "packages", "one");
    expect(resolveProjectContext({ cwd: nested }).projectRoot).toBe(root);
  });
  it("detects standard language plans and rejects projects without checks", () => {
    const root = fixture({});
    expect(() => automaticProjectConfig(root)).toThrow();
    writeFileSync(join(root, "go.mod"), "module example.com/fixture\n");
    expect(automaticProjectConfig(root).checks.map((check) => check.id)).toEqual(["go.vet", "go.test"]);
    writeFileSync(join(root, "Cargo.toml"), "[package]\nname='fixture'\n");
    expect(automaticProjectConfig(root).checks).toHaveLength(4);
  });
  it("reads only pnpm package declarations, excluding unrelated YAML lists", () => {
    const root = fixture({});
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\nonlyBuiltDependencies:\n  - examples/unrelated\n",
    );
    for (const dir of ["packages/one", "examples/unrelated"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify({ scripts: { test: "node --version" } }));
    }
    expect(automaticProjectConfig(root).checks.map((check) => check.cwd)).toEqual([join("packages", "one")]);
  });
  it("executes real npm lifecycles in CI mode from a subdirectory and seals the evidence", async () => {
    const root = fixture({
      scripts: { pretest: "node task.cjs pre", test: "node task.cjs test", posttest: "node task.cjs post" },
    });
    writeFileSync(
      join(root, "task.cjs"),
      "const fs=require('node:fs');if(process.env.CI!=='true')process.exit(1);fs.appendFileSync('executed.txt',process.argv[2]+'\\n');console.log('actual test passed');",
    );
    const nested = join(root, "src");
    mkdirSync(nested);
    const result = await runCommandDetailed({ cwd: nested, ci: true });
    expect(result.exitCode).toBe(0);
    expect(result.snapshot.checks?.[0]?.status).toBe("passed");
    expect(readFileSync(join(root, "executed.txt"), "utf8")).toBe("pre\ntest\npost\n");
    expect(verifyArtifacts(resolve(result.artifactPath, "..")).status).toBe("verified");
    expect(existsSync(join(root, "canary.config.ts"))).toBe(false);
  }, 30_000);
  it("retains a real failing test instead of treating discovery as success", async () => {
    const root = fixture({ scripts: { test: "node fail.cjs" } });
    writeFileSync(join(root, "fail.cjs"), "console.error('AUTO_REAL_FAILURE');process.exit(1);");
    const result = await runCommandDetailed({ cwd: root, ci: true });
    expect(result.exitCode).toBe(1);
    expect(result.snapshot.checks?.[0]?.stderr).toContain("AUTO_REAL_FAILURE");
    expect(verifyArtifacts(resolve(result.artifactPath, "..")).status).toBe("verified");
  }, 30_000);
});
