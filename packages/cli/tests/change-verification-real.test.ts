import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { changeVerificationV2Schema, isChangeVerificationBound, type RunSnapshot } from "@canary/core";
import { FileArtifactRepository, stableHash } from "@canary/trace";

function finishFixture(retained: { root: string; baseline: string; runIds: string[] }) {
  const parent = realpathSync.native(tmpdir()),
    within = relative(parent, retained.root);
  if (
    !isAbsolute(retained.root) ||
    isAbsolute(within) ||
    within === ".." ||
    within.startsWith("../") ||
    within.startsWith("..\\") ||
    !within.startsWith("canary-r26-real-")
  )
    throw new Error("Unsafe real fixture cleanup root");
  if (process.env.CANARY_KEEP_R26_FIXTURE === "1")
    console.log(JSON.stringify({ kind: "canary.r26-real-fixture", ...retained }));
  else rmSync(retained.root, { recursive: true, force: true });
}

it("retains real historical branch gaps, combines independent checks and keeps unsupported evidence unknown", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r26-real-")));
  const retained = { root, baseline: "", runIds: [] as string[] };
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", join(root, "canary.project.json")], {
      cwd: root,
      encoding: "utf8",
      timeout: 75_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };
  const padding = `// ${"historical source padding ".repeat(140)}\n`;
  const choose = (fallback: number) =>
    `export default function choose(input) {\n  return input ? 1 : ${fallback};\n}\n${padding}`;
  const chosenPath = join(root, "src", "choose.mjs");
  const project = {
    kind: "canary.project",
    version: 1,
    budgetMs: 120_000,
    checks: [
      { id: "true-path", type: "agent", config: "true.config.json", timeoutMs: 45_000 },
      {
        id: "declared-behavior",
        type: "command",
        command: "node",
        args: [
          "--input-type=module",
          "-e",
          "import choose from './src/choose.mjs';console.log(JSON.stringify({v:1,kind:'canary.assertions',method:'deterministic',results:[{id:'true-behavior',passed:choose(true)===1}]}))",
        ],
      },
    ],
    contracts: [
      {
        id: "choose-behavior",
        paths: ["src/**/choose.mjs"],
        checkId: "declared-behavior",
        assertionId: "true-behavior",
        required: true,
      },
    ],
  };
  const artifactRoot = join(root, ".canary", "artifacts");
  const repository = new FileArtifactRepository(artifactRoot);
  const reportFor = (runId: string) => {
    const report = changeVerificationV2Schema.parse(read(join(artifactRoot, runId, "change-verification.json")));
    const run = read<RunSnapshot>(join(artifactRoot, runId, "run.json"));
    const proof = read(join(artifactRoot, runId, "execution-source.json"));
    expect(repository.verify(runId).status).toBe("verified");
    expect(isChangeVerificationBound(report, run, proof, stableHash(proof))).toBe(true);
    return { report, run };
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, ".gitattributes"), "src/choose.mjs -diff\n");
    writeFileSync(join(root, "package.json"), '{"name":"canary-real-change-fixture","private":true,"type":"module"}\n');
    writeFileSync(chosenPath, choose(-1));
    writeFileSync(join(root, "src", "unobserved.mjs"), "export const unobserved = 0;\n");
    writeFileSync(join(root, "src", "deleted.mjs"), "export const deleted = true;\n");
    writeFileSync(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    for (const [name, input, expected] of [
      ["true", true, 1],
      ["false", false, 0],
    ] as const) {
      writeFileSync(
        join(root, `${name}.case.mjs`),
        `export default {id:${JSON.stringify(name)},input:${input},assertions:[{type:'output.predicate',predicate:value=>value===${expected}}]};\n`,
      );
      writeFileSync(
        join(root, `${name}.config.json`),
        JSON.stringify({
          agent: { adapter: "function", entry: "./src/choose.mjs" },
          cases: `./${name}.case.mjs`,
          coverage: { include: ["src/**/*.mjs"] },
          reporters: ["json"],
          web: { enabled: false },
        }),
      );
    }
    writeFileSync(join(root, "canary.project.json"), JSON.stringify(project));
    git("add", ".");
    git("commit", "-qm", "Baseline with an unverified fallback");
    const baseline = git("rev-parse", "HEAD");
    retained.baseline = baseline;
    writeFileSync(chosenPath, choose(0));
    writeFileSync(join(root, "src", "unobserved.mjs"), "export const unobserved = 1;\n");
    unlinkSync(join(root, "src", "deleted.mjs"));
    writeFileSync(join(root, "binary.dat"), Buffer.from([0, 2, 3]));
    git("add", ".");
    git("commit", "-qm", "Change the fallback and an unobserved module");
    const firstCommit = git("rev-parse", "HEAD");
    const firstRun = call("run", "--ci", "--base", baseline).runId as string;
    retained.runIds.push(firstRun);
    const first = reportFor(firstRun);
    expect(first.report).toMatchObject({
      baseline,
      commit: firstCommit,
      assessment: "analyzed",
      checks: { planned: 2, executed: 2, passed: 2, failed: 0, missing: 0 },
    });
    const chosen = first.report.files.find((file) => file.path === "src/choose.mjs")!;
    expect(chosen.changedLines).toEqual([2]);
    expect(chosen.execution.branches).toEqual({ total: 2, covered: 1 });
    expect(chosen.uncovered.branches).toHaveLength(1);
    expect(chosen.behavior).toBe("declared-assertions-verified");
    expect(first.report.files.find((file) => file.path === "src/unobserved.mjs")).toMatchObject({
      behavior: "unknown",
      execution: { status: "unknown", branches: { total: null, covered: null } },
    });
    expect(first.report.files.find((file) => file.path === "src/deleted.mjs")).toMatchObject({
      status: "deleted",
      behavior: "unknown",
      execution: { status: "unknown" },
    });
    expect(first.report.files.find((file) => file.path === "binary.dat")).toMatchObject({
      status: "unsupported",
      behavior: "unknown",
      execution: { status: "unknown" },
    });
    const child = first.run.checks!.find((check) => check.id === "true-path")!.childRun!;
    const coverage = read<{ files: Array<{ filePath: string; sourceText?: string }> }>(
      join(artifactRoot, child.runId, "coverage.json"),
    );
    expect(
      coverage.files.find((file) => file.filePath.replaceAll("\\", "/").endsWith("src/choose.mjs"))?.sourceText?.length,
    ).toBeGreaterThan(2048);

    writeFileSync(chosenPath, choose(999));
    const historical = changeVerificationV2Schema.parse(call("change-verify", firstRun, "--base", baseline));
    expect(historical.commit).toBe(firstCommit);
    expect(historical.files.find((file) => file.path === "src/choose.mjs")?.execution.branches).toEqual({
      total: 2,
      covered: 1,
    });
    expect(historical.files.find((file) => file.path === "src/choose.mjs")?.changedLines).toEqual([2]);
    expect(repository.verify(firstRun).status).toBe("verified");

    writeFileSync(chosenPath, choose(0));
    project.checks.unshift({ id: "false-path", type: "agent", config: "false.config.json", timeoutMs: 45_000 });
    writeFileSync(join(root, "canary.project.json"), JSON.stringify(project));
    git("add", ".");
    git("commit", "-qm", "Verify the second execution path independently");
    const secondRun = call("run", "--ci", "--base", baseline).runId as string;
    retained.runIds.push(secondRun);
    const second = reportFor(secondRun);
    const complete = second.report.files.find((file) => file.path === "src/choose.mjs")!;
    expect(complete.execution.branches).toEqual({ total: 2, covered: 2 });
    expect(complete.execution.functions).toEqual({ total: 1, covered: 1 });
    expect(complete.uncovered.branches).toEqual([]);
    expect(complete.behavior).toBe("declared-assertions-verified");
    expect(second.report.summary.execution.branches).toMatchObject({ total: 2, covered: 2 });
    expect(second.report.files.find((file) => file.path === "src/unobserved.mjs")?.execution.status).toBe("unknown");
    expect(second.report.summary.behavior).toEqual({ verified: 1, failed: 0, unknown: second.report.files.length - 1 });
    expect(second.report.checks).toMatchObject({ planned: 3, executed: 3, passed: 3, failed: 0, missing: 0 });
  } finally {
    finishFixture(retained);
  }
}, 180_000);
