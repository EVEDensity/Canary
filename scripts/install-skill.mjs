#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OFFICIAL_SKILL_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../integrations/skills/canary-verify",
);
export const SKILL_STATE_FILE = ".canary-skill.json";
const SKILL_NAME = "canary-verify";
const LIMIT = 1024 * 1024;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const inside = (root, target) => {
  const path = relative(root, target);
  return (
    path !== "" && path !== ".." && !path.startsWith(".." + "/") && !path.startsWith(".." + "\\") && !isAbsolute(path)
  );
};
const packageHash = (files) =>
  digest(JSON.stringify(files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }))));
const problem = (code, message, suggestion, exitCode = 1) =>
  Object.assign(new Error(message), { code, suggestion, exitCode });

/** Check every existing path component, including directory links on Windows. */
function noLinks(path) {
  let current = resolve(path);
  while (true) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat?.isSymbolicLink())
      throw problem(
        "SKILL_LINKED_PATH",
        "Skill paths cannot contain symbolic links or junctions.",
        "Choose a real project directory and a real destination directory.",
      );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function safeFile(path) {
  return (
    typeof path === "string" &&
    path !== SKILL_STATE_FILE &&
    /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}

function collect(root, omitState = false) {
  const files = [];
  const directories = [];
  let total = 0;
  const walk = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix + entry.name;
      if (omitState && path === SKILL_STATE_FILE) continue;
      if (!safeFile(path))
        throw problem(
          "SKILL_PACKAGE_INVALID",
          "Skill package contains an unsupported file path.",
          "Restore the official Skill package from the Canary checkout.",
        );
      const full = join(directory, entry.name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw problem(
          "SKILL_LINKED_PATH",
          "Skill package contains a linked or special file.",
          "Use ordinary files in the Skill package; preserve linked content separately.",
        );
      if (stat.isDirectory()) {
        directories.push(path);
        walk(full, path + "/");
      } else {
        total += stat.size;
        if (total > LIMIT || files.length >= 100)
          throw problem(
            "SKILL_PACKAGE_TOO_LARGE",
            "Skill package exceeds the local delivery limit.",
            "Restore the official package; delivery supports at most 100 files and 1 MiB.",
          );
        const content = readFileSync(full);
        files.push({ path, bytes: content.length, sha256: digest(content), content });
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  files.directories = directories;
  return files;
}

/** Validate the scalar frontmatter used by this self-contained official package. */
export function validateSkillPackage(root = OFFICIAL_SKILL_ROOT) {
  noLinks(root);
  const files = collect(root);
  const entry = files.find((file) => file.path === "SKILL.md");
  const markdown = entry?.content.toString("utf8").replace(/^\uFEFF/, "");
  const frontmatter = markdown?.match(/^---\r?\n([\s\S]+?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter)
    throw problem(
      "SKILL_FORMAT_INVALID",
      "SKILL.md requires YAML frontmatter.",
      "Restore the official SKILL.md before installing.",
    );
  const fields = {};
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^([a-z-]+): (.+)$/);
    if (!match || !["name", "description", "license", "compatibility"].includes(match[1]) || fields[match[1]])
      throw problem(
        "SKILL_FORMAT_INVALID",
        "Official Skill frontmatter has an unsupported or repeated field.",
        "Use name, description and optional license/compatibility scalar fields.",
      );
    let value = match[2];
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw problem(
          "SKILL_FORMAT_INVALID",
          "Skill frontmatter contains an invalid quoted scalar.",
          "Use a valid YAML string for the field.",
        );
      }
    } else if (/[:\[\]{}#\n\r]|^[!&*|>'%@`]/.test(value))
      throw problem(
        "SKILL_FORMAT_INVALID",
        "Skill frontmatter scalar needs quoting.",
        "Quote special characters in YAML fields.",
      );
    if (typeof value !== "string" || !value.trim())
      throw problem(
        "SKILL_FORMAT_INVALID",
        "Skill frontmatter fields must be nonempty strings.",
        "Restore valid Skill metadata.",
      );
    fields[match[1]] = value;
  }
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name ?? "") ||
    fields.name.length > 64 ||
    fields.name !== basename(root)
  )
    throw problem(
      "SKILL_NAME_INVALID",
      "Skill name must match its folder and use lowercase letters, digits and single hyphens (1–64 characters).",
      "Restore the canary-verify directory and matching name.",
    );
  if (
    !fields.description ||
    fields.description.length > 1024 ||
    (fields.compatibility && fields.compatibility.length > 500)
  )
    throw problem(
      "SKILL_FORMAT_INVALID",
      "Skill description or compatibility exceeds the specification limit.",
      "Keep description within 1024 characters and compatibility within 500.",
    );
  for (const file of files.filter((item) => item.path.endsWith(".md"))) {
    for (const match of file.content.toString("utf8").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^https:\/\//.test(target)) continue;
      if (!safeFile(target) || !files.some((item) => item.path === target))
        throw problem(
          "SKILL_REFERENCE_INVALID",
          "Skill references must resolve to bundled files using paths relative to the Skill root.",
          "Restore the missing reference or fix the relative link.",
        );
    }
  }
  return { name: fields.name, description: fields.description, files, packageHash: packageHash(files) };
}

function paths(options) {
  const requestedProject = resolve(options.project ?? process.cwd());
  noLinks(requestedProject);
  if (!existsSync(requestedProject) || !lstatSync(requestedProject).isDirectory())
    throw problem(
      "SKILL_PROJECT_MISSING",
      "The selected project directory does not exist.",
      "Use --project with an existing local project directory.",
      2,
    );
  const project = realpathSync.native(requestedProject);
  const destination = resolve(project, options.dest ?? ".agents/skills/canary-verify");
  const userHome = realpathSync.native(homedir());
  const globalSkillRoots = [".agents/skills", ".codex/skills", ".claude/skills", ".cursor/skills"].map((path) =>
    resolve(userHome, path),
  );
  if (process.env.CODEX_HOME) globalSkillRoots.push(resolve(process.env.CODEX_HOME, "skills"));
  if (project === userHome || globalSkillRoots.some((root) => destination === root || inside(root, destination)))
    throw problem(
      "SKILL_GLOBAL_DESTINATION",
      "Official Skill delivery requires a project directory and preserves global Skill directories.",
      "Run from a project directory, or pass --project with that project's path.",
      2,
    );
  if (
    basename(destination) !== SKILL_NAME ||
    !inside(project, destination) ||
    relative(project, destination)
      .split(/[\\/]/)
      .some((part) => [".git", "node_modules"].includes(part))
  )
    throw problem(
      "SKILL_DESTINATION_INVALID",
      "Skill destination must be a canary-verify directory inside the selected project.",
      "Use the default .agents/skills/canary-verify, or explicitly pass --dest .claude/skills/canary-verify.",
      2,
    );
  noLinks(destination);
  const source = resolve(options.source ?? OFFICIAL_SKILL_ROOT);
  if (source === destination || inside(source, destination) || inside(destination, source))
    throw problem(
      "SKILL_DESTINATION_INVALID",
      "Skill delivery cannot replace or contain its source package.",
      "Choose a separate project Skill destination.",
      2,
    );
  return { project, destination, source };
}

function validateRecords(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 100) return false;
  const unique = new Set();
  let total = 0;
  for (const file of records) {
    if (
      !file ||
      !safeFile(file.path) ||
      unique.has(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      return false;
    unique.add(file.path);
    total += file.bytes;
  }
  return (
    total <= LIMIT &&
    unique.has("SKILL.md") &&
    records.every((file, index) => !index || records[index - 1].path.localeCompare(file.path) < 0)
  );
}

function readOwnedState(context) {
  const stateFile = join(context.destination, SKILL_STATE_FILE);
  if (!existsSync(stateFile))
    throw problem(
      "SKILL_UNMANAGED",
      "Destination exists without a Canary ownership record; it was preserved.",
      "Choose an explicit unused --dest inside the project, or review and move the existing Skill yourself.",
    );
  noLinks(stateFile);
  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    throw problem(
      "SKILL_STATE_INVALID",
      "Canary Skill ownership record is unreadable.",
      "Preserve the destination and recover the original .canary-skill.json before updating or removing it.",
    );
  }
  if (
    state?.kind !== "canary.skill-installation" ||
    state.v !== 1 ||
    state.owner !== "canary" ||
    state.skill !== SKILL_NAME ||
    state.project !== context.project ||
    state.destination !== context.destination ||
    !validateRecords(state.files) ||
    state.packageHash !== packageHash(state.files)
  )
    throw problem(
      "SKILL_STATE_INVALID",
      "Canary Skill ownership or content record is invalid.",
      "Preserve the destination; recover its original ownership record or use a fresh explicit destination.",
    );
  if (
    state.previous &&
    (!validateRecords(state.previous.files) ||
      state.previous.packageHash !== packageHash(state.previous.files) ||
      state.previous.files.some(
        (file) =>
          typeof file.contentBase64 !== "string" ||
          Buffer.from(file.contentBase64, "base64").length !== file.bytes ||
          digest(Buffer.from(file.contentBase64, "base64")) !== file.sha256,
      ))
  )
    throw problem(
      "SKILL_STATE_INVALID",
      "The saved Skill rollback snapshot is invalid.",
      "Preserve the destination and recover its original ownership record.",
    );
  return state;
}

function drift(context, state) {
  const actual = collect(context.destination, true);
  const observed = new Map(actual.map((file) => [file.path, file]));
  const expected = new Map(state.files.map((file) => [file.path, file]));
  const conflicts = [];
  for (const file of state.files) {
    const current = observed.get(file.path);
    if (!current) conflicts.push({ path: file.path, status: "missing" });
    else if (current.sha256 !== file.sha256 || current.bytes !== file.bytes)
      conflicts.push({ path: file.path, status: "modified" });
  }
  for (const file of actual) if (!expected.has(file.path)) conflicts.push({ path: file.path, status: "unmanaged" });
  for (const directory of actual.directories)
    if (!state.files.some((file) => file.path.startsWith(directory + "/")))
      conflicts.push({ path: directory + "/", status: "unmanaged" });
  return { files: actual, conflicts };
}

function removeTemporary(parent, target) {
  noLinks(target);
  if (!inside(realpathSync.native(parent), realpathSync.native(target)))
    throw problem(
      "SKILL_DESTINATION_INVALID",
      "Temporary Skill path escaped its project destination.",
      "Preserve the directory and inspect its resolved path.",
    );
  rmSync(target, { recursive: true });
}

function publish(context, files, previous, beforePublish) {
  const parent = dirname(context.destination);
  const id = randomUUID();
  const staging = join(parent, ".canary-skill-stage-" + id);
  const backup = join(parent, ".canary-skill-backup-" + id);
  const state = {
    kind: "canary.skill-installation",
    v: 1,
    owner: "canary",
    skill: SKILL_NAME,
    project: context.project,
    destination: context.destination,
    installedAt: new Date().toISOString(),
    packageHash: packageHash(files),
    files: files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    ...(previous ? { previous } : {}),
  };
  let moved = false;
  try {
    mkdirSync(staging);
    for (const file of files) {
      const target = join(staging, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { flag: "wx", mode: 0o600 });
    }
    writeFileSync(join(staging, SKILL_STATE_FILE), JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    beforePublish?.();
    noLinks(context.destination);
    if (existsSync(context.destination)) {
      renameSync(context.destination, backup);
      moved = true;
    }
    try {
      renameSync(staging, context.destination);
    } catch (error) {
      if (moved) {
        renameSync(backup, context.destination);
        moved = false;
      }
      throw error;
    }
    if (moved) removeTemporary(parent, backup);
    return state;
  } finally {
    if (existsSync(staging)) removeTemporary(parent, staging);
  }
}

/** All operations are offline and confined to the selected project Skill directory. */
export function installSkill(options = {}) {
  const action = options.action ?? "install";
  if (!["install", "update", "status", "rollback", "remove"].includes(action))
    throw problem("SKILL_ARGUMENT", "Unknown Skill action.", "Use install, update, status, rollback or remove.", 2);
  const context = paths(options);
  const result = (status, extra = {}) => ({
    kind: "canary.skill-delivery",
    v: 1,
    action,
    skill: SKILL_NAME,
    project: context.project,
    destination: context.destination,
    status,
    ...extra,
  });
  const present = existsSync(context.destination);
  if (action === "status" && !present) return result("not-installed");
  if (action !== "install" && action !== "status" && !present)
    throw problem(
      "SKILL_NOT_INSTALLED",
      "No Canary Skill is installed at this destination.",
      "Run skill install with the same --project and --dest first.",
    );
  // Status does not create a parent or lock file.
  if (action === "status") {
    const state = readOwnedState(context),
      observed = drift(context, state);
    return result(observed.conflicts.length ? "modified" : "installed", {
      packageHash: state.packageHash,
      rollbackAvailable: Boolean(state.previous),
      conflicts: observed.conflicts,
    });
  }
  const parent = dirname(context.destination);
  mkdirSync(parent, { recursive: true });
  noLinks(parent);
  const lock = join(parent, ".canary-verify-install.lock");
  let fd;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw problem(
        "SKILL_BUSY",
        "A Skill delivery lock already exists.",
        "Wait for the active operation; if it ended, inspect and remove only this stale .canary-verify-install.lock.",
      );
    throw error;
  }
  try {
    noLinks(context.destination);
    const current = existsSync(context.destination) ? readOwnedState(context) : undefined;
    const observed = current ? drift(context, current) : undefined;
    if (observed?.conflicts.length)
      throw Object.assign(
        problem(
          "SKILL_LOCAL_CHANGES",
          "Installed Skill has local changes or unowned files; all contents were preserved.",
          "Use skill status to inspect conflicts. Save your changes, then restore the recorded contents before update, rollback or remove.",
        ),
        { conflicts: observed.conflicts },
      );
    // Recheck ownership and bytes after staging, immediately before replacing or removing.
    const assertUnchanged = () => {
      noLinks(context.destination);
      if (!current) {
        if (existsSync(context.destination))
          throw problem(
            "SKILL_UNMANAGED",
            "Destination appeared during installation; it was preserved.",
            "Inspect the destination and retry with an unused location.",
          );
      } else if (
        JSON.stringify(readOwnedState(context)) !== JSON.stringify(current) ||
        drift(context, current).conflicts.length
      )
        throw problem(
          "SKILL_LOCAL_CHANGES",
          "Installed Skill changed during delivery; it was preserved.",
          "Inspect skill status and retry only after resolving the local changes.",
        );
    };
    if (action === "remove") {
      assertUnchanged();
      const quarantine = join(parent, ".canary-skill-remove-" + randomUUID());
      renameSync(context.destination, quarantine);
      try {
        removeTemporary(parent, quarantine);
      } catch (error) {
        if (existsSync(quarantine) && !existsSync(context.destination)) renameSync(quarantine, context.destination);
        throw error;
      }
      return result("removed", { packageHash: current.packageHash });
    }
    if (action === "rollback") {
      if (!current.previous)
        throw problem(
          "SKILL_NO_ROLLBACK",
          "No previous Skill package is recorded.",
          "Rollback is available after a successful update; use remove to withdraw the installed package.",
        );
      const files = current.previous.files.map((file) => ({
        ...file,
        content: Buffer.from(file.contentBase64, "base64"),
      }));
      const next = publish(context, files, undefined, assertUnchanged);
      return result("rolled-back", { packageHash: next.packageHash, rollbackAvailable: false });
    }
    const packaged = validateSkillPackage(context.source);
    if (packaged.name !== SKILL_NAME)
      throw problem(
        "SKILL_NAME_INVALID",
        "Delivery requires the official canary-verify package.",
        "Restore the official package in the Canary source installation.",
      );
    if (current?.packageHash === packaged.packageHash)
      return result("unchanged", { packageHash: current.packageHash, rollbackAvailable: Boolean(current.previous) });
    if (current && action === "install")
      throw problem(
        "SKILL_UPDATE_REQUIRED",
        "A different official Skill version is already installed.",
        "Use skill update after reviewing the new Canary checkout.",
      );
    const previous = current
      ? {
          packageHash: current.packageHash,
          files: observed.files.map(({ content, ...file }) => ({ ...file, contentBase64: content.toString("base64") })),
        }
      : undefined;
    const next = publish(context, packaged.files, previous, assertUnchanged);
    return result(current ? "updated" : "installed", {
      packageHash: next.packageHash,
      rollbackAvailable: Boolean(previous),
    });
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

const USAGE =
  "Usage: canary skill install|update|status|rollback|remove [--project <directory>] [--dest <project-relative-directory>] [--json]\nSource checkout: node scripts/install-skill.mjs <action> [same options]";

export function skillInstallerCommand(args, defaults = {}) {
  if (!args.length || (args.length === 1 && ["help", "--help", "-h"].includes(args[0]))) {
    console.log(USAGE);
    return 0;
  }
  const options = { ...defaults, action: args[0] };
  let json = false;
  try {
    const seen = new Set();
    for (let i = 1; i < args.length; i++) {
      const flag = args[i];
      if (seen.has(flag)) throw problem("SKILL_ARGUMENT", "Repeated Skill option.", USAGE, 2);
      seen.add(flag);
      if (flag === "--json") {
        json = true;
        continue;
      }
      if (!["--project", "--dest"].includes(flag) || !args[i + 1] || args[i + 1].startsWith("--"))
        throw problem("SKILL_ARGUMENT", "Invalid or missing Skill option.", USAGE, 2);
      options[flag === "--project" ? "project" : "dest"] = args[++i];
    }
    const payload = installSkill(options);
    console.log(
      json
        ? JSON.stringify(payload)
        : `${payload.status}: ${payload.destination}${payload.conflicts?.length ? "\nConflicts: " + payload.conflicts.map((item) => item.status + " " + item.path).join(", ") : ""}`,
    );
    return payload.status === "modified" ? 1 : 0;
  } catch (error) {
    const payload = {
      kind: "canary.skill-delivery",
      v: 1,
      action: options.action,
      status: "failed",
      code: error.code ?? "SKILL_IO",
      message: error.code?.startsWith("SKILL_")
        ? error.message
        : "Cannot complete Skill delivery; check disk space, permissions and file locks.",
      suggestion: error.suggestion ?? "Preserve the destination and retry after fixing the local filesystem issue.",
      ...(error.conflicts ? { conflicts: error.conflicts } : {}),
    };
    if (json || args.includes("--json")) console.log(JSON.stringify(payload));
    else console.error(`${payload.code}: ${payload.message}\n${payload.suggestion}`);
    return error.exitCode ?? 1;
  }
}

if (
  process.argv[1] &&
  realpathSync.native(resolve(process.argv[1])) === realpathSync.native(fileURLToPath(import.meta.url))
)
  process.exitCode = skillInstallerCommand(process.argv.slice(2));
