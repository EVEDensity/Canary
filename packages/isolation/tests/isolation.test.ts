import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyDenied, defaultPolicy } from "@canary/policy";
import { PROCESS_BOUNDARY, assertIsolationReady, buildIsolatedEnv, probeIsolation, requiredMode, runIsolatedScript } from "../src/index.js";

function isolatedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "canary-iso-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "cases"), { recursive: true });
  mkdirSync(join(root, ".canary", "policy"), { recursive: true });
  writeFileSync(join(root, "src", "ok.js"), "ok");
  writeFileSync(join(root, "cases", "holdout.ts"), "hidden");
  writeFileSync(join(root, ".canary", "policy", "policy.json"), "{}");
  return root;
}

describe("isolation capability and process boundary", () => {
  it("documents which processes are inside versus outside the sandbox", () => {
    expect(PROCESS_BOUNDARY.insideSandbox.join(" ")).toMatch(/candidate/);
    expect(PROCESS_BOUNDARY.outsideSandbox).toEqual(expect.arrayContaining(["CLI", "policy engine", "isolation supervisor"]));
    expect(PROCESS_BOUNDARY.notASandbox.join(" ")).toMatch(/worktree|child_process|MCP/);
    const cap = probeIsolation();
    expect(cap.userspace).toBe(true);
    expect(cap.notes.some((note) => note.includes("not an OS"))).toBe(true);
    expect(requiredMode("trusted_eval")).toBe("none");
    expect(requiredMode("untrusted_candidate")).toBe("userspace");
  }, 15_000);

  it("fail-closes auto hard write when OS isolation is required and missing", () => {
    const root = isolatedWorkspace();
    const policy = defaultPolicy(root);
    policy.isolation.osRequiredForAutoHard = true;
    const cap = probeIsolation();
    if (!cap.os) {
      expect(() => assertIsolationReady({ purpose: "auto_hard_write", workspace: root, policy })).toThrow(PolicyDenied);
    } else {
      expect(assertIsolationReady({ purpose: "auto_hard_write", workspace: root, policy }).os).toBe(true);
    }
  }, 15_000);

  it("does not inherit secret environment variables", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-secret";
    try {
      const env = buildIsolatedEnv();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.NODE_OPTIONS).toBe("");
      expect(env.PATH ?? env.Path).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});

describe("userspace isolation rejects real attacks", () => {
  it("blocks parent reads, protected files, env secrets, unauthorized network, and spawn", async () => {
    const root = isolatedWorkspace();
    const policy = defaultPolicy(root);
    const secretEnv = "CANARY_TEST_SECRET_TOKEN";
    process.env[secretEnv] = "leaked";
    const result = await runIsolatedScript({ purpose: "untrusted_candidate", workspace: root, policy, extraEnv: { [secretEnv]: "should-not-pass" } }, `
      const fs = require("fs");
      const path = require("path");
      const failures = [];
      try { fs.readFileSync(path.join(process.cwd(), "..", "nope.txt")); failures.push("parent"); } catch (error) { if (!String(error.message).includes("workspace")) failures.push("parent-miss:" + error.message); }
      try { fs.readFileSync(path.join(process.cwd(), "cases", "holdout.ts")); failures.push("holdout"); } catch {}
      if (process.env.${secretEnv} || process.env.OPENAI_API_KEY) failures.push("env");
      try { require("child_process").spawn(process.execPath, ["-e", "1"]); failures.push("spawn"); } catch {}
      try { fetch("https://example.invalid"); failures.push("net"); } catch {}
      if (failures.length) { console.log("UNEXPECTED:" + failures.join(",")); process.exit(2); }
      console.log("denied-ok");
    `);
    delete process.env[secretEnv];
    expect(result.stderr + result.stdout, JSON.stringify({ code: result.exitCode, stderr: result.stderr, stdout: result.stdout, denials: result.denials })).toContain("denied-ok");
    expect(result.exitCode).toBe(0);
  }, 20_000);

  it("blocks a hard link into the protected holdout file", async () => {
    const root = isolatedWorkspace();
    const alias = join(root, "src", "alias-holdout.ts");
    linkSync(join(root, "cases", "holdout.ts"), alias);
    const policy = defaultPolicy(root);
    const result = await runIsolatedScript({ purpose: "untrusted_candidate", workspace: root, policy }, `
      const fs = require("fs");
      try { fs.readFileSync("src/alias-holdout.ts", "utf8"); console.log("READ_ALIAS"); process.exit(2); }
      catch (error) { console.log("denied"); process.exit(0); }
    `);
    expect(result.stdout).toContain("denied");
    expect(result.exitCode).toBe(0);
  }, 20_000);
});
