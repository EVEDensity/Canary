#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const builtBin = join(root, "packages/cli/dist/index.js");
if (!existsSync(builtBin)) throw new Error("Build @canary/cli before verifying pack");
const shebang = readFileSync(builtBin, "utf8").split(/\r?\n/, 1)[0];
if (!shebang.startsWith("#!/usr/bin/env node")) throw new Error(`built bin missing node shebang: ${shebang}`);
const help = execFileSync(process.execPath, [builtBin, "help"], { encoding: "utf8", cwd: root });
if (!help.includes("Usage: canary")) throw new Error("built bin did not print CLI usage");

const dir = mkdtempSync(join(tmpdir(), "canary-pack-"));
try {
  execFileSync("pnpm", ["--filter", "@canary/cli", "pack", "--pack-destination", dir], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const tarball = readdirSync(dir).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack did not produce a tarball");
  const extract = join(dir, "extract");
  mkdirSync(extract);
  execFileSync("tar", ["-xzf", join(dir, tarball), "-C", extract], { stdio: "inherit", shell: process.platform === "win32" });
  const pkgRoot = existsSync(join(extract, "package")) ? join(extract, "package") : extract;
  const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  if (manifest.private) throw new Error("@canary/cli tarball is still private");
  if (!manifest.bin?.canary) throw new Error("@canary/cli tarball is missing bin.canary");
  const packedBin = join(pkgRoot, manifest.bin.canary);
  if (!existsSync(packedBin)) throw new Error(`packed bin missing: ${manifest.bin.canary}`);
  const packedShebang = readFileSync(packedBin, "utf8").split(/\r?\n/, 1)[0];
  if (!packedShebang.startsWith("#!/usr/bin/env node")) throw new Error(`packed bin missing node shebang: ${packedShebang}`);
  console.log(`pack ok: ${tarball} · private=${Boolean(manifest.private)} · bin=${manifest.bin.canary}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
