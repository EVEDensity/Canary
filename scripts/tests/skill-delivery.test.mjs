import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installSkill, OFFICIAL_SKILL_ROOT, SKILL_STATE_FILE, validateSkillPackage } from "../install-skill.mjs";

const script = fileURLToPath(new URL("../install-skill.mjs", import.meta.url));
function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-skill-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project"),
    source = join(root, "source", "canary-verify");
  mkdirSync(project);
  cpSync(OFFICIAL_SKILL_ROOT, source, { recursive: true });
  return { root, project, source, destination: join(project, ".agents/skills/canary-verify") };
}
function code(value) {
  return (error) => error.code === value;
}

test("official package validates specification metadata and resolves each bundled reference", () => {
  const skill = validateSkillPackage();
  assert.equal(skill.name, "canary-verify");
  assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
  assert.ok(skill.files.some((file) => file.path === "references/reproduction.md"));
  assert.ok(skill.files.some((file) => file.path === "LICENSE"));
  assert.ok(skill.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test("fresh install, repeat, explicit update, rollback and removal exercise real package bytes", (t) => {
  const f = fixture(t);
  assert.equal(installSkill({ ...f, action: "status" }).status, "not-installed");
  assert.ok(!existsSync(join(f.project, ".agents")));
  const original = readFileSync(join(f.source, "SKILL.md"));
  const installed = installSkill(f);
  assert.equal(installed.status, "installed");
  assert.deepEqual(readFileSync(join(f.destination, "SKILL.md")), original);
  const stateFile = join(f.destination, SKILL_STATE_FILE),
    firstState = readFileSync(stateFile);
  assert.equal(installSkill(f).status, "unchanged");
  assert.deepEqual(readFileSync(stateFile), firstState);
  const changed = Buffer.concat([original, Buffer.from("\nApply only the current project task.\n")]);
  writeFileSync(join(f.source, "SKILL.md"), changed);
  assert.throws(() => installSkill(f), code("SKILL_UPDATE_REQUIRED"));
  assert.deepEqual(readFileSync(join(f.destination, "SKILL.md")), original);
  const updated = installSkill({ ...f, action: "update" });
  assert.equal(updated.status, "updated");
  assert.notEqual(updated.packageHash, installed.packageHash);
  assert.deepEqual(readFileSync(join(f.destination, "SKILL.md")), changed);
  assert.equal(installSkill({ ...f, action: "status" }).rollbackAvailable, true);
  const rolled = installSkill({ ...f, action: "rollback" });
  assert.equal(rolled.packageHash, installed.packageHash);
  assert.deepEqual(readFileSync(join(f.destination, "SKILL.md")), original);
  assert.throws(() => installSkill({ ...f, action: "rollback" }), code("SKILL_NO_ROLLBACK"));
  assert.equal(installSkill({ ...f, action: "remove" }).status, "removed");
  assert.ok(!existsSync(f.destination));
});

test("unowned Skills, local edits, extra files and extra empty directories survive mutations", (t) => {
  const f = fixture(t);
  mkdirSync(f.destination, { recursive: true });
  const entry = join(f.destination, "SKILL.md");
  writeFileSync(entry, "user-owned Skill\n");
  assert.throws(() => installSkill(f), code("SKILL_UNMANAGED"));
  assert.equal(readFileSync(entry, "utf8"), "user-owned Skill\n");
  rmSync(f.destination, { recursive: true });
  installSkill(f);
  const original = readFileSync(entry);
  writeFileSync(entry, "local customization\n");
  for (const action of ["install", "update", "rollback", "remove"])
    assert.throws(() => installSkill({ ...f, action }), code("SKILL_LOCAL_CHANGES"));
  assert.equal(readFileSync(entry, "utf8"), "local customization\n");
  assert.deepEqual(installSkill({ ...f, action: "status" }).conflicts, [{ path: "SKILL.md", status: "modified" }]);
  writeFileSync(entry, original);
  writeFileSync(join(f.destination, "personal.md"), "preserve me");
  assert.throws(() => installSkill({ ...f, action: "remove" }), code("SKILL_LOCAL_CHANGES"));
  assert.equal(readFileSync(join(f.destination, "personal.md"), "utf8"), "preserve me");
  rmSync(join(f.destination, "personal.md"));
  mkdirSync(join(f.destination, "personal"));
  assert.throws(() => installSkill({ ...f, action: "update" }), code("SKILL_LOCAL_CHANGES"));
  assert.ok(existsSync(join(f.destination, "personal")));
});

test("invalid source metadata and missing references leave an installed package intact", (t) => {
  const f = fixture(t);
  installSkill(f);
  const before = readFileSync(join(f.destination, "SKILL.md"));
  const sourceEntry = join(f.source, "SKILL.md");
  for (const name of ["Canary", "canary--verify", "canary-verify-", "-canary-verify", "a".repeat(65)]) {
    writeFileSync(sourceEntry, before.toString().replace("name: canary-verify", "name: " + name));
    assert.throws(() => installSkill({ ...f, action: "update" }), code("SKILL_NAME_INVALID"));
    assert.deepEqual(readFileSync(join(f.destination, "SKILL.md")), before);
  }
  writeFileSync(sourceEntry, before.toString().replace("references/checks.md", "references/missing.md"));
  assert.throws(() => installSkill({ ...f, action: "update" }), code("SKILL_REFERENCE_INVALID"));
  writeFileSync(sourceEntry, before);
  writeFileSync(
    sourceEntry,
    before.toString().replace(/description: [^\n]+/, "description: " + '"' + "x".repeat(1025) + '"'),
  );
  assert.throws(() => installSkill({ ...f, action: "update" }), code("SKILL_FORMAT_INVALID"));
  assert.deepEqual(readFileSync(join(f.destination, "SKILL.md")), before);
});

test("explicit destination remains in the project and linked directories are preserved", (t) => {
  const f = fixture(t),
    alternate = ".claude/skills/canary-verify";
  assert.equal(installSkill({ ...f, dest: alternate }).destination, resolve(f.project, alternate));
  assert.throws(() => installSkill({ ...f, dest: "../global/canary-verify" }), code("SKILL_DESTINATION_INVALID"));
  assert.throws(() => installSkill({ ...f, dest: ".agents/skills" }), code("SKILL_DESTINATION_INVALID"));
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.md"), "outside project");
  symlinkSync(outside, join(f.project, ".agents"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => installSkill(f), code("SKILL_LINKED_PATH"));
  assert.equal(readFileSync(join(outside, "keep.md"), "utf8"), "outside project");
});

test("the user home and configured global Skill directories are never installation targets", (t) => {
  const f = fixture(t);
  assert.throws(() => installSkill({ ...f, project: homedir() }), code("SKILL_GLOBAL_DESTINATION"));
  const prior = process.env.CODEX_HOME;
  process.env.CODEX_HOME = f.project;
  try {
    assert.throws(() => installSkill({ ...f, dest: "skills/canary-verify" }), code("SKILL_GLOBAL_DESTINATION"));
    assert.ok(!existsSync(join(f.project, "skills")));
  } finally {
    if (prior === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prior;
  }
});

test("CLI needs only Node and reports actual conflicts and missing arguments", (t) => {
  const f = fixture(t);
  const invoke = (...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: f.project, encoding: "utf8", windowsHide: true });
  let output = invoke("install", "--json");
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).status, "installed");
  assert.equal(invoke("install", "--json").status, 0);
  writeFileSync(join(f.destination, "SKILL.md"), "local edits\n");
  output = invoke("remove", "--json");
  assert.equal(output.status, 1);
  assert.equal(JSON.parse(output.stdout).code, "SKILL_LOCAL_CHANGES");
  assert.equal(readFileSync(join(f.destination, "SKILL.md"), "utf8"), "local edits\n");
  output = invoke("install", "--project", "--json");
  assert.equal(output.status, 2);
  assert.equal(JSON.parse(output.stdout).code, "SKILL_ARGUMENT");
  assert.equal(invoke("status", "--project", f.project, "--project", f.project).status, 2);
});

test("invalid ownership and corrupt rollback records block updates without touching content", (t) => {
  const f = fixture(t);
  installSkill(f);
  const entry = join(f.destination, "SKILL.md"),
    before = readFileSync(entry);
  writeFileSync(join(f.source, "SKILL.md"), before.toString() + "\nUpdated guidance.\n");
  installSkill({ ...f, action: "update" });
  const stateFile = join(f.destination, SKILL_STATE_FILE),
    state = JSON.parse(readFileSync(stateFile));
  const after = readFileSync(entry);
  state.previous.files[0].contentBase64 = Buffer.from("corrupt").toString("base64");
  writeFileSync(stateFile, JSON.stringify(state));
  assert.throws(() => installSkill({ ...f, action: "rollback" }), code("SKILL_STATE_INVALID"));
  assert.deepEqual(readFileSync(entry), after);
  state.owner = "user";
  writeFileSync(stateFile, JSON.stringify(state));
  assert.throws(() => installSkill({ ...f, action: "remove" }), code("SKILL_STATE_INVALID"));
  assert.deepEqual(readFileSync(entry), after);
});

test("a concurrent delivery lock blocks installation and preserves the competing lock", (t) => {
  const f = fixture(t),
    parent = join(f.project, ".agents/skills");
  mkdirSync(parent, { recursive: true });
  const lock = join(parent, ".canary-verify-install.lock");
  writeFileSync(lock, "another operation");
  assert.throws(() => installSkill(f), code("SKILL_BUSY"));
  assert.equal(readFileSync(lock, "utf8"), "another operation");
  assert.ok(!existsSync(f.destination));
});

test("draft metadata normalizes empty and non-ASCII keys and safely quotes real check IDs", () => {
  const helper = fileURLToPath(new URL("../../packages/cli/src/skill.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { buildSkillDraftMetadata } from ${JSON.stringify(pathToFileURL(helper).href)}; const results = ["中文", "---", "a-".repeat(40), "Build: Scope"].map(key => buildSkillDraftMetadata({key,contentHash:"a".repeat(64),checkId:"test: [unit] # selected"})); console.log(JSON.stringify(results));`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  for (const value of JSON.parse(result.stdout)) {
    assert.match(value.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(value.name.length <= 64);
    assert.ok(value.description.includes("test: [unit] # selected"));
    assert.equal(JSON.parse(value.frontmatter.split("\n")[2].slice("description: ".length)), value.description);
  }
});
