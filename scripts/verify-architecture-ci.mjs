import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeCi } from "../packages/cli/dist/ci.js";
import { runCommandDetailed } from "../packages/cli/dist/index.js";
import { FileArtifactRepository, RunStore, writePrivateJson } from "../packages/trace/dist/index.js";
import { createWebServer } from "../apps/web/dist/index.js";
import { repositoryRoot, evidenceOutput } from "./lib/evidence-output.mjs";
import { freePort, until, withBrowser } from "./lib/headless-browser.mjs";

const parent = join(repositoryRoot, ".canary/verification"); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "architecture-ci-")), configPath = join(root, "checks.json");
const checks = [
  { id: "prep", type: "command", command: process.execPath, args: ["-e", "console.log('prepare')"], impact: { paths: ["other.js"] } },
  { id: "app", type: "command", command: process.execPath, args: ["app.js"], dependsOn: ["prep"], impact: { paths: ["app.js"] } },
  { id: "other", type: "command", command: process.execPath, args: ["other.js"], impact: { paths: ["other.js"] } },
];
writeFileSync(configPath, JSON.stringify({ kind: "canary.project", version: 1, checks }));
writeFileSync(join(root, "package.json"), '{"type":"module"}');
const math = (value) => `import { helper } from './app.js';\nexport const value = ${value};\nexport function explain() { return helper(); }\n`;
writeFileSync(join(root, "math.js"), math(1));
writeFileSync(join(root, "app.js"), "import { value } from './math.js';\nexport function helper() { return 42; }\nif(value !== 2) throw new Error('WRONG_CALCULATION');\n");
writeFileSync(join(root, "other.js"), "console.log('unrelated check');\n");
writeFileSync(join(root, "canary.architecture.json"), JSON.stringify({ v: 1, layers: [{ id: "ui", name: "界面", paths: ["app.js"] }, { id: "logic", name: "业务", paths: ["math.js"] }], rules: { forbiddenDependencies: [{ from: "logic", to: "ui", reason: "业务层不得反向依赖界面" }] } }));
const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
git("init", "-q"); git("config", "core.autocrlf", "false"); git("add", "."); git("-c", "user.name=Canary Verification", "-c", "user.email=verification@example.invalid", "commit", "-qm", "fixed verification input");
const baselineCommit = git("rev-parse", "HEAD");
const output = { kind: "canary.architecture-ci-acceptance", root, baselineCommit, steps: [], modelCalls: 0 };
let web;
try {
  writeFileSync(join(root, "math.js"), math(2));
  const args = ["--ci", "--config", configPath, "--base", "HEAD"];
  const full = await executeCi(args, runCommandDetailed), affected = await executeCi([...args, "--affected"], runCommandDetailed);
  assert.equal(full.exitCode, 0); assert.equal(full.summary.total, 3);
  assert.equal(affected.exitCode, 0); assert.equal(affected.summary.total, 2);
  assert.deepEqual(affected.selection, { requested: "affected", mode: "reduced", planned: 3, selected: 2, omitted: 1, fallbackReasons: [] });
  output.fullRunId = full.runId; output.affectedRunId = affected.runId;
  const repository = new FileArtifactRepository(join(root, ".canary/artifacts"));
  for (const id of [full.runId, affected.runId]) assert.equal(repository.verify(id).status, "verified");
  const analysis = repository.readJson(affected.runId, "architecture-analysis.json"), impact = repository.readJson(affected.runId, "change-impact.json"), plan = repository.readJson(affected.runId, "ci-plan.json");
  assert.ok(analysis.findings.some((finding) => finding.code === "dependency-cycle"));
  assert.ok(analysis.findings.some((finding) => finding.code === "forbidden-layer-dependency"));
  assert.ok(impact.affected.some((node) => node.path === "app.js" && node.reason === "consumer"));
  assert.equal(plan.checks.find((check) => check.id === "prep").reason, "required-check-dependency");
  assert.equal(plan.checks.find((check) => check.id === "other").action, "omit");
  const xml = readFileSync(join(repository.rootDir, affected.runId, "report.xml"), "utf8"); assert.ok(xml.includes('skipped="1"') && xml.includes("not executed"));
  output.steps.push({ id: "architecture-and-impact", status: "passed", expected: "Resolved cycle, explicit layer violation and consumer explanation share sealed source" });
  output.steps.push({ id: "incremental-selection", status: "passed", expected: "3 full checks vs 2 selected; prerequisites retained; omitted check reported skipped" });
  writeFileSync(join(root, "math.js"), math(3));
  const failure = await executeCi([...args, "--affected"], runCommandDetailed); assert.equal(failure.exitCode, 1);
  output.failureRunId = failure.runId; writeFileSync(join(root, "math.js"), math(2));
  writeFileSync(join(root, "package.json"), '{"type":"module","name":"global-change"}');
  const fallback = await executeCi([...args, "--affected"], runCommandDetailed);
  assert.equal(fallback.exitCode, 0); assert.equal(fallback.selection.selected, 3);
  assert.ok(fallback.selection.fallbackReasons.includes("global-configuration-changed"));
  output.fallbackRunId = fallback.runId; output.steps.push({ id: "failure-and-fallback", status: "passed", expected: "Wrong result remains nonzero; global configuration forces full checks" });
  const port = await freePort(); web = createWebServer(new RunStore(), "127.0.0.1", port, repository.rootDir, { projectPage: true });
  const url = (await web.listen()).url;
  const saved = await (await fetch(`${url}/api/structure?runId=${affected.runId}`)).json();
  assert.equal(saved.impact.source.inventoryHash, impact.source.inventoryHash);
  assert.equal(saved.ciPlan.omittedCount, 1);
  output.browser = await withBrowser(`${url}/?runId=${affected.runId}`, join(root, "browser-profile"), async ({ evaluate, errors }) => {
    await until(() => evaluate("document.querySelector('#architecture-preview-units')?.textContent"), (value) => Boolean(value && value !== "—"));
    await evaluate("document.querySelector('[data-tab=structure]').click()");
    await until(() => evaluate("!!document.querySelector('#architecture-analysis-board')"), Boolean);
    const risk = await evaluate("document.querySelector('#architecture-analysis-content').textContent");
    assert.ok(risk.includes("循环依赖") && risk.includes("分层规则"));
    await evaluate("document.querySelector('#architecture-analysis-content .analysis-paths button').click()");
    const focused = await evaluate("document.querySelector('#architecture-detail code').textContent"); assert.ok(/app.js|math.js/.test(focused));
    await evaluate("document.querySelector('[data-analysis-tab=impact]').click()");
    const impactText = await evaluate("document.querySelector('#architecture-analysis-content').textContent"); assert.ok(impactText.includes("潜在") && impactText.includes("app.js"));
    await evaluate("document.querySelector('[data-analysis-tab=ci]').click()");
    const ciText = await evaluate("document.querySelector('#architecture-analysis-content').textContent"); assert.ok(ciText.includes("执行 2 / 3") && ciText.includes("省略 · other"));
    const incrementalBanner = await evaluate("({kind:document.querySelector('#kind').textContent,note:document.querySelector('#progress-note').textContent,visible:!document.querySelector('#progress-note').hidden})");
    assert.ok(incrementalBanner.kind.includes("增量") && incrementalBanner.note.includes("省略") && incrementalBanner.visible);
    await evaluate("[...document.querySelectorAll('#architecture-analysis-content button')].find(button=>button.textContent.includes('检查结果与证据')).click()");
    assert.ok(await evaluate("document.querySelector('#check-drawer').open")); assert.deepEqual(errors, []);
    return { riskFindings: true, focused, impactVisible: true, ciVisible: true, incrementalBanner, errors };
  });
  output.steps.push({ id: "real-page", status: "passed", expected: "Risk-to-node navigation, potential impact and CI plan/evidence work in an actual browser" });
  output.status = "passed";
} catch (error) { output.status = "failed"; output.error = error.message; process.exitCode = 1; }
finally {
  if (web) { web.server.closeAllConnections(); await new Promise((done) => web.server.close(done)); }
  const file = evidenceOutput("architecture-ci", "acceptance.json"); writePrivateJson(file, output);
  console.log(JSON.stringify({ status: output.status, evidence: file, ...Object.fromEntries(Object.entries(output).filter(([key]) => key.endsWith("RunId"))), steps: output.steps, error: output.error }));
}
