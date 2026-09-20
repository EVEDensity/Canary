import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { runCommandDetailed } from "../src/index.js";
import { classifyCiError, executeCi } from "../src/ci.js";
import { resolveProjectContext } from "../src/home.js";
import {
  ArtifactIntegrityError,
  ArtifactPrivacyError,
  FileArtifactRepository,
  beginArtifacts,
  verifyArtifacts,
  writePrivateJson,
} from "@canary/trace";
import { recoverPartialRun, writeCheckpoint } from "@canary/runner";
import { createWebServer } from "@canary/web";

function project() {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r3-fixture-")));
  writeFileSync(
    join(cwd, "agent.mjs"),
    `import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
export default async (input, context) => {
  writeFileSync(join(process.env.CANARY_TMPDIR, 'private.txt'), input.apiKey);
  context.emit({ type: 'tool.call', name: 'echo', output: input.apiKey });
  return { echo: input.apiKey, clock: context.now(), random: context.random(), message: 'Bearer fake-r3-credential' };
};`,
  );
  writeFileSync(
    join(cwd, "cases.ts"),
    `export default [{ id: 'one', input: { apiKey: 'opaque-r3-fixture-value' }, assertions: [{ type: 'output.exists' }] }];`,
  );
  writeFileSync(
    join(cwd, "canary.config.ts"),
    `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] }, artifacts: { reproducibility: { seed: 42, clock: '2026-01-01T00:00:00.000Z', envAllowlist: ['NODE_ENV', 'PRIVATE_API_KEY'] }, retention: { maxRuns: 10 } }, web: { enabled: false } };`,
  );
  return cwd;
}
function readAll(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory() ? readAll(join(dir, entry.name)) : readFileSync(join(dir, entry.name), "utf8"),
    )
    .join("\n");
}
function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => done({ status: response.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("R3 real local run evidence", () => {
  it("seals CI only after trace/checkpoint/reports, and links equivalent replay/retry conclusions", async () => {
    const cwd = project();
    const first = await runCommandDetailed({ cwd, headless: true, suppressOutput: true });
    const repo = new FileArtifactRepository(join(cwd, ".canary", "artifacts"));
    const firstIntegrity = repo.verify(first.runId);
    expect(firstIntegrity.status).toBe("verified");
    const replay = await runCommandDetailed({
      cwd,
      headless: true,
      suppressOutput: true,
      replayOf: first.runId,
      retryOf: first.runId,
    });
    expect(replay.snapshot.evidence?.lineage).toMatchObject({
      replayOf: first.runId,
      retryOf: first.runId,
      parentManifestHash: firstIntegrity.manifestHash,
    });
    expect(replay.snapshot.evidence?.conclusionHash).toBe(first.snapshot.evidence?.conclusionHash);
    expect(replay.snapshot.evidence?.reproduction.configHash).toBe(first.snapshot.evidence?.reproduction.configHash);
    expect(first.snapshot.evidence?.reproduction.environmentNames).toEqual(["NODE_ENV"]);
    const ci = await executeCi(["--ci", "--config", join(cwd, "canary.config.ts")], (options) =>
      runCommandDetailed({ ...options, cwd }),
    );
    expect(ci.exitCode).toBe(0);
    expect(repo.verify(ci.runId!).status).toBe("verified");
    const dir = join(cwd, ".canary", "artifacts", ci.runId!);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(
      expect.arrayContaining([
        "ci.json",
        "run.json",
        "checkpoint.json",
        "trace.jsonl",
        "coverage-manifest.json",
        "report.xml",
      ]),
    );
    expect(existsSync(join(dir, "tmp"))).toBe(false);
    expect(existsSync(join(dir, "work"))).toBe(false);
    const all = readAll(dir);
    expect(all).not.toContain("opaque-r3-fixture-value");
    expect(all).not.toContain("fake-r3-credential");
  }, 30_000);

  it("sanitizes live/historical HTTP, reports and SSE, and rejects tampering after hydration", async () => {
    const cwd = project();
    const result = await runCommandDetailed({ cwd, headless: true, suppressOutput: true });
    const root = join(cwd, ".canary", "artifacts");
    const web = createWebServer(result.store, "127.0.0.1", 0, root);
    const listening = await web.listen();
    try {
      for (const route of [
        `/?runId=${result.runId}`,
        "/api/runs",
        `/api/runs/${result.runId}`,
        `/api/runs/${result.runId}/coverage`,
        `/api/runs/${result.runId}/improvements`,
        `/api/runs/${result.runId}/trajectory`,
        `/api/runs/${result.runId}/report/json`,
        `/api/runs/${result.runId}/report/junit`,
      ]) {
        const response = await get(listening.url + route);
        expect(response.status).toBe(200);
        expect(response.body).not.toContain("opaque-r3-fixture-value");
        expect(response.body).not.toContain("fake-r3-credential");
      }
      const stream = await new Promise<string>((done, fail) => {
        const req = request(`${listening.url}/api/runs/${result.runId}/events`, (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
            if (text.includes("event: run.snapshot") && text.includes("\n\n")) {
              response.destroy();
              done(text);
            }
          });
        });
        req.on("error", fail);
        req.end();
      });
      expect(stream).not.toContain("opaque-r3-fixture-value");
      expect(stream).not.toContain("fake-r3-credential");
      writeFileSync(result.artifactPath, '{"runId":"tampered"}');
      const response = await get(`${listening.url}/api/runs/${result.runId}`);
      expect(response.status).toBe(409);
      const integrity = await get(`${listening.url}/api/runs/${result.runId}/integrity`);
      expect(JSON.parse(integrity.body).status).toBe("invalid");
    } finally {
      await new Promise<void>((done) => web.server.close(() => done()));
    }
  }, 20_000);

  it("records partial recovery and tail hashes without rerunning a completed case", async () => {
    const cwd = project();
    const completed = await runCommandDetailed({ cwd, headless: true, suppressOutput: true });
    const dir = join(cwd, ".canary", "artifacts", "run_crashed");
    beginArtifacts(dir, { retryOf: completed.runId });
    const snapshot = {
      ...completed.snapshot,
      runId: "run_crashed",
      status: "running" as const,
      finishedAt: undefined,
      totalCases: 2,
    };
    writePrivateJson(join(dir, "run.json"), snapshot);
    writeCheckpoint({
      v: 1,
      kind: "canary.checkpoint",
      runId: snapshot.runId,
      pid: 0,
      status: "running",
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.startedAt,
      artifactDir: dir,
      tmpDir: join(dir, "tmp"),
      workDir: join(dir, "work"),
      lockPath: join(dir, "run.lock"),
      ports: [],
      childPids: [],
      completedCaseKeys: ["one"],
      pendingCaseKeys: ["two"],
    });
    writeFileSync(join(dir, "trace.jsonl"), '{"type":"finished"}\n{"type":"part');
    const recovered = await recoverPartialRun(dir, snapshot);
    expect(recovered.snapshot?.results).toEqual(snapshot.results);
    expect(recovered.snapshot?.status).toBe("cancelled");
    expect(recovered.checkpoint.pendingCaseKeys).toEqual(["two"]);
    expect(verifyArtifacts(dir).status).toBe("verified");
    const recovery = JSON.parse(readFileSync(join(dir, "recovery.json"), "utf8"));
    expect(recovery.traceRepair.removedBytes).toBeGreaterThan(0);
    expect(recovery.priorIntegrity).toBe("partial");
    expect(recovered.snapshot?.evidence?.lineage.recoveryOf).toBe("run_crashed");
    writeFileSync(join(dir, "trace.jsonl"), "changed");
    await expect(recoverPartialRun(dir, recovered.snapshot)).rejects.toBeInstanceOf(ArtifactIntegrityError);
  }, 15_000);

  it("maps integrity and privacy failures to the frozen CI exits", () => {
    const context = resolveProjectContext({ cwd: project() });
    expect(classifyCiError(new ArtifactPrivacyError(), context).exitCode).toBe(6);
    expect(
      classifyCiError(
        new ArtifactIntegrityError({
          v: 1,
          kind: "canary.artifact-integrity",
          runId: "x",
          status: "invalid",
          issues: [],
        }),
        context,
      ).exitCode,
    ).toBe(5);
  });

  it("returns CI 6 and retains a failed, sanitized run when a writer bypasses output redaction", async () => {
    const cwd = project();
    const file = join(cwd, "agent.mjs");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "context.emit",
        "writeFileSync(join(process.env.CANARY_TMPDIR, '..', 'unsafe.json'), JSON.stringify({ apiKey: input.apiKey })); context.emit",
      ),
    );
    const ci = await executeCi(["--ci", "--config", join(cwd, "canary.config.ts")], (options) =>
      runCommandDetailed({ ...options, cwd }),
    );
    expect(ci.exitCode).toBe(6);
    expect(ci.issues[0]?.code).toBe("ARTIFACT_PRIVACY");
    expect(ci.runId).toBeTruthy();
    const dir = join(cwd, ".canary", "artifacts", ci.runId!);
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    expect(run.status).toBe("failed");
    expect(run.evidence.privacyFailure).toBe(true);
    expect(readAll(dir)).not.toContain("opaque-r3-fixture-value");
    expect(verifyArtifacts(dir).status).toBe("verified");
  }, 15_000);
});
