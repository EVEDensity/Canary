import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const repositoryRoot = resolve(import.meta.dirname, "../..");
export function newLogDirectory(category, root = repositoryRoot) {
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(category)) throw new Error("Invalid log category");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = join(root, ".canary/logs", category, id);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** Reports are local by default; exporting reviewable evidence is explicit. */
export function evidenceOutput(stage, filename, override) {
  const output = override
    ? resolve(override)
    : join(process.env.CANARY_LOG_DIR || newLogDirectory(`verification/${stage}`), filename);
  mkdirSync(dirname(output), { recursive: true });
  return output;
}
