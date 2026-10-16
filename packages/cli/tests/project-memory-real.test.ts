import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { projectMemoryQuerySchema, type ProjectMemoryRecord } from "@canary/core";
import { FileArtifactRepository, updateArtifact } from "@canary/trace";

it("retains real verified repairs, scopes historical reuse and rejects resealed regression-proof tampering", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary R27 real memory ")));
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const configFile = join(root, "canary.project.json");
  const keep = process.env.KEEP_R27_FIXTURE === "1";
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", configFile], {
      cwd: root,
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 2_097_152,
      windowsHide: true,
    });
    let body: any;
    try {
      body = JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error(`CLI did not return complete JSON: ${result.stderr}`);
    }
    return { code: result.status, body, error: result.stderr, processError: result.error };
  };
  const verifyRepair = (baseline: string, candidate: string) =>
    call(
      "repair-verify",
      baseline,
      candidate,
      "--regression",
      "regression",
      "--test",
      "regression.test.mjs",
      "--execute",
    );
  const record = (candidate: string, ...flags: string[]) =>
    call(
      "memory",
      "record",
      candidate,
      "--actor",
      "fixture",
      "--reason",
      "Reviewed regression evidence",
      "--ack-review",
      ...flags,
    );
  const cleanup = () => {
    const temp = realpathSync.native(tmpdir()),
      path = relative(temp, root);
    if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error("Unsafe project memory fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };
  let completed = false;
  try {
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "package.json"), '{"name":"project-memory-fixture","private":true,"type":"module"}\n');
    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b-1;\n");
    writeFileSync(join(root, "mode.txt"), "normal\n");
    writeFileSync(
      join(root, "basic.test.mjs"),
      [
        "import assert from 'node:assert/strict';",
        "import {readFileSync} from 'node:fs';",
        "import {add} from './math.mjs';",
        "const expected = readFileSync(new URL('./mode.txt', import.meta.url), 'utf8').trim() === 'trigger' ? 3 : 2;",
        "assert.equal(add(1,1), expected);",
        "",
      ].join("\n"),
    );
    writeFileSync(join(root, "healthy.test.mjs"), "import assert from 'node:assert/strict'; assert.equal(4,4);\n");
    const checks = [
      { id: "original", type: "command", command: "node", args: ["basic.test.mjs"] },
      { id: "healthy", type: "command", command: "node", args: ["healthy.test.mjs"] },
    ];
    const configure = (items: object[]) =>
      writeFileSync(
        configFile,
        JSON.stringify({ kind: "canary.project", version: 1, budgetMs: 600000, checks: items }),
      );
    configure(checks);
    git("add", ".");
    git("commit", "-qm", "Failing arithmetic baseline");
    const baseline = call("run", "--ci");
    expect(baseline.code, baseline.error).toBe(1);
    const baselineId = baseline.body.runId as string;

    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b;\n");
    writeFileSync(
      join(root, "regression.test.mjs"),
      [
        "import assert from 'node:assert/strict';",
        "import {add} from './math.mjs';",
        "assert.equal(add(2,3),5);",
        "",
      ].join("\n"),
    );
    configure([...checks, { id: "regression", type: "command", command: "node", args: ["regression.test.mjs"] }]);
    git("add", ".");
    git("commit", "-qm", "Fix arithmetic and add regression");
    const candidate = call("run", "--ci");
    expect(candidate.code, candidate.error).toBe(0);
    const candidateId = candidate.body.runId as string;
    const verified = verifyRepair(baselineId, candidateId);
    expect(verified.code, verified.error).toBe(0);
    expect(verified.body).toMatchObject({ outcome: "verified", executed: true });
    const beforeRegressionId = verified.body.beforeRegression.runId as string;
    const artifacts = join(root, ".canary", "artifacts"),
      repository = new FileArtifactRepository(artifacts);
    expect(repository.verify(beforeRegressionId).status).toBe("verified");
    const retained = record(candidateId);
    expect(retained.code, retained.error).toBe(0);
    const memory = retained.body as ProjectMemoryRecord;
    expect(memory).toMatchObject({
      status: "retained",
      source: { candidate: { runId: candidateId }, beforeRegression: { runId: beforeRegressionId } },
    });
    const duplicate = record(candidateId, "--days", "365");
    expect(duplicate.code, duplicate.error).toBe(0);
    expect(duplicate.body).toEqual(memory);

    writeFileSync(join(root, "mode.txt"), "trigger\n");
    git("add", ".");
    git("commit", "-qm", "Exercise a later failure outside retained repair scope");
    const relatedRun = call("run", "--ci");
    expect(relatedRun.code, relatedRun.error).toBe(1);
    const relatedId = relatedRun.body.runId as string;
    const query = call("memory", "query", relatedId);
    expect(query.code, query.error).toBe(0);
    expect(projectMemoryQuerySchema.safeParse(query.body).success).toBe(true);
    expect(query.body).toMatchObject({
      status: "available",
      advisoryOnly: true,
      executionGranted: false,
      items: [{ match: "related", checkIds: ["original"] }],
    });
    expect(query.body.items[0].reasons).toContain("historical-repair-only-not-current-fix-proof");
    expect(memory.scope.files.some((file) => file.path === "mode.txt")).toBe(false);

    // A candidate can receive a later report without erasing the exact receipt
    // already retained by its independent before-regression execution.
    const anchoredReceipt = JSON.parse(readFileSync(join(artifacts, candidateId, "repair-verification.json"), "utf8"));
    updateArtifact(join(artifacts, candidateId), "repair-verification.json", {
      ...anchoredReceipt,
      outcome: "evidence-insufficient",
      reasons: ["Later candidate assessment is not a verified repair"],
    });
    expect(repository.verify(candidateId).status).toBe("verified");
    const historicalAnchor = call("memory", "query", relatedId);
    expect(historicalAnchor.code, historicalAnchor.error).toBe(0);
    expect(historicalAnchor.body.items[0]).toMatchObject({ match: "related", record: { id: memory.id } });
    expect(record(candidateId).code).toBe(2);
    updateArtifact(join(artifacts, candidateId), "repair-verification.json", anchoredReceipt);

    const budget = call("memory", "query", relatedId, "--max-chars", "512");
    expect(budget.code, budget.error).toBe(0);
    expect(budget.body).toMatchObject({ items: [], budget: { maxChars: 512, usedChars: 0 } });
    expect(budget.body.skipped).toContainEqual({ id: memory.id, reason: "context-budget" });

    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b+2;\n");
    git("add", ".");
    git("commit", "-qm", "Change retained arithmetic repair scope");
    const changedRun = call("run", "--ci");
    expect(changedRun.code, changedRun.error).toBe(1);
    const changedId = changedRun.body.runId as string;
    const changed = call("memory", "query", changedId);
    expect(changed.code, changed.error).toBe(0);
    expect(changed.body.items[0]).toMatchObject({ match: "needs-revalidation", checkIds: ["original"] });
    expect(changed.body.items[0].reasons).toContain("related-source-changed");
    writeFileSync(join(root, "math.mjs"), "export const add = () => 999; // uncommitted current worktree\n");
    const historical = call("memory", "query", relatedId);
    expect(historical.code, historical.error).toBe(0);
    expect(historical.body.items[0]).toMatchObject({ match: "related", record: { id: memory.id } });

    // Keep the receipt schema-valid and both manifests sealed. Only rebinding
    // its observations to the independent regression run can reject this claim.
    const currentReceipt = JSON.parse(readFileSync(join(artifacts, candidateId, "repair-verification.json"), "utf8"));
    const forged = structuredClone(currentReceipt);
    forged.beforeRegression.executionSource.sourceHash = "f".repeat(64);
    forged.beforeRegression.observedSource.sourceHash = "f".repeat(64);
    for (const id of [candidateId, currentReceipt.beforeRegression.runId]) {
      updateArtifact(join(artifacts, id), "repair-verification.json", forged);
      expect(repository.verify(id).status).toBe("verified");
    }
    const rejected = record(candidateId);
    expect(rejected.code).toBe(2);
    expect(rejected.body.status).not.toBe("retained");
    const afterTamper = call("memory", "query", relatedId);
    expect(afterTamper.code, afterTamper.error).toBe(0);
    expect(afterTamper.body.items).toEqual([]);
    expect(afterTamper.body.skipped).toContainEqual({ id: memory.id, reason: "evidence-unavailable" });
    for (const id of [candidateId, currentReceipt.beforeRegression.runId]) {
      updateArtifact(join(artifacts, id), "repair-verification.json", currentReceipt);
    }
    expect(call("memory", "query", relatedId).body.items[0]).toMatchObject({
      match: "related",
      record: { id: memory.id },
    });

    const revoked = call(
      "memory",
      "revoke",
      memory.id,
      "--actor",
      "fixture",
      "--reason",
      "Retired after reviewing the later failure",
    );
    expect(revoked.code, revoked.error).toBe(0);
    expect(revoked.body.status).toBe("revoked");
    expect(record(candidateId).body).toEqual(revoked.body);
    const afterRevoke = call("memory", "query", relatedId);
    expect(afterRevoke.code, afterRevoke.error).toBe(0);
    expect(afterRevoke.body.items).toEqual([]);
    expect(afterRevoke.body.skipped).toContainEqual({ id: memory.id, reason: "revoked" });

    if (keep) {
      const finalProof = verifyRepair(baselineId, candidateId);
      expect(finalProof.code, finalProof.error).toBe(0);
      const finalMemory = record(candidateId);
      expect(finalMemory.code, finalMemory.error).toBe(0);
      expect(call("memory", "query", relatedId).body.items).toContainEqual(
        expect.objectContaining({ match: "related", record: expect.objectContaining({ id: finalMemory.body.id }) }),
      );
      expect(call("memory", "query", changedId).body.items).toContainEqual(
        expect.objectContaining({
          match: "needs-revalidation",
          record: expect.objectContaining({ id: finalMemory.body.id }),
        }),
      );
      const metadata = {
        root,
        baselineId,
        candidateId,
        relatedId,
        changedId,
        beforeRegressionId: finalProof.body.beforeRegression.runId,
        memoryId: finalMemory.body.id,
      };
      mkdirSync(join(root, ".canary", "qa"), { recursive: true });
      writeFileSync(join(root, ".canary", "qa", "r27.json"), JSON.stringify(metadata, null, 2));
      console.log("R27 real fixture: " + JSON.stringify(metadata));
    }
    completed = true;
  } finally {
    if (!keep || !completed) cleanup();
  }
}, 180_000);
