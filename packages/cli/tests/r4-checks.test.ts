import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { projectChecksConfigSchema } from "@canary/core";
import { verifyArtifacts, planRetention, applyRetention } from "@canary/trace";
import { pidAlive } from "@canary/isolation";
import { executeCi } from "../src/ci.js";
import { runCommandDetailed } from "../src/index.js";
import { discoverProject } from "../src/discovery.js";
import { diagnosticSnapshot } from "../src/diagnostics.js";
import { assessDockerState, ok } from "../src/check-executor.js";

const base = realpathSync(mkdtempSync(join(tmpdir(), "canary-r4-tests-")));
let count = 0;
afterAll(() => rmSync(base, { recursive: true, force: true }));
function fixture(checks: unknown[], extra = {}) {
  const root = join(base, `project ${++count}`);
  mkdirSync(root);
  const file = join(root, "checks.json");
  writeFileSync(file, JSON.stringify({ kind: "canary.project", version: 1, checks, ...extra }));
  return { root, file, run: () => executeCi(["--ci", "--config", file], runCommandDetailed) };
}
const node = (id: string, code = "console.log('ok')", extra = {}) => ({
  id,
  type: "command",
  command: "node",
  args: ["-e", code],
  ...extra,
});
const read = (artifact: string | null) => JSON.parse(readFileSync(artifact!, "utf8"));

describe("R4 project checks", () => {
  it("runs package scripts from a normal path without Windows extended-prefix crashes", async () => {
    const f = fixture([{ id: "package-script", type: "command", command: "node", args: ["--run", "smoke"] }]);
    writeFileSync(join(f.root, "package.json"), JSON.stringify({ scripts: { smoke: "node smoke.mjs" } }));
    writeFileSync(join(f.root, "smoke.mjs"), "console.log('package-script-ok');");
    const result = await f.run();
    expect(result.exitCode).toBe(0);
    expect(read(result.artifactPath).checks[0].stdout).toContain("package-script-ok");
    expect(verifyArtifacts(resolve(result.artifactPath!, "..")).status).toBe("verified");
  });

  it("cancels a hanging agent config import and rejects recursive project checks", async () => {
    const f = fixture([{ id: "hang", type: "agent", config: "agent.config.mjs", timeoutMs: 2500 }]);
    writeFileSync(
      join(f.root, "agent.config.mjs"),
      "console.log('config-loaded'); await new Promise(()=>setInterval(()=>{},1000)); export default {};",
    );
    const hung = await f.run();
    expect(hung.exitCode).toBe(3);
    expect(read(hung.artifactPath).checks[0].stderr).toContain("config-loaded");
    const recursive = fixture([{ id: "recursive", type: "agent", config: "checks.json" }]);
    expect((await recursive.run()).exitCode).toBe(2);
  }, 10_000);
  it("classifies invalid discovery markers as configuration errors", async () => {
    const f = fixture([node("test")]);
    writeFileSync(join(f.root, "package.json"), "{");
    expect((await f.run()).exitCode).toBe(2);
  });
  it("classifies Docker running/exited, mismatched state and unavailable daemon without a fake runtime pass", () => {
    expect(assessDockerState({ ...ok(), processExit: 0, stdout: "running\n" }, "running").exitCode).toBe(0);
    expect(assessDockerState({ ...ok(), processExit: 0, stdout: "exited\n" }, "exited").exitCode).toBe(0);
    expect(assessDockerState({ ...ok(), processExit: 0, stdout: "exited\n" }, "running").exitCode).toBe(1);
    expect(assessDockerState({ ...ok(), processExit: 1, stderr: "daemon unavailable" }, "running").exitCode).toBe(4);
  });
  it("rejects empty, optional-only, duplicate and forward-dependent plans", () => {
    for (const checks of [
      [],
      [node("x", "", { required: false })],
      [node("x"), node("x")],
      [node("x", "", { dependsOn: ["y"] }), node("y")],
    ])
      expect(projectChecksConfigSchema.safeParse({ kind: "canary.project", version: 1, checks }).success).toBe(false);
  });
  it("discovers Node/Python as declarations, never executes scripts or passes an unknown language", () => {
    const f = fixture([node("test")]);
    expect(discoverProject(f.root).status).toBe("blocked");
    writeFileSync(join(f.root, "package.json"), JSON.stringify({ scripts: { test: "exit 42", deploy: "never" } }));
    writeFileSync(join(f.root, "pyproject.toml"), "[project]\nname='fixture'\n");
    const found = discoverProject(f.root);
    expect(found.status).toBe("declared");
    expect(found.automaticExecution).toBe(false);
    expect(found.languages.map((item) => item.language)).toEqual(["node", "python"]);
    expect(found.languages[0]?.suggestions).toEqual(["test"]);
  });
  it("runs explicit commands and filesystem expectations with sealed JSON/JUnit evidence", async () => {
    const f = fixture([
      node("command"),
      { id: "file", type: "filesystem", path: "checks.json", dependsOn: ["command"] },
    ]);
    const ci = await f.run();
    expect(ci.exitCode).toBe(0);
    expect(ci.capabilities.scope).toBe("project-checks");
    expect(ci.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    const dir = resolve(ci.artifactPath!, "..");
    expect(verifyArtifacts(dir).status).toBe("verified");
    expect(readFileSync(join(dir, "report.xml"), "utf8")).toContain('tests="2" failures="0" errors="0"');
    expect(read(ci.artifactPath).checks[0].processExit).toBe(0);
    expect(
      read(join(dir, "source-inventory.json")).files.some((file: { path: string }) => file.path === "checks.json"),
    ).toBe(true);
  });
  it("keeps optional assertion failure visible, blocks dependencies and never passes all-excluded plans", async () => {
    const optional = await fixture([node("required"), node("optional", "process.exit(7)", { required: false })]).run();
    expect(optional.exitCode).toBe(0);
    expect(optional.summary.failed).toBe(1);
    expect(readFileSync(resolve(optional.artifactPath!, "../report.xml"), "utf8")).toContain('skipped="1"');
    const dependency = await fixture([
      node("fail", "process.exit(1)"),
      node("dependent", "process.exit(0)", { dependsOn: ["fail"] }),
    ]).run();
    expect(dependency.exitCode).toBe(1);
    expect(read(dependency.artifactPath).checks[1].category).toBe("dependency");
    const excluded = await fixture([
      node("excluded", "", { platforms: [process.platform === "win32" ? "linux" : "win32"] }),
    ]).run();
    expect(excluded.exitCode).toBe(2);
    expect(excluded.summary.passed).toBe(0);
  });
  it("classifies missing executable, filesystem mismatch and outside-root paths", async () => {
    expect(
      (await fixture([{ id: "missing", type: "command", command: "canary-missing-r4-executable" }]).run()).exitCode,
    ).toBe(4);
    expect((await fixture([{ id: "missing", type: "filesystem", path: "absent" }]).run()).exitCode).toBe(1);
    expect((await fixture([{ id: "escape", type: "filesystem", path: "../" }]).run()).exitCode).toBe(6);
  });
  it("applies timeout, total budget and cancellation and reclaims the child", async () => {
    const timed = await fixture([
      node("hang", "console.log(process.pid); setInterval(()=>{},1000)", { timeoutMs: 300 }),
    ]).run();
    expect(timed.exitCode).toBe(3);
    const check = read(timed.artifactPath).checks[0];
    expect(check.category).toBe("timeout");
    expect(pidAlive(Number(check.stdout.trim()))).toBe(false);
    const budget = await fixture([node("hang", "setInterval(()=>{},1000)"), node("pending")], { budgetMs: 100 }).run();
    expect(budget.exitCode).toBe(3);
    expect(read(budget.artifactPath).checks[1].category).toBe("budget");
    const f = fixture([node("cancel")]);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runCommandDetailed({ configPath: f.file, ci: true, signal: controller.signal });
    expect(cancelled.exitCode).toBe(3);
    expect(cancelled.snapshot.checks?.[0]?.category).toBe("cancelled");
  });
  it("starts a process until ready and cleans it up", async () => {
    const ci = await fixture([
      {
        id: "ready",
        type: "process",
        command: "node",
        args: ["-e", "console.log('ready:'+process.pid); setInterval(()=>{},1000)"],
        readyText: "ready:",
      },
    ]).run();
    expect(ci.exitCode).toBe(0);
    expect(pidAlive(Number(read(ci.artifactPath).checks[0].stdout.trim().split(":")[1]))).toBe(false);
  });
  it("kills a spawned descendant when a command times out", async () => {
    const ci = await fixture([
      node(
        "tree",
        "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)",
        { timeoutMs: 600 },
      ),
    ]).run();
    expect(ci.exitCode).toBe(3);
    const pid = Number(read(ci.artifactPath).checks[0].stdout.trim());
    expect(pid).toBeGreaterThan(0);
    expect(pidAlive(pid)).toBe(false);
  });
  it("reports privacy bypass as CI 6 and never seals it as successful evidence", async () => {
    process.env.CANARY_R4_PRIVATE_TOKEN = "opaque-r4-bypass-credential";
    try {
      const ci = await fixture([
        node(
          "bypass",
          "require('node:fs').writeFileSync(require('node:path').join(process.env.CANARY_WORKDIR,'..','leak.txt'),process.env.CANARY_R4_PRIVATE_TOKEN)",
          { envAllowlist: ["CANARY_R4_PRIVATE_TOKEN"] },
        ),
      ]).run();
      expect(ci.exitCode).toBe(6);
      expect(read(ci.artifactPath).status).toBe("failed");
      expect(read(ci.artifactPath).evidence.privacyFailure).toBe(true);
      expect(readFileSync(resolve(ci.artifactPath!, "../leak.txt"), "utf8")).not.toContain(
        "opaque-r4-bypass-credential",
      );
    } finally {
      delete process.env.CANARY_R4_PRIVATE_TOKEN;
    }
  });
  it("doctor accepts a project configuration without requiring an agent entry", async () => {
    const f = fixture([node("test")]);
    const result = await diagnosticSnapshot(f.root, f.file);
    expect(result.issues.some((issue) => ["CONFIG_INVALID", "AGENT_ENTRY_MISSING"].includes(issue.code))).toBe(false);
  });
  it("requires explicit HTTP consent and checks status without following redirects", async () => {
    let requests = 0;
    const server = createServer((req, res) => {
      requests++;
      res.writeHead(req.url === "/redirect" ? 302 : 204, { location: "/" });
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fixture([{ id: "denied", type: "http", url }]).run()).exitCode).toBe(6);
      expect(requests).toBe(0);
      expect(
        (await fixture([{ id: "allowed", type: "http", url, allowOutbound: true, expectedStatus: 204 }]).run())
          .exitCode,
      ).toBe(0);
      expect(
        (await fixture([{ id: "redirect", type: "http", url: url + "/redirect", allowOutbound: true }]).run()).exitCode,
      ).toBe(1);
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it("does not inherit unrelated environment, redacts approved secrets and bounds noisy output", async () => {
    process.env.CANARY_R4_PRIVATE_TOKEN = "opaque-r4-test-credential";
    process.env.CANARY_R4_UNLISTED = "must-not-be-inherited";
    try {
      const ci = await fixture([
        node(
          "env",
          "if(process.env.CANARY_R4_UNLISTED)process.exit(7);console.log(process.env.CANARY_R4_PRIVATE_TOKEN)",
          { envAllowlist: ["CANARY_R4_PRIVATE_TOKEN"] },
        ),
        node("noise", "console.log('a'.repeat(70000))"),
      ]).run();
      expect(ci.exitCode).toBe(0);
      const run = read(ci.artifactPath);
      expect(JSON.stringify(run)).not.toContain("opaque-r4-test-credential");
      expect(run.checks[0].stdout).toContain("[redacted]");
      expect(run.checks[1].outputTruncated).toBe(true);
      expect(verifyArtifacts(resolve(ci.artifactPath!, "..")).status).toBe("verified");
    } finally {
      delete process.env.CANARY_R4_PRIVATE_TOKEN;
      delete process.env.CANARY_R4_UNLISTED;
    }
  });
  it("runs an existing agent configuration through the CI contract and binds child evidence", async () => {
    const f = fixture([{ id: "agent", type: "agent", config: "agent.config.ts" }]);
    writeFileSync(join(f.root, "agent.mjs"), "export default async input => input;");
    writeFileSync(
      join(f.root, "cases.ts"),
      "export default [{id:'smoke',input:'ok',assertions:[{type:'output.exists'}]}]",
    );
    writeFileSync(
      join(f.root, "agent.config.ts"),
      "export default {agent:{adapter:'function',entry:'agent.mjs'},cases:'cases.ts',coverage:{include:['agent.mjs']},web:{enabled:false}}",
    );
    const ci = await f.run();
    expect(ci.exitCode).toBe(0);
    const child = read(ci.artifactPath).checks[0].childRun;
    expect(child.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyArtifacts(resolve(child.artifactPath, "..")).manifestHash).toBe(child.manifestHash);
    const plan = planRetention(resolve(ci.artifactPath!, "../.."), { maxRuns: 0 }, [ci.runId!]);
    expect(plan.protectedRuns).toContain(child.runId);
    const childBytes = readFileSync(child.artifactPath);
    writeFileSync(child.artifactPath, "{}");
    expect(
      verifyArtifacts(resolve(ci.artifactPath!, "..")).issues.some((issue) => issue.code === "CHILD_EVIDENCE_INVALID"),
    ).toBe(true);
    writeFileSync(child.artifactPath, childBytes);
    const artifactRoot = resolve(ci.artifactPath!, "../..");
    expect(applyRetention(artifactRoot, planRetention(artifactRoot, { maxRuns: 0 }))).toEqual([ci.runId, child.runId]);
  }, 15_000);
});
