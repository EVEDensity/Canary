import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCommandDetailed } from "../packages/cli/dist/index.js";
import { verifyArtifacts, writePrivateJson } from "../packages/trace/dist/index.js";
import { evidenceOutput, repositoryRoot } from "./lib/evidence-output.mjs";
import { freePort, until, withBrowser } from "./lib/headless-browser.mjs";

const parent = join(repositoryRoot, ".canary/verification");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "map-")), port = await freePort();
const configPath = join(root, "checks.json"), url = `http://127.0.0.1:${port}`;
writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(join(root, "app.js"), "export function broken() {\n  throw new Error('MAP_REPAIR_FAILURE');\n}\nbroken();\n");
writeFileSync(configPath, JSON.stringify({ kind: "canary.project", version: 1, web: { port, open: false },
  checks: [{ id: "fixture.fail", type: "command", command: process.execPath, args: ["app.js"] }] }));
const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
git("init", "-q"); git("config", "core.autocrlf", "false"); git("add", ".");
git("-c", "user.name=Canary Verification", "-c", "user.email=verification@example.invalid", "commit", "-qm", "failing fixture baseline");
const baselineCommit = git("rev-parse", "HEAD");
const original = await runCommandDetailed({ configPath, noOpen: true, suppressOutput: true });
const output = { kind: "canary.map-acceptance", root, baselineCommit, originalRunId: original.runId, steps: [] };
try {
  assert.equal(original.exitCode, 1);
  assert.equal(verifyArtifacts(resolve(original.artifactPath, "..")).status, "verified");
  output.steps.push({ id: "original-failure", status: "passed", expected: "Real failed command with sealed original artifact" });
  writeFileSync(join(root, "app.js"), "export function broken() {\n  return 42;\n}\nbroken();\n");
  const html = await (await fetch(url)).text();
  const token = JSON.parse(html.match(/const writeToken=("[^"]+")/)[1]);
  const response = await fetch(`${url}/api/runs/${original.runId}/retry`, { method: "POST",
    headers: { "content-type": "application/json", "x-canary-write-token": token }, body: JSON.stringify({ failed: true }) });
  assert.equal(response.status, 202);
  const { runId } = await response.json(); output.repairRunId = runId;
  await until(() => fetch(`${url}/api/runs/${runId}`).then((r) => r.json()), (run) => run.status === "completed");
  await until(() => verifyArtifacts(join(root, ".canary/artifacts", runId)), (result) => result.status === "verified");
  const workspace = await (await fetch(`${url}/api/workspace/runs/${original.runId}`)).json();
  assert.equal(workspace.status, "failed"); assert.equal(workspace.issues[0].status, "verified");
  assert.equal(workspace.issues[0].verification.runId, runId);
  const mapped = await (await fetch(`${url}/api/structure?runId=${original.runId}`)).json();
  assert.equal(mapped.diagnostics.failures[0].state, "verified");
  assert.equal(mapped.diagnostics.failures[0].confidence, "path-line");
  const failure = mapped.diagnostics.failures[0];
  const source = await (await fetch(`${url}/api/structure/source?runId=${original.runId}&nodeId=${failure.nodeId}&line=${failure.line}`)).json();
  assert.equal(source.availability, "git-hash-match"); assert.ok(source.lines.join("\n").includes("MAP_REPAIR_FAILURE"));
  output.steps.push({ id: "repair-lineage-and-source", status: "passed", expected: "Linked passing retry and hash-matched historical source; original failure preserved" });
  output.browser = await withBrowser(`${url}/?runId=${original.runId}`, join(root, "browser-profile"), async ({ evaluate, errors }) => {
    await until(() => evaluate("document.querySelector('#architecture-preview-units')?.textContent"), (value) => Boolean(value && value !== "—"));
    await evaluate("document.querySelector('[data-tab=structure]').click()");
    await until(() => evaluate("!!document.querySelector('#architecture-palette')"), Boolean);
    await evaluate("document.querySelector('#architecture-palette').value='failure';document.querySelector('#architecture-palette').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#architecture-search').value='broken';document.querySelector('#architecture-search').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.architecture-search-hit').click()");
    const detail = await evaluate("({node:document.querySelector('#architecture-detail h3')?.textContent,signal:[...document.querySelectorAll('.architecture-node')].find(item=>item.dataset.nodeId===architectureState.selected)?.dataset.signal,verified:document.querySelector('#architecture-detail').textContent.includes('修复后已验证'),original:document.querySelector('#architecture-detail').textContent.includes('MAP_REPAIR_FAILURE')})");
    assert.equal(detail.node, "broken"); assert.equal(detail.signal, "verified"); assert.ok(detail.verified && detail.original);
    await evaluate("[...document.querySelectorAll('#architecture-detail .diagnostic-evidence button')].find(item=>item.textContent.includes('查看源码')).click()");
    await until(() => evaluate("!!document.querySelector('.source-line[data-hit=failure]')"), Boolean);
    const historical = await evaluate("document.querySelector('.architecture-source-detail').textContent.includes('历史 Git 提交')");
    assert.ok(historical); assert.deepEqual(errors, []);
    return { detail, historicalSource: historical, errors };
  });
  output.steps.push({ id: "verified-page", status: "passed", expected: "Actual browser shows green verified state and original failure source" });
  output.status = "passed";
} catch (error) { output.status = "failed"; output.error = error.message; process.exitCode = 1; }
finally {
  await original.close();
  const file = evidenceOutput("map", "map-acceptance.json"); writePrivateJson(file, output);
  console.log(JSON.stringify({ status: output.status, evidence: file, root, originalRunId: original.runId, repairRunId: output.repairRunId, steps: output.steps }));
}
