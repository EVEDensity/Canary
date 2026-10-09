import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  rmSync,
  realpathSync,
  chmodSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeSourceLauncher } from "../source-launcher.mjs";
import { runCommand } from "./command-runner.mjs";

export const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
export function within(root, path) {
  const rel = relative(realpathSync.native(root), realpathSync.native(path));
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
}
export function validateInstallation(root) {
  const cli = join(root, "packages/cli/dist/index.js"),
    version = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
  const result = runCommand(process.execPath, [cli, "version", "--json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, CANARY_HOME: root },
  });
  const payload = result.status === 0 ? JSON.parse(result.stdout) : undefined;
  if (
    !payload ||
    payload.kind !== "canary.version" ||
    payload.v !== 1 ||
    payload.canaryVersion !== version ||
    payload.nodeVersion !== process.versions.node
  )
    throw new Error("Installed CLI version validation failed");
  return { version, cliHash: digest(cli) };
}
/** Publish launcher and registry only after validation, with recoverable previous state. */
function commitInstallation({ root, binDir, metaDir, metadata }) {
  const runtime = validateInstallation(root);
  mkdirSync(binDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });
  const id = randomUUID(),
    stagingBin = join(metaDir, "launcher-" + id),
    backup = join(metaDir, "backups", id),
    state = join(metaDir, "home.json");
  mkdirSync(backup, { recursive: true });
  const names = ["canary-run.mjs", process.platform === "win32" ? "canary.cmd" : "canary"];
  const previous = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : undefined;
  const contents = new Map(
    names.map((name) => [name, existsSync(join(binDir, name)) ? readFileSync(join(binDir, name)) : undefined]),
  );
  const priorState = existsSync(state) ? readFileSync(state) : undefined;
  for (const [name, bytes] of contents) if (bytes) writeFileSync(join(backup, name), bytes);
  if (priorState) writeFileSync(join(backup, "home.json"), priorState);
  try {
    writeSourceLauncher(root, stagingBin, binDir, state);
    for (const name of names) {
      const temporary = join(binDir, name + ".tmp");
      copyFileSync(join(stagingBin, name), temporary);
      renameSync(temporary, join(binDir, name));
    }
    if (process.platform !== "win32") chmodSync(join(binDir, "canary"), 0o755);
    const next = { ...metadata, ...runtime, root, binDir, previous, backupDir: backup };
    writeFileSync(state + ".tmp", JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(state + ".tmp", state);
    const runner = runCommand(process.execPath, [join(binDir, "canary-run.mjs"), "version", "--json"], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (runner.status !== 0 || JSON.parse(runner.stdout).canaryVersion !== next.version)
      throw new Error("Launcher validation failed");
    return next;
  } catch (error) {
    for (const [name, bytes] of contents) {
      const target = join(binDir, name);
      if (bytes) writeFileSync(target, bytes);
      else if (existsSync(target)) rmSync(target);
    }
    if (priorState) writeFileSync(state, priorState);
    else if (existsSync(state)) rmSync(state);
    throw error;
  } finally {
    if (existsSync(stagingBin) && within(metaDir, stagingBin)) rmSync(stagingBin, { recursive: true, force: true });
  }
}
export function publishInstallation(input) {
  mkdirSync(input.metaDir, { recursive: true });
  const lock = join(input.metaDir, "install.lock"),
    fd = openSync(lock, "wx", 0o600);
  try {
    return commitInstallation(input);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
