import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./command-runner.mjs";
import { publishInstallation, validateInstallation, digest } from "./install-state.mjs";
import { OFFICIAL_SOURCE, compareVersions, resolveStableRelease } from "./release-source.mjs";
import { verifyRuntimeManifest } from "./runtime-manifest.mjs";

function readInstallation(state) {
  if (!existsSync(state)) return undefined;
  try {
    if (statSync(state).size > 1024 * 1024) throw new Error();
    const current = JSON.parse(readFileSync(state, "utf8"));
    if (!current || typeof current !== "object" || !isAbsolute(current.root) || !isAbsolute(current.binDir))
      throw new Error();
    return current;
  } catch {
    throw new Error("Installation registration is invalid; rerun the installer before upgrading");
  }
}

function verifyRegistered(current) {
  if (current.runtimeManifestHash) verifyRuntimeManifest(current.root, current);
  else if (!current.cliHash || digest(join(current.root, "packages/cli/dist/index.js")) !== current.cliHash)
    throw new Error("Registered runtime changed; active installation was retained");
  const actual = validateInstallation(current.root);
  if (actual.version !== current.version)
    throw new Error("Registered runtime version changed; active installation was retained");
}

/** Read-only planning preserves pinned and development channel intent. */
export function upgradeStatus(current, release, channel) {
  if (!current) return "not-installed";
  if (channel !== "stable") return channel === "main" ? "development" : "pinned";
  const order = compareVersions(current.version, release.version);
  if (order > 0) return "ahead";
  if (order < 0) return "update-available";
  return (current.commit ?? current.ref) === release.commit ? "up-to-date" : "version-conflict";
}

/** Injectable dependencies support offline tests; environment cannot redirect the release API. */
export async function upgradeInstallation({
  args = [],
  env = process.env,
  resolveRelease = resolveStableRelease,
  run = runCommand,
  write = console.log,
} = {}) {
  if (
    args.some((arg) => !["--rollback", "--check", "--json"].includes(arg)) ||
    new Set(args).size !== args.length ||
    (args.includes("--rollback") && args.length !== 1) ||
    (args.includes("--json") && !args.includes("--check"))
  )
    throw new Error("Use canary upgrade [--check [--json] | --rollback]");
  const metaDir = resolve(env.CANARY_INSTALL_HOME ?? join(homedir(), ".canary"));
  const current = readInstallation(join(metaDir, "home.json"));
  if (args.includes("--rollback")) {
    if (!current?.previous?.root)
      throw new Error("Verified previous installation is unavailable; active installation was retained");
    verifyRegistered(current.previous);
    const metadata = publishInstallation({
      root: current.previous.root,
      binDir: current.binDir,
      metaDir,
      metadata: current.previous,
    });
    write(
      JSON.stringify({ status: "rolled-back", version: metadata.version, commit: metadata.commit ?? metadata.ref }),
    );
    return;
  }
  const channel = env.CANARY_REF?.trim() ? "pinned" : (env.CANARY_CHANNEL ?? current?.channel ?? "stable");
  if (!env.CANARY_REF?.trim() && env.CANARY_CHANNEL && !["stable", "main"].includes(env.CANARY_CHANNEL))
    throw new Error("CANARY_CHANNEL must be stable or main");
  const source = env.CANARY_SOURCE ?? OFFICIAL_SOURCE;
  const official =
    /^(?:https:\/\/github\.com\/EVEDensity\/Canary(?:\.git)?|git@github\.com:EVEDensity\/Canary(?:\.git)?)$/i.test(
      source,
    );
  if (/^https?:/.test(source) && (new URL(source).username || new URL(source).password))
    throw new Error("Use external credential injection, not credentials in the clone URL");
  let release;
  if (official && (channel === "stable" || args.includes("--check"))) release = await resolveRelease();
  else if (channel === "stable" || args.includes("--check"))
    throw new Error(
      "Stable release checks require the official GitHub source; choose an explicit ref or main channel for another source",
    );
  if (args.includes("--check")) {
    const status = upgradeStatus(current, release, channel);
    const result = {
      kind: "canary.upgrade-check",
      v: 1,
      status,
      channel,
      current: current ? { version: current.version, commit: current.commit ?? current.ref } : null,
      latest: release,
      updateAvailable: status === "update-available",
      mutation: false,
    };
    write(
      args.includes("--json")
        ? JSON.stringify(result)
        : `Canary update check: ${status}\nInstalled: ${current?.version ?? "not registered"} (${channel})\nLatest release: ${release.tag}\n${release.url}`,
    );
    return;
  }
  if (!current) throw new Error("No registered installation; use the installation command first");
  if (channel !== "stable" && channel !== "main" && !env.CANARY_REF?.trim())
    throw new Error("Installation is pinned; set CANARY_REF or CANARY_CHANNEL=stable/main explicitly to change it");
  if (release) {
    const status = upgradeStatus(current, release, channel);
    if (status === "ahead" || status === "version-conflict")
      throw new Error(
        "Stable upgrade would downgrade or replace the same version with another commit; choose an explicit CANARY_REF to proceed",
      );
    if (status === "up-to-date") {
      verifyRegistered(current);
      write(JSON.stringify({ status: "unchanged", version: current.version, commit: release.commit }));
      return;
    }
  }
  const bootstrap = join(metaDir, "sources", randomUUID());
  mkdirSync(join(metaDir, "sources"), { recursive: true });
  const clone = run("git", ["clone", "--branch", "main", "--", source, bootstrap], {
    stdio: "inherit",
    timeout: 600000,
  });
  if (clone.status !== 0) throw new Error("Upgrade source is unavailable; active installation was retained");
  const install = run(process.execPath, ["--use-system-ca", join(bootstrap, "scripts/install-global.mjs")], {
    stdio: "inherit",
    timeout: 600000,
    env: {
      ...env,
      CANARY_CHANNEL: channel === "pinned" ? "stable" : channel,
      CANARY_BIN_DIR: env.CANARY_BIN_DIR ?? current.binDir,
    },
  });
  if (install.status !== 0) throw new Error("Upgrade validation failed; active installation was retained");
}
