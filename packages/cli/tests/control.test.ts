import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorizationStore, createAuthorization } from "@canary/policy";
import { ControlPlane } from "@canary/control-plane";
import { controlCommand } from "../src/control.js";
describe("L02 CLI parity", () => {
  it("uses the same version-bound service for status, revision, act and audit", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-cli-control-")),
      config = join(root, "canary.config.ts");
    writeFileSync(config, "export default {};");
    const a = createAuthorization({
      id: "auth",
      subject: "owner",
      projectRoot: root,
      projectIdentity: { kind: "owned", evidence: "fixture" },
      mode: "soft",
      activation: "manual",
      allow: { paths: [], actions: ["loop"] },
      protect: { paths: [] },
      network: { allowHosts: [] },
      tools: { allow: [] },
      envAllowlist: [],
      budget: { maxRounds: 1, maxCost: 1, maxMs: 60000, maxToolCalls: 1 },
    });
    new AuthorizationStore(root).save(a);
    const p = new ControlPlane(root),
      file = join(root, "command.json");
    writeFileSync(
      file,
      JSON.stringify({
        action: "authorization.revoke",
        target: "auth",
        expectedRevision: p.revision("authorization.revoke", "auth"),
        requestId: "cli-test",
        actor: "owner",
        reason: "cli acceptance",
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      e