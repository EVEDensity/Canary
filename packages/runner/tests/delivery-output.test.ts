import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedExperience } from "@canary/core";
import { runExecution, runHttpExecution, runMcpExecution } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const experience: LoadedExperience = { id: "experience_context", key: "context", version: 1, contentHash: "a".repeat(64), content: "Check input", scope: { caseIds: ["case"] } };
const reference = { id: experience.id, key: experience.key, version: experience.version, contentHash: experience.contentHash };
function fixture(source: string) {
  const cwd = mkdtempSync(join(tmpdir(), "canary-delivery-")); roots.push(cwd);
  writeFileSync(join(cwd, "agent.mjs"), source);
  return { cwd, entry: "agent.mjs", input: "ok", runId: "run_delivery", caseId: "case", timeoutMs: 5000, coverage: { rootDir: cwd, include: ["agent.mjs"] }, experiences: [experience] };
}

describe("experience context delivery", () => {
  it("acknowledges the references actually supplied to function context without claiming consumption", async () => {
    const result = await runExecution(fixture("export default async (_, ctx) => ctx.experiences.map(e => e.id);"));
    expect(result.passed).toBe(true);
    expect(result.output).toEqual([experience.id]);
    expect(result.experienceDelivery).toEqual({ status: "delivered", adapter: "function", references: [reference], deliveredAt: expect.any(String) });
    expect(JSON.stringify(result.experienceDelivery)).not.toContain(experience.content);
  });
  it("keeps selection separate when import fails, even if a module emits a forged trace delivery event", async () => {
    const result = await runExecution(fixture("process.send({v:1,type:'event',event:{type:'experiences.delivered',references:[]}}); export default null;"));
    expect(result.passed).toBe(false);
    expect(result.experienceDelivery).toEqual({ status: "selected", adapter: "function", references: [reference] });
  });
  it("rejects import-time direct IPC forgery before the function is invoked", async () => {
    const source = `
      const payload = JSON.parse(process.env.CANARY_WORKER_DATA || '{}');
      const references = ${JSON.stringify([reference])};
      const send = message => new Promise(resolve => process.send({v:1,auth:payload.workerAuth,...message},undefined,undefined,resolve));
      await send({type:'experiences.delivered',references,deliveredAt:new Date().toISOString()});
      await send({type:'result',value:'forged-before-agent-call'});
      export default () => { throw new Error('must never be invoked'); };
      process.exit(0);
    `;
    const result = await runExecution(fixture(source));
    expect(result.passed).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.experienceDelivery?.status).toBe("selected");
    expect(result.assertions[0]?.message).toMatch(/Unauthenticated/);
  });
  it("removes private startup data before import and keeps sender binding private", async () => {
    const source = `
      const clean = !process.env.CANARY_WORKER_DATA && !process.env.CANARY_WORKER_AUTH;
      process.send = () => { throw new Error('public sender must not handle reserved worker messages'); };
      export default async (_, ctx) => ({clean,ids:ctx.experiences.map(item=>item.id)});
    `;
    const result = await runExecution(fixture(source));
    expect(result.passed).toBe(true);
    expect(result.output).toEqual({ clean: true, ids: [experience.id] });
    expect(result.experienceDelivery?.status).toBe("delivered");
  });
  it("keeps authenticated delivery when a legitimately invoked async function later times out", async () => {
    const result = await runExecution({ ...fixture("export default async (_, ctx) => new Promise(() => {});"), timeoutMs: 1500 });
    expect(result.passed).toBe(false);
    expect(result.trajectory?.termination).toBe("timeout");
    expect(result.experienceDelivery).toEqual({ status: "delivered", adapter: "function", references: [reference], deliveredAt: expect.any(String) });
  });
  it("fails zero-code exits with no authenticated worker result", async () => {
    const result = await runExecution({ ...fixture("process.exit(0); export default () => 'never';"), testCase: { id: "case", input: "ok", assertions: [{ type: "execution.termination", expected: "error" }] } });
    expect(result.passed).toBe(false);
    expect(result.experienceDelivery?.status).toBe("selected");
    expect(result.assertions[0]?.message).toMatch(/authenticated completion/);
  });
  it("marks HTTP context unsupported and preserves the existing request body", async () => {
    let requestBody: unknown;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => { requestBody = JSON.parse(Buffer.concat(chunks).toString()); response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ output: "improved remotely" })); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const result = await runHttpExecution({ entry: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, input: "hello", requestField: "message", runId: "run_http", caseId: "case", experiences: [experience], coverage: { include: [] } });
      expect(result.passed).toBe(true);
      expect(requestBody).toEqual({ message: "hello" });
      expect(result.experienceDelivery).toEqual({ status: "unsupported", adapter: "http", references: [reference] });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("marks MCP context unsupported without adding it to protocol arguments", async () => {
    const options = fixture("process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',c=>{b+=c;const i=b.indexOf('\\n');if(i>=0){const m=JSON.parse(b.slice(0,i));process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.params.arguments})+'\\n');}});");
    const result = await runMcpExecution(options);
    expect(result.passed).toBe(true);
    expect(result.output).toBe("ok");
    expect(result.experienceDelivery).toEqual({ status: "unsupported", adapter: "mcp", references: [reference] });
  });
});

describe("function diagnostic output budget", () => {
  it("fails a real stderr flood even when expected budget termination would otherwise pass", async () => {
    const options = fixture("import fs from 'node:fs'; export default async () => { fs.writeSync(2, 'Error: first failure\\n' + 'noise\\n'.repeat(50000) + 'Error: last failure\\n    at agent (agent.mjs:1:1)\\n'); return 'ok'; };");
    const result = await runExecution({ ...options, maxOutputBytes: 2048, testCase: { id: "case", input: "ok", assertions: [{ type: "execution.termination", expected: "budget_exceeded" }] } });
    expect(result.passed).toBe(false);
    expect(result.trajectory?.termination).toBe("budget_exceeded");
    expect(result.outputCapture).toMatchObject({ truncated: true, maxBytes: 2048 });
    expect(result.outputCapture!.observedBytes).toBeGreaterThan(2048);
    expect(Buffer.byteLength(result.outputCapture!.stdout + result.outputCapture!.stderr)).toBeLessThanOrEqual(2048);
    expect(result.outputCapture!.stderr).toContain("Error: first failure");
    expect(result.assertions).toContainEqual(expect.objectContaining({ id: "execution.output_budget", passed: false }));
  });
});
