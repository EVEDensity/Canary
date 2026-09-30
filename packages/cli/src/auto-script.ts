import { spawn } from "node:child_process";

// A separate process supplies CI mode and package-manager lifecycle semantics on every platform.
const [manager, script] = process.argv.slice(2);
if (!manager || !["npm", "pnpm", "yarn", "bun"].includes(manager) || !script || !/^[A-Za-z0-9_.:-]+$/.test(script)) {
  console.error("Invalid automatic script selection");
  process.exit(2);
}
const env = { ...process.env, CI: "true" };
const child =
  process.platform === "win32"
    ? spawn(process.env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", `${manager} run ${script}`], {
        env,
        stdio: "inherit",
        windowsHide: true,
      })
    : spawn(manager, ["run", script], { env, stdio: "inherit" });
child.on("error", () => {
  console.error(`Package manager ${manager} is unavailable. Prepare this project's dependencies and runtime.`);
  process.exitCode = 4;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 3 : (code ?? 4);
});
