import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectChecksConfigSchema, type CoverageSummary } from "@canary/core";
import { analyzeChangedFile, evaluateBehaviorContracts } from "../src/change-verification.js";

it("retains denominators and unknown mapping without converting execution into behavior evidence", () => {
  const source = "export function choose(x){return x ? 1 : 0;}\n",
    hash = createHash("sha256").update(source).digest("hex");
  const metric = { covered: 1, total: 2, pct: 50 };
  const coverage: CoverageSummary = {
    runId: "run_test",
    sourceHash: hash,
    status: "final",
    lines: metric,
    functions: metric,
    statements: metric,
    branches: metric,
    featureChains: [],
    files: [
      {
        filePath: "module.mjs",
        sourceHash: hash,
        status: "final",
        quality: { mappingMode: "ast", precision: "exact", diagnostics: [] },
        lines: metric,
        functions: metric,
        statements: metric,
        branches: metric,
        executableLineNumbers: [1],
        coveredLineNumbers: [1],
        uncoveredLocations: [],
        coveredFunctionIds: ["f"],
        coveredBranchIds: ["yes"],
      },
    ],
  };
  const location = (id: string) => ({
    id,
    filePath: "module.mjs",
    start: { line: 1, column: 0 },
    end: { line: 1, column: 40 },
  });
  const manifest = {
    sourceHash: hash,
    rootDir: ".",
    include: [],
    exclude: [],
    features: [],
    files: [
      {
        filePath: "module.mjs",
        sourceHash: hash,
        executableLines: [1],
        statementLocations: [],
        functionLocations: [{ ...location("f"), kind: "function" as const }],
        branchLocations: [
          { ...location("yes"), kind: "branch" as const },
          { ...location("no"), kind: "branch" as const },
        ],
        quality: { mappingMode: "ast" as const, precision: "exact" as const, diagnostics: [] },
      },
    ],
  };
  const result = analyzeChangedFile({ path: "module.mjs", changedLines: [1], source, root: ".", coverage, manifest });
  expect(result.execution.lines).toEqual({ total: 1, covered: 1 });
  expect(result.execution.branches).toEqual({ total: 2, covered: 1 });
  expect(result.interpretation).toContain("does not establish");
  coverage.files![0]!.quality!.precision = "approximate";
  expect(
    analyzeChangedFile({ path: "module.mjs", changedLines: [1], source, root: ".", coverage, manifest }).execution
      .status,
  ).toBe("unknown");
  const config = projectChecksConfigSchema.parse({
    kind: "canary.project",
    version: 1,
    checks: [{ id: "test", type: "command", command: "node" }],
    contracts: [{ id: "behavior", paths: ["module.mjs"], checkId: "test", assertionId: "actual" }],
  });
  const check = { id: "test", status: "passed", stdout: "all tests pass", outputTruncated: false } as Parameters<
    typeof evaluateBehaviorContracts
  >[1][number];
  expect(evaluateBehaviorContracts(config, [check])[0]?.status).toBe("unknown");
  check.stdout = JSON.stringify({
    kind: "canary.assertions",
    method: "deterministic",
    v: 1,
    results: [{ id: "actual", passed: true }],
  });
  expect(evaluateBehaviorContracts(config, [check])[0]?.status).toBe("verified");
});
it("analyzes sealed historical commits and gates only explicitly required assertions", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r20-"))),
    cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", join(root, "canary.project.json")], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    return { code: result.status, data: JSON.parse(result.stdout || "{}") };
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "package.json"), '{"name":"changes-fixture"}');
    writeFileSync(join(root, "module.mjs"), "export const value=1;\n");
    const config = {
      kind: "canary.project",
      version: 1,
      checks: [
        {
          id: "test",
          type: "command",
          command: "node",
          args: ["-e", "console.log('passing without behavior report')"],
        },
      ],
      contracts: [
        { id: "value", paths: ["module.mjs"], checkId: "test", assertionId: "value-correct", required: false },
      ],
    };
    writeFileSync(join(root, "canary.project.json"), JSON.stringify(config));
    git("add", ".");
    git("commit", "-qm", "Baseline");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(root, "module.mjs"), "export const value=2;\n");
    git("add", ".");
    git("commit", "-qm", "Change without assertion");
    const run = call("run", "--ci");
    expect(run.code).toBe(0);
    writeFileSync(join(root, "module.mjs"), "later uncommitted edits\n");
    const report = call("change-verify", run.data.runId, "--base", base).data;
    expect(report.files.find((file: { path: string }) => file.path === "module.mjs")).toMatchObject({
      changedLines: [1],
      behavior: "unknown",
      execution: { status: "unknown" },
    });
    config.contracts[0]!.required = true;
    writeFileSync(join(root, "canary.project.json"), JSON.stringify(config));
    const gated = call("run", "--ci");
    expect(gated.code).toBe(6);
    config.checks[0]!.args = [
      "-e",
      "console.log(JSON.stringify({kind:'canary.assertions',v:1,method:'deterministic',results:[{id:'value-correct',passed:true}]}))",
    ];
    writeFileSync(join(root, "canary.project.json"), JSON.stringify(config));
    expect(call("run", "--ci").code).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90000);
