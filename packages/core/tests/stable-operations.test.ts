import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  CLI_EXIT,
  PROFILE_LIMITS,
  parseImprovementSession,
  projectProfileSchema,
  improvementRecoveryViewSchema,
  qualityContentHash,
} from "../src/index.js";
it("retains the frozen v0.9 prepared and v0.10 interrupted hashes without rewriting legacy records", () => {
  const file = new URL("./fixtures/metadata-v1.json", import.meta.url),
    before = readFileSync(file),
    fixtures = JSON.parse(before.toString("utf8"));
  expect(parseImprovementSession(fixtures.legacyPrepared)).toEqual(fixtures.legacyPrepared);
  const recovered = parseImprovementSession(fixtures.recoveredInterrupted);
  expect(recovered.attempts[0]?.result?.observed).toMatchObject({ cases: null, toolCalls: null, durationMs: null });
  expect(recovered.revision).toBe(3);
  expect(readFileSync(file)).toEqual(before);
  const changed = structuredClone(recovered);
  changed.attempts[0]!.result!.observed.cases = 0;
  expect(() => parseImprovementSession(changed)).toThrow(/hash/);
  changed.contentHash = qualityContentHash(changed);
  expect(parseImprovementSession(changed).attempts[0]?.result?.observed.cases).toBe(0);
});
it("freezes CI exits and explicit read-only operating contracts", () => {
  expect(CLI_EXIT).toEqual({
    success: 0,
    checkFailed: 1,
    configuration: 2,
    interrupted: 3,
    environment: 4,
    artifact: 5,
    policy: 6,
    internal: 10,
  });
  expect(PROFILE_LIMITS).toEqual({
    samples: 5,
    entries: 20000,
    depth: 48,
    sourceFiles: 5000,
    sourceBytes: 67108864,
    artifactBytes: 134217728,
    fileBytes: 16777216,
    elapsedMs: 60000,
  });
  const stages = ["discovery", "structure-build", "evidence-verify", "quality-brief", "project-memory"].map((id) => ({
    id,
    status: "unavailable",
    code: "PROFILE_INPUT_MISSING",
    nextAction: "Select retained evidence",
    consistent: true,
    timingMs: { samples: [], min: null, median: null, max: null },
  }));
  const profile = {
    v: 1,
    kind: "canary.profile",
    runId: "run_fixture",
    requestedSamples: 1,
    readOnly: true,
    executionGranted: false,
    environment: { node: "24.0.0", platform: "fixture", arch: "fixture" },
    limits: PROFILE_LIMITS,
    stages,
    limitations: ["Fixed contract fixture"],
  };
  expect(projectProfileSchema.parse(profile)).toEqual(profile);
  for (const bad of [
    { ...profile, executionGranted: true },
    { ...profile, requestedSamples: 6 },
    { ...profile, stages: stages.slice(1) },
    { ...profile, stages: [...stages].reverse() },
    {
      ...profile,
      stages: [{ ...stages[0], timingMs: { samples: [Number.NaN], min: 0, median: 0, max: 0 } }, ...stages.slice(1)],
    },
  ])
    expect(projectProfileSchema.safeParse(bad).success).toBe(false);
  const recovery = {
    v: 1,
    kind: "canary.improvement-recovery",
    sessionId: "improvement_12345678-1234-4234-8234-123456789012",
    sessionHash: "a".repeat(64),
    planHash: "b".repeat(64),
    revision: 1,
    lockHash: "absent",
    status: "blocked",
    code: "IMPROVEMENT_OWNER_UNKNOWN",
    nextAction: "Preserve ownership evidence",
    executionGranted: false,
  };
  expect(improvementRecoveryViewSchema.parse(recovery)).toEqual(recovery);
  expect(improvementRecoveryViewSchema.safeParse({ ...recovery, executionGranted: true }).success).toBe(false);
});
