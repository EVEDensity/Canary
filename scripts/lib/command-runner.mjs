import { spawnSync } from "node:child_process";
import { delimiter, dirname, join, basename } from "node:path";
import { existsSync } from "node:fs";

/** Execute argv without shell concatenation, including Windows npm/pnpm launchers. */
export function commandInvocation(command, args, env = process.env, platform = process.platform) {
  if (platform !== "win32" || !["npm", "pnpm", "yarn"].includes(command)) return { command, args };
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const directories = [...path.split(platform === "win32" ? ";" : delimiter), dirname(process.execPath)];
  for (const dir of directories) {
    const executable = join(dir, command + ".exe");
    if (existsSync(executable)) return { command: executable, args };
    const launcher = join(dir, command + ".cmd");
    if (!existsSync(launcher)) continue;
    const script =
      command === "npm"
        ? join(dir, "node_modules/npm/bin/npm-cli.js")
        : command === "pnpm"
          ? [join(dir, "node_modules/pnpm/bin/pnpm.cjs"), join(dir, "node_modules/corepack/dist/pnpm.js")].find(
              existsSync,
            )
          : [join(dir, "node_modules/yarn/bin/yarn.js"), join(dir, "node_modules/corepack/dist/yarn.js")].find(
              existsSync,
            );
    if (script && existsSync(script)) return { command: process.execPath, args: [script, ...args] };
  }
  throw new Error(
    `Cannot resolve a native ${basename(command)} runtime; install npm or the pinned package-manager runtime`,
  );
}
export function runCommand(command, args, options = {}) {
  const invocation = commandInvocation(command, args, options.env ?? process.env);
  return spawnSync(invocation.command, invocation.args, { windowsHide: true, ...options, shell: false });
}
