import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { beginArtifacts, sealArtifacts, writePrivateJson, verifyArtifacts } from "@canary/trace";
import { archiveCommand } from "../src/archive.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const scope = relative(realpathSync.native(tmpdir()), root);
    if (!scope.startsWith("canary-archive-cli-")) throw Error("Unexpected cleanup scope");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-archive-cli-")));
  roots.push(project);
  writeFileSync(join(project, "package.json"), '{"private":true}');
  writeFileSync(join(project, "canary.config.ts"), "throw new Error('archive must not import project code');");
  const root = join(project, ".canary", "artifacts");
  beginArtifacts(join(root, "run_fixture"));
  writePrivateJson(join(root, "run_fixture", "run.json"), {
    runId: "run_fixture",
    status: "completed",
    startedAt: "2026-10-18T00:00:00Z",
    totalCases: 0,
    completedCases: 0,
    passedCases: 0,
    results: [],
    events: [],
  });
  sealArtifacts(join(root, "run_fixture"));
  return { project, root, target: join(project, ".canary", "archives", "first") };
}
it("routes preview, hash-bound rotate/show/restore across project directories without importing executable configuration", () => {
  const f = fixture(),
    log = vi.spyOn(console, "log").mockImplementation(() => {}),
    before = readFileSync(join(f.root, "run_fixture", "manifest.json")),
    base = ["--project", f.project, "--json"];
  expect(archiveCommand(["create", f.target, "--rotate", ...base])).toBe(0);
  const plan = JSON.parse(log.mock.calls.at(-1)![0]);
  expect(plan).toMatchObject({ action: "create", mode: "rotate", executionGranted: false });
  expect(readFileSync(join(f.root, "run_fixture", "manifest.json"))).toEqual(before);
  expect(
    archiveCommand([
      "create",
      f.target,
      "--rotate",
      ...base,
      "--apply",
      "--plan-hash",
      plan.contentHash,
      "--actor",
      "maintainer",
      "--reason",
      "Preserve the full evidence collection",
    ]),
  ).toBe(0);
  expect(readdirSync(f.root)).toEqual([]);
  expect(archiveCommand(["show", f.target, ...base])).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).kind).toBe("canary.evidence-archive");
  expect(archiveCommand(["restore", f.target, ...base])).toBe(0);
  const restore = JSON.parse(log.mock.calls.at(-1)![0]);
  expect(
    archiveCommand([
      "restore",
      f.target,
      ...base,
      "--apply",
      "--plan-hash",
      restore.contentHash,
      "--actor",
      "maintainer",
      "--reason",
      "Restore reviewed evidence",
    ]),
  ).toBe(0);
  expect(readFileSync(join(f.root, "run_fixture", "manifest.json"))).toEqual(before);
  expect(verifyArtifacts(join(f.root, "run_fixture")).status).toBe("verified");
});
it("rejects missing authority and invalid flags without moving source records", () => {
  const f = fixture();
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const args of [
    ["create", f.target, "--apply"],
    ["restore", f.target, "--rotate"],
    ["show", f.target, "--apply"],
    ["create", f.target, "--json", "--json"],
    ["recover", "--apply"],
  ])
    expect(archiveCommand([...args, "--project", f.project, "--json"])).toBe(2);
  expect(readdirSync(f.root)).toEqual(["run_fixture"]);
});
it("previews collection recovery without changing or executing project code", () => {
  const f = fixture();
  mkdirSync(join(f.project, "nested"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(archiveCommand(["recover", "--project", f.project, "--json"])).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({
    kind: "canary.collection-recovery-plan",
    locks: [],
    executionGranted: false,
  });
});
