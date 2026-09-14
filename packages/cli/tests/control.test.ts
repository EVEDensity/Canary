import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorizationStore, createAuthorization } from "@canary/policy";
import { ControlPlane } from "@canary/control-plane";
import { controlCommand } from "../src/control.js";
describe("L02 CLI parity", () => {
  it("uses the same version-bound service for status, revision, act and audit", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-cli