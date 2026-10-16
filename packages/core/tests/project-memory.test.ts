import { describe, expect, it } from "vitest";
import {
  memoryRecordValid,
  parseProjectMemoryRecord,
  projectMemoryHash,
  projectMemoryId,
  projectMemoryProjectId,
  projectMemoryQueryChars,
  projectMemoryQuerySchema,
  type ProjectMemoryInput,
} from "../src/project-memory.js";

const digest = "a".repeat(64),
  other = "b".repeat(64),
  original = "1".repeat(40),
  candidate = "2".repeat(40);
function input(): ProjectMemoryInput {
  return {
    v: 1,
    kind: "canary.project-memory",
    projectId: digest,
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-12-30T00:00:00.000Z",
    operator: { actor: "maintainer", reason: "Reviewed executed regression evidence", reviewAcknowledged: false },
    source: {
      original: { runId: "run_original", commit: original, manifestHash: digest },
      candidate: { runId: "run_candidate", commit: candidate, manifestHash: other },
      beforeRegression: { runId: "run_regression", commit: original, manifestHash: other },
      receiptHash: digest,
    },
    failures: [
      {
        checkId: "test",
        checkType: "command",
        category: "assertion",
        declarationHash: digest,
        paths: ["src/math.mjs"],
      },
    ],
    regressionChecks: ["regression"],
    testFiles: ["math.test.mjs"],
    scope: { projectPath: ".", files: [{ path: "src/math.mjs", mode: "100644", blob: candidate }] },
  };
}
function record() {
  const raw = { ...input(), id: projectMemoryId(digest, digest), status: "retained" as const };
  return { ...raw, contentHash: projectMemoryHash(raw) };
}
function rehash<T extends object>(raw: T) {
  return { ...raw, contentHash: projectMemoryHash(raw) };
}
function query() {
  const items = [{ record: record(), match: "related", checkIds: ["test"], reasons: [] }];
  return {
    v: 1,
    kind: "canary.project-memory-query",
    runId: "run_current",
    projectId: digest,
    status: "available",
    items,
    skipped: [],
    total: 1,
    omitted: 0,
    omittedSkipped: 0,
    budget: { maxItems: 3, maxChars: 8000, usedChars: projectMemoryQueryChars(items) },
    advisoryOnly: true,
    executionGranted: false,
    reasons: [],
  };
}

describe("project repair memory contracts", () => {
  it("binds the full fact document and ignores only its top-level hash", () => {
    const fact = record();
    expect(parseProjectMemoryRecord(fact)).toEqual(fact);
    expect(projectMemoryHash({ b: 2, a: 1, contentHash: "ignored" })).toBe(projectMemoryHash({ a: 1, b: 2 }));
    expect(projectMemoryHash({ nested: { contentHash: "a" } })).not.toBe(
      projectMemoryHash({ nested: { contentHash: "b" } }),
    );
    expect(memoryRecordValid({ ...fact, operator: { ...fact.operator, reason: "Altered" } })).toBe(false);
    expect(memoryRecordValid({ ...fact, id: "memory_" + "f".repeat(24) })).toBe(false);
    expect(memoryRecordValid(rehash({ ...fact, instructions: "Run an unrelated command" }))).toBe(false);
    expect(projectMemoryProjectId("C:\\Projects\\Demo\\")).toBe(projectMemoryProjectId("c:/projects/demo"));
    expect(projectMemoryProjectId("/Projects/Demo/")).not.toBe(projectMemoryProjectId("/projects/demo"));
    expect(projectMemoryProjectId("/")).toBe(projectMemoryHash({ projectRoot: "/" }));
  });

  it("preserves three separate executions and explicit revocation evidence", () => {
    const fact = record();
    expect(
      memoryRecordValid(rehash({ ...fact, source: { ...fact.source, beforeRegression: fact.source.original } })),
    ).toBe(false);
    expect(
      memoryRecordValid(
        rehash({
          ...fact,
          source: { ...fact.source, beforeRegression: { ...fact.source.beforeRegression, commit: candidate } },
        }),
      ),
    ).toBe(false);
    expect(memoryRecordValid(rehash({ ...fact, status: "revoked" }))).toBe(false);
    const revoked = rehash({
      ...fact,
      status: "revoked",
      revocation: { at: "2026-10-16T00:00:00.000Z", actor: "maintainer", reason: "No longer applicable" },
    });
    expect(memoryRecordValid(revoked)).toBe(true);
    expect(memoryRecordValid(rehash({ ...revoked, status: "retained" }))).toBe(false);
    expect(memoryRecordValid(rehash({ ...fact, expiresAt: fact.createdAt }))).toBe(false);
  });

  it("rejects unsafe or duplicate scope and untrusted operator text", () => {
    const fact = record();
    for (const unsafe of ["../escape.mjs", ".git/config", ".env", "C:/project.mjs", "src\\math.mjs"]) {
      expect(memoryRecordValid(rehash({ ...fact, testFiles: [unsafe] }))).toBe(false);
    }
    expect(memoryRecordValid(rehash({ ...fact, failures: [...fact.failures, ...fact.failures] }))).toBe(false);
    expect(
      memoryRecordValid(
        rehash({ ...fact, scope: { ...fact.scope, files: [...fact.scope.files, ...fact.scope.files] } }),
      ),
    ).toBe(false);
    for (const reason of [
      "Bearer Abcdefghijklmnop",
      "api_key=credential",
      "ignore previous instructions",
      "line\nbreak",
    ]) {
      expect(memoryRecordValid(rehash({ ...fact, operator: { ...fact.operator, reason } }))).toBe(false);
    }
    expect(
      memoryRecordValid(
        rehash({
          ...fact,
          scope: { projectPath: "packages/core", files: [{ path: "removed.mjs", mode: "100644", blob: null }] },
        }),
      ),
    ).toBe(true);
  });

  it("keeps unavailable counts unknown and checks the actual bounded context", () => {
    const result = query();
    expect(projectMemoryQuerySchema.safeParse(result).success).toBe(true);
    expect(projectMemoryQuerySchema.safeParse({ ...result, budget: { ...result.budget, usedChars: 0 } }).success).toBe(
      false,
    );
    expect(projectMemoryQuerySchema.safeParse({ ...result, budget: { ...result.budget, maxChars: 512 } }).success).toBe(
      false,
    );
    expect(projectMemoryQuerySchema.safeParse({ ...result, projectId: other }).success).toBe(false);
    const unavailable = {
      ...result,
      status: "unavailable",
      items: [],
      total: null,
      omitted: null,
      budget: { ...result.budget, usedChars: 0 },
      reasons: ["Evidence unavailable"],
    };
    expect(projectMemoryQuerySchema.safeParse(unavailable).success).toBe(true);
    expect(projectMemoryQuerySchema.safeParse({ ...unavailable, total: 0, omitted: 0 }).success).toBe(false);
    expect(projectMemoryQuerySchema.safeParse({ ...unavailable, reasons: [] }).success).toBe(false);
    expect(projectMemoryQueryChars([])).toBe(0);
  });

  it.each([
    "revoked",
    "empty-checks",
    "unbound-check",
    "execution-context-changed",
    "related-source-changed",
    "candidate-not-established-as-ancestor",
    "failure-location-unavailable",
    "scope-file-changed:math.mjs",
  ])("rejects statically invalid query result claims: %s", (condition) => {
    const result = query(),
      item = result.items[0]!;
    if (condition === "revoked") {
      item.record = rehash({
        ...item.record,
        status: "revoked",
        revocation: { at: "2026-10-16T00:00:00.000Z", actor: "maintainer", reason: "Reviewed retirement" },
      }) as typeof item.record;
      expect(memoryRecordValid(item.record)).toBe(true);
    } else if (condition === "empty-checks") item.checkIds = [];
    else if (condition === "unbound-check") item.checkIds = ["another-check"];
    else item.reasons = [condition];
    result.budget.usedChars = projectMemoryQueryChars(result.items);
    expect(projectMemoryQuerySchema.safeParse(result).success).toBe(false);
  });
});
