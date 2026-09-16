import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { killProcessTree, pidAlive, waitForExit, PROCESS_ADAPTER } from "../src/index.js";

describe("process tree adapter", () => {
  it("kills a descendant worker and records the platform adapter", async () => {
    expect(PROCESS_ADAPTER.platform).toBe(process.platform);
    const child = spawn(process.execPath, ["-e", "const {spawn}=require('child_process'); const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); process.stdout.write(String(g.pid)); setInterval(()=>{},1000)"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const grandchildPid = await new Promise<number>((resolve, reject) => {
      let buf = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        buf += chunk;
        const pid = Number(buf.trim());
        if (pid > 0) resolve(pid);
      });
      child.once("error", reject);
      setTimeout(() => reject(new Error("did not receive grandchild pid")), 4_000);
    });
    expect(child.pid).toBeTruthy();
    expect(pidAlive(grandchildPid)).toBe(true);
    killProcessTree(child.pid!);
    expect(await waitForExit(child.pid!, 5_000)).toBe(true);
    expect(await waitForExit(grandchildPid, 5_000)).toBe(true);
  }, 15_000);

  it("treats missing pids as not alive", () => {
    expect(pidAlive(0)).toBe(false);
  });
});
