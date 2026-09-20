import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { runCommandDetailed } from "../src/index.js";
import { executeCi } from "../src/ci.js";
import { verifyArtifacts } from "@canary/trace";
import { createWebServer, RunStore } from "@canary/web";

const base = realpathSync(mkdtempSync(join(tmpdir(), "canary R5 tests ")));
let count = 0;
afterAll(() => rmSync(base, { recursive: true, force: true }));
async function port() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch {}
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error("Wait timed out");
}
async function fixture(checks: unknown[]) {
  const root = join(base, String(++count));
  mkdirSync(root);
  const configPath = join(root, "checks.json"),
    p = await port();
  writeFileSync(
    configPath,
    JSON.stringify({ kind: "canary.project", version: 1, web: { port: p, open: false }, checks }),
  );
  return {
    root,
    configPath,
    url: `http://127.0.0.1:${p}`,
    options: { configPath, noOpen: true, suppressOutput: true },
  };
}
const node = (id: string, code: string, more = {}) => ({
  id,
  type: "command",
  command: "node",
  args: ["-e", code],
  ...more,
});
async function token(url: string) {
  return JSON.parse((await (await fetch(url)).text()).match(/const writeToken=("[^"]+")/)![1]!);
}
async function post(url: string, credential: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-canary-write-token": credential },
    body: JSON.stringify(body),
  });
}

describe("R5 live project sessions", () => {
  it("serves progress before completion, closes SSE/page independently, and preserves CI-equivalent evidence", async () => {
    const f = await fixture([node("slow", "setTimeout(()=>console.log('done'),1200)")]);
    const pending = runCommandDetailed(f.options);
    await until(
      () => fetch(f.url + "/api/runs").then((r) => r.json()),
      (rows) => rows.length > 0,
    );
    const rows = await (await fetch(f.url + "/api/runs")).json();
    expect(rows[0].status).toBe("running");
    const events = await fetch(f.url + `/api/runs/${rows[0].runId}/events`);
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const reader = events.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("retry:");
    expect((await post(f.url + "/api/session/close", await token(f.url), {})).status).toBe(200);
    await reader.cancel();
    const result = await pending;
    expect(result.exitCode).toBe(0);
    expect(verifyArtifacts(dirname(result.artifactPath)).status).toBe("verified");
    await result.close();
    const ci = await executeCi(["--config", f.configPath], runCommandDetailed);
    expect(ci.exitCode).toBe(result.exitCode);
    expect(ci.summary.passed).toBe(result.snapshot.passedCases);
  });
  it("retries failed checks with fresh dependencies, keeps lineage, compares and gates writes", async () => {
    const f = await fixture([
      node("dependency", "console.log('Bearer r5-fixture-secret')"),
      { id: "target", type: "filesystem", path: "fixed.txt", dependsOn: ["dependency"] },
    ]);
    const result = await runCommandDetailed(f.options);
    const credential = await token(f.url);
    try {
      expect(result.exitCode).toBe(1);
      expect((await post(f.url + `/api/runs/${result.runId}/retry`, "wrong", { failed: true })).status).toBe(403);
      expect(
        (await post(f.url + `/api/runs/${result.runId}/retry`, credential, { checkId: "not-in-plan" })).status,
      ).toBe(409);
      writeFileSync(join(f.root, "fixed.txt"), "fixed");
      const res = await post(f.url + `/api/runs/${result.runId}/retry`, credential, { failed: true });
      expect(res.status).toBe(202);
      const { runId } = await res.json();
      const next = await until(
        () => fetch(f.url + `/api/runs/${runId}`).then((r) => r.json()),
        (r) => r.status === "completed",
      );
      expect(next.checks.map((c: { id: string }) => c.id)).toEqual(["dependency", "target"]);
      expect(next.retryOf).toBe(result.runId);
      await until(
        async () => verifyArtifacts(join(f.root, ".canary/artifacts", runId)),
        (r) => r.status === "verified",
      );
      const compare = await (await fetch(f.url + `/api/compare?baseline=${result.runId}&candidate=${runId}`)).json();
      expect(compare.checks.find((c: { id: string }) => c.id === "target")).toMatchObject({
        before: "failed",
        after: "passed",
      });
      const report = await (await fetch(f.url + `/api/runs/${runId}/report/json`)).text();
      expect(report).toContain("canary.project-report");
      expect(report).not.toContain("r5-fixture-secret");
      const single = await post(f.url + `/api/runs/${runId}/retry`, credential, { checkId: "dependency" });
      expect(single.status).toBe(202);
      const singleId = (await single.json()).runId;
      await until(
        () => fetch(f.url + `/api/runs/${singleId}`).then((r) => r.json()),
        (r) => r.status === "completed",
      );
      await until(
        async () => verifyArtifacts(join(f.root, ".canary/artifacts", singleId)),
        (r) => r.status === "verified",
      );
      writeFileSync(result.artifactPath, "{}");
      expect((await post(f.url + `/api/runs/${result.runId}/retry`, credential, { failed: true })).status).toBe(409);
    } finally {
      await result.close();
    }
  }, 20000);
  it("isolates two project histories, rejects foreign origins/hosts, and hydrates history", async () => {
    const a = await fixture([node("a", "console.log('a')")]),
      b = await fixture([node("b", "console.log('b')")]);
    const left = await runCommandDetailed(a.options),
      right = await runCommandDetailed(b.options);
    try {
      expect((await fetch(a.url + `/api/runs/${right.runId}`)).status).toBe(404);
      expect((await fetch(a.url + "/api/runs", { headers: { origin: "https://outside.example" } })).status).toBe(403);
      const foreignHost = await new Promise<number>((done, fail) => {
        const req = request(a.url + "/api/runs", { headers: { host: "outside.example" } }, (res) => {
          res.resume();
          done(res.statusCode!);
        });
        req.on("error", fail);
        req.end();
      });
      expect(foreignHost).toBe(421);
      expect((await (await fetch(a.url + "/api/runs")).json()).map((r: { runId: string }) => r.runId)).toEqual([
        left.runId,
      ]);
    } finally {
      await left.close();
      await right.close();
    }
    const reopened = await runCommandDetailed(a.options);
    try {
      expect((await (await fetch(a.url + "/api/runs")).json()).length).toBe(2);
    } finally {
      await reopened.close();
    }
  }, 15000);
  it("makes an explicit optional-check rerun a meaningful gate", async () => {
    const f = await fixture([
      node("required", "console.log('ok')"),
      { id: "optional", type: "resources", required: false, minFreeMemoryMb: Number.MAX_SAFE_INTEGER },
    ]);
    const result = await runCommandDetailed(f.options);
    try {
      expect(result.exitCode).toBe(0);
      const res = await post(f.url + `/api/runs/${result.runId}/retry`, await token(f.url), { checkId: "optional" });
      expect(res.status).toBe(202);
      const id = (await res.json()).runId;
      const next = await until(
        () => fetch(f.url + `/api/runs/${id}`).then((r) => r.json()),
        (r) => r.status === "failed",
      );
      expect(next.checks[0]).toMatchObject({ required: true, status: "failed", category: "assertion" });
      await until(
        async () => verifyArtifacts(join(f.root, ".canary/artifacts", id)),
        (r) => r.status === "verified",
      );
      expect(await fetch(f.url + `/api/runs/${id}/report/junit`).then((r) => r.text())).toContain("<failure");
    } finally {
      await result.close();
    }
  });
  it("honors headless and configured port, and provides explicit capacity diagnostics", async () => {
    expect(() => createWebServer(new RunStore(), "0.0.0.0")).toThrow("loopback");
    const f = await fixture([{ id: "resources", type: "resources", minFreeMemoryMb: 0, minFreeDiskMb: 0 }]);
    const result = await runCommandDetailed({ ...f.options, headless: true });
    expect(result.uiUrl).toBe("");
    expect(result.snapshot.checks?.[0]?.observations?.freeDiskMb).toBeGreaterThanOrEqual(0);
    const server = createServer();
    await new Promise<void>((done) => server.listen(Number(new URL(f.url).port), "127.0.0.1", done));
    try {
      await expect(runCommandDetailed(f.options)).rejects.toMatchObject({ exitCode: 4 });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
    expect(JSON.parse(readFileSync(result.artifactPath, "utf8")).status).toBe("completed");
  });
});
