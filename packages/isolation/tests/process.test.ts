import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { killProcessTree, pidAlive, waitForExit, PROCESS_ADAPTER } from "../src/index.js";

describe("process tree adapter", () => {
  it("kills a descendant worker and records the platform adapter", async () => {
    expect(PROCESS_ADAPTER.platform).toBe(process.platform);
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('child_process'); const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); process.stdout.write(String(g.pid)+'\\n'); setInterval(()=>{},1000)",
      ],
      {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        detached: PROCESS_ADAPTER.usesProcessGroups,
      },
    );
    let grandchildPid: number | undefined;
    try {
      grandchildPid = await new Promise<number>((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(() => reject(new Error("did not receive grandchild pid")), 4_000);
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          buf += chunk;
          if (!buf.includes("\n")) return;
          const pid = Number(buf.trim());
          if (pid > 0) {
            clearTimeout(timer);
            resolve(pid);
          }
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      expect(child.pid).toBeTruthy();
      expect(pidAlive(grandchildPid)).toBe(true);
      killProcessTree(child.pid!);
      expect(await waitForExit(child.pid!, 5_000)).toBe(true);
      expect(await waitForExit(grandchildPid, 5_000)).toBe(true);
    } finally {
      if (child.pid) killProcessTree(child.pid);
      if (grandchildPid) killProcessTree(grandchildPid);
    }
  }, 15_000);

  it("treats missing pids as not alive", () => {
    expect(pidAlive(0)).toBe(false);
  });
});
