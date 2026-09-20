import { describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactIntegrityError,
  ArtifactPrivacyError,
  FileArtifactRepository,
  atomicWrite,
  beginArtifacts,
  containsSensitiveText,
  planRetention,
  applyRetention,
  recoverTraceTail,
  redactValue,
  sealArtifacts,
  sha256,
  verifyArtifacts,
  writePrivateJson,
} from "../src/index.js";

function fixture(
  id = "run_test",
  root = mkdtempSync(join(tmpdir(), "canary-r3-artifacts-")),
  lineage = {},
  startedAt = "2026-01-01T00:00:00.000Z",
) {
  const dir = join(root, id);
  beginArtifacts(dir, lineage);
  writePrivateJson(join(dir, "run.json"), {
    runId: id,
    status: "completed",
    startedAt,
    totalCases: 0,
    completedCases: 0,
    passedCases: 0,
    results: [],
    events: [],
    evidence: { v: 1, lineage },
  });
  return { root, dir, id };
}

describe("R3 artifact evidence", () => {
  it("seals exact bytes and keeps content-addressed manifest revisions for derived writes", () => {
    const { dir, root, id } = fixture();
    expect(verifyArtifacts(dir).status).toBe("partial");
    const manifest = sealArtifacts(dir);
    expect(manifest.files[0]?.sha256).toBe(sha256(readFileSync(join(dir, "run.json"))));
    const before = verifyArtifacts(dir);
    expect(before.status).toBe("verified");
    new FileArtifactRepository(root).writeJson(id, "comparison.json", { decision: "keep" });
    const after = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(after.previousManifestHash).toBe(before.manifestHash);
    expect(after.revision).toBe(before.revision! + 1);
    expect(verifyArtifacts(dir).status).toBe("verified");
  });

  it.each(["changed", "missing", "truncated", "extra", "manifest-missing", "manifest-truncated", "history"])(
    "rejects %s evidence without re-blessing it",
    (fault) => {
      const { dir, root, id } = fixture();
      sealArtifacts(dir);
      if (fault === "changed")
        writeFileSync(
          join(dir, "run.json"),
          readFileSync(join(dir, "run.json"), "utf8").replace("completed", "cancelled"),
        );
      if (fault === "missing") unlinkSync(join(dir, "run.json"));
      if (fault === "truncated") writeFileSync(join(dir, "run.json"), '{"runId":');
      if (fault === "extra") writeFileSync(join(dir, "unknown.txt"), "unlisted");
      if (fault === "manifest-missing") unlinkSync(join(dir, "manifest.json"));
      if (fault === "manifest-truncated") writeFileSync(join(dir, "manifest.json"), '{"v":');
      if (fault === "history") {
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        writeFileSync(join(dir, "manifest-history", `${manifest.previousManifestHash}.json`), "{}");
      }
      expect(verifyArtifacts(dir).status).toBe("invalid");
      expect(() => new FileArtifactRepository(root).readRun(id)).toThrow(ArtifactIntegrityError);
      expect(() => new FileArtifactRepository(root).writeJson(id, "comparison.json", {})).toThrow(
        ArtifactIntegrityError,
      );
      expect(() => sealArtifacts(dir)).toThrow(ArtifactIntegrityError);
      expect(existsSync(join(dir, "comparison.json"))).toBe(false);
    },
  );

  it("reads legacy runs but never labels them verified", () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r3-legacy-"));
    const dir = join(root, "old");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        runId: "old",
        status: "completed",
        startedAt: "2026-01-01",
        totalCases: 0,
        completedCases: 0,
        passedCases: 0,
        results: [],
        events: [],
      }),
    );
    const repository = new FileArtifactRepository(root);
    expect(repository.verify("old").status).toBe("legacy");
    expect(repository.readRun("old")?.runId).toBe("old");
    expect(() => repository.readRun("../outside")).toThrow();
  });

  it("preserves the old snapshot when a replacement fails", () => {
    const { dir } = fixture();
    const before = readFileSync(join(dir, "run.json"), "utf8");
    mkdirSync(join(dir, "blocked.json"));
    expect(() => atomicWrite(join(dir, "blocked.json"), "{}")).toThrow();
    expect(readFileSync(join(dir, "run.json"), "utf8")).toBe(before);
  });

  it("repairs only an incomplete trailing JSONL record and records its byte hashes", () => {
    const { dir } = fixture();
    const good = '{"v":1,"type":"completed"}\n';
    const tail = '{"type":"par';
    writeFileSync(join(dir, "trace.jsonl"), good + tail);
    const repair = recoverTraceTail(dir);
    expect(repair?.originalHash).toBe(sha256(good + tail));
    expect(repair?.removedHash).toBe(sha256(tail));
    expect(repair?.removedBytes).toBe(Buffer.byteLength(tail));
    expect(readFileSync(join(dir, "trace.jsonl"), "utf8")).toBe(good);
    appendFileSync(join(dir, "trace.jsonl"), 'invalid\n{"type":"later"}\n');
    expect(() => recoverTraceTail(dir)).toThrow(ArtifactIntegrityError);
  });

  it("redacts known secret values in unrelated fields and detects recognizable unlabelled credentials", () => {
    const value = {
      apiKey: "opaque-value-123",
      echo: "opaque-value-123",
      nested: { message: "Bearer fake-credential-123", raw: "ghp_abcdefghijklmnop" },
      improvements: [{ reason: "password=hunter22" }],
    };
    const text = JSON.stringify(redactValue(value));
    for (const secret of ["opaque-value-123", "fake-credential-123", "ghp_abcdefghijklmnop", "hunter22"])
      expect(text).not.toContain(secret);
    expect(containsSensitiveText(text)).toBe(false);
    expect(redactValue({ tool: "get_token_count", output: "token count is 12" })).toEqual({
      tool: "get_token_count",
      output: "token count is 12",
    });
    const { dir } = fixture();
    writeFileSync(join(dir, "unsafe.txt"), "Bearer fake-credential-123");
    expect(() => sealArtifacts(dir)).toThrow(ArtifactPrivacyError);
    expect(verifyArtifacts(dir).status).toBe("partial");
    expect(readFileSync(join(dir, "unsafe.txt"), "utf8")).not.toContain("fake-credential-123");
    expect(existsSync(join(dir, "privacy-findings.json"))).toBe(true);
  });

  it("does not seal an unfinished atomic write or an unsafe keyed JSON value", () => {
    const { dir } = fixture();
    writeFileSync(join(dir, "run.json.pending.tmp"), '{"partial":');
    expect(() => sealArtifacts(dir)).toThrow(ArtifactIntegrityError);
    unlinkSync(join(dir, "run.json.pending.tmp"));
    writeFileSync(
      join(dir, "unsafe.json"),
      JSON.stringify({ apiKey: "opaque-fixture-key", echo: "opaque-fixture-key" }),
    );
    expect(() => sealArtifacts(dir)).toThrow(ArtifactPrivacyError);
    expect(readFileSync(join(dir, "unsafe.json"), "utf8")).not.toContain("opaque-fixture-key");
  });

  it("previews retention, protects lineage ancestors and legacy evidence, and removes only eligible runs", () => {
    const { root, dir } = fixture("parent");
    sealArtifacts(dir);
    const child = fixture("child", root, { replayOf: "parent" }, "2026-02-01T00:00:00.000Z");
    sealArtifacts(child.dir);
    const obsolete = fixture("obsolete", root, {}, "2025-01-01T00:00:00.000Z");
    sealArtifacts(obsolete.dir);
    const plan = planRetention(root, { maxRuns: 1 });
    expect(plan.candidates).toEqual(["obsolete"]);
    expect(plan.protectedRuns).toContain("parent");
    expect(plan.withinBudget).toBe(false);
    expect(existsSync(obsolete.dir)).toBe(true);
    expect(applyRetention(root, plan)).toEqual(["obsolete"]);
    expect(existsSync(child.dir)).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });
});
