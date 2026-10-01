import { describe, expect, it } from "vitest";
import { diagnosticSnapshot, pathsSnapshot, versionSnapshot } from "../src/diagnostics.js";
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorSnapshotSchema, pathsSnapshotSchema, versionSnapshotSchema } from "@canary/core";

const project = mkdtempSync(join(tmpdir(), "canary diagnostic project "));
afterAll(() => rmSync(project, { recursive: true, force: true }));

describe("diagnostics", () => {
  it("reports roots and local-first exporter state", async () => {
    const d = await diagnosticSnapshot(project);
    expect(d.localFirst).toBe(true);
    expect((d.exporter as { enabled: boolean }).enabled).toBe(false);
    expect(d).toHaveProperty("invocationRoot");
    expect(d).toHaveProperty("artifactRoot");
    expect(d.issues.some((issue) => issue.code === "CONFIG_NOT_FOUND")).toBe(true);
    expect(d.exitCode).toBe(2);
    expect(d.issues.every((issue) => issue.suggestion.length > 0)).toBe(true);
    doctorSnapshotSchema.parse(d);
  });

  it("keeps paths and version on the frozen v1 schemas", () => {
    pathsSnapshotSchema.parse(pathsSnapshot(project));
    versionSnapshotSchema.parse(versionSnapshot());
  });
});
