#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { verifyRuntimeManifest } from "./lib/runtime-manifest.mjs";

try {
  const state = join(resolve(process.env.CANARY_INSTALL_HOME ?? join(homedir(), ".canary")), "home.json");
  if (statSync(state).size > 1024 * 1024) throw new Error();
  const metadata = JSON.parse(readFileSync(state, "utf8"));
  if (!isAbsolute(metadata.root) || !metadata.runtimeManifestHash) throw new Error();
  const integrity = verifyRuntimeManifest(metadata.root, metadata);
  console.log(
    JSON.stringify({
      kind: "canary.installation-verification",
      v: 1,
      status: "valid",
      scope: "runtime-tree",
      version: metadata.version,
      commit: metadata.commit ?? metadata.ref,
      ...integrity,
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      kind: "canary.installation-verification",
      v: 1,
      status: "unavailable",
      error: "Runtime inventory is missing or changed; rerun the installer to create a verified installation",
    }),
  );
  process.exitCode = 4;
}
