#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./lib/command-runner.mjs";
import { publishInstallation, validateInstallation, digest } from "./lib/install-state.mjs";
const metaDir = resolve(process.env.CANARY_INSTALL_HOME ?? join(homedir(), ".canary")),
  state = join(metaDir, "home.json");
try {
  if (process.argv.slice(2).some((arg) => arg !== "--rollback")) throw new Error("Use upgrade-global.mjs [--rollback]");
  const current = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : undefined;
  if (process.argv.includes("--rollback")) {
    const previous = current?.previous;
    if (
      !previous?.root ||
      !previous.cliHash ||
      digest(join(previous.root, "packages/cli/dist/index.js")) !== previous.cliHash
    )
      throw new Error("Verified previous installation is unavailable; active installation was retained");
    validateInstallation(previous.root);
    const metadata = publishInstallation({ root: previous.root, binDir: current.binDir, metaDir, metadata: previous });
    console.log(
      JSON.stringify({ status: "rolled-back", version: metadata.version, commit: metadata.commit ?? metadata.ref }),
    );
  } else {
    const source = process.env.CANARY_SOURCE ?? "https://github.com/EVEDensity/Canary.git";
    if (/^https?:/.test(source) && (new URL(source).username || new URL(source).password))
      throw new Error("Use external credential injection, not credentials in the clone URL");
    const bootstrap = join(metaDir, "sources", randomUUID());
    mkdirSync(join(metaDir, "sources"), { recursive: true });
    const clone = runCommand("git", ["clone", "--branch", "main", "--", source, bootstrap], { stdio: "inherit" });
    if (clone.status !== 0) throw new Error("Upgrade source is unavailable; active installation was retained");
    const channel =
      process.env.CANARY_CHANNEL ?? (["stable", "main"].includes(current?.channel) ? current.channel : "stable");
    const install = runCommand(process.execPath, [join(bootstrap, "scripts/install-global.mjs")], {
      stdio: "inherit",
      env: { ...process.env, CANARY_CHANNEL: channel, CANARY_BIN_DIR: process.env.CANARY_BIN_DIR ?? current?.binDir },
    });
    if (install.status !== 0) throw new Error("Upgrade validation failed; active installation was retained");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
