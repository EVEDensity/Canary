import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pidAlive } from "@canary/runner";
import { configurationSupervisorSource, loadBoundedConfiguration } from "../src/bounded-config.js";

const roots: string[] = [],
  children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((done) => child.once("close", () => done()));
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) {
    const target = resolve(root),
      scope = relative(realpathSync.native(tmpdir()), target);
    if (!scope || scope.startsWith("..") || !target.includes("canary-bounded-config-"))
      throw new Error("Unexpected test cleanup scope");
    rmSync(target, { recursive: true, force: true });
  }
});
function configuration(source: string, extension = "mjs") {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-bounded-config-")));
  roots.push(root);
  const file = join(root, `canary.config.${extension}`);
  writeFileSync(file, source);
  return { root, file };
}
const signal = () => new AbortController().signal;
const pause = () => new Promise<void>((done) => setTimeout(done, 20));
async function until(predicate: () => boolean, maximumMs = 3000) {
  const deadline = Date.now() + maximumMs;
  while (!predicate() && Date.now() < deadline) await pause();
  expect(predicate()).toBe(true);
}
function supervisor(file: string, maximumMs: number) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", configurationSupervisorSource(file, "test-configuration", maximumMs)],
    {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  children.push(child);
  const closed = new Promise<number | null>((done) => child.once("exit", done));
  return { child, closed };
}

describe("bounded executable configuration supervisor", () => {
  it.each(["mjs", "ts"])(
    "loads JSON-safe %s configuration in a real isolated Worker",
    async (extension) => {
      const { file } = configuration(
        extension === "ts"
          ? "const value: number = 3;export default {agent:{adapter:'function'},value};"
          : "export default {agent:{adapter:'function'},value:3};",
        extension,
      );
      await expect(loadBoundedConfiguration(file, signal(), 5000)).resolves.toEqual({
        agent: { adapter: "function" },
        value: 3,
      });
    },
    10_000,
  );

  it("returns a bounded JSON default wrapper and suppresses configuration logs", async () => {
    const { file } = configuration("console.log('private configuration log');export default {default:{value:'ok'}};");
    await expect(loadBoundedConfiguration(file, signal(), 5000)).resolves.toEqual({ value: "ok" });
  });

  it("terminates a busy-loop Worker within the declared execution duration", async () => {
    const { file } = configuration("while(true){};export default {};");
    const started = Date.now();
    await expect(loadBoundedConfiguration(file, signal(), 350)).rejects.toThrow(/bounded/);
    expect(Date.now() - started).toBeLessThan(4000);
  }, 7000);

  it("enforces the supervisor deadline even without a caller-side cancellation timer", async () => {
    const { file } = configuration("while(true){};export default {};");
    const { child, closed } = supervisor(file, 350);
    expect(await closed).not.toBe(0);
    expect(pidAlive(child.pid!)).toBe(false);
  }, 7000);

  it("stops when worker output exceeds its budget before the time budget expires", async () => {
    const { file } = configuration("process.stdout.write('x'.repeat(300000));while(true){};export default {};");
    const started = Date.now();
    await expect(loadBoundedConfiguration(file, signal(), 7000)).rejects.toThrow(/bounded/);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("does not accept oversized output merely because a JSON result is posted afterwards", async () => {
    const { file } = configuration("process.stdout.write('x'.repeat(300000));export default {value:'ok'};");
    await expect(loadBoundedConfiguration(file, signal(), 5000)).rejects.toThrow(/bounded/);
  }, 7000);

  it("rejects Worker exit without a result instead of holding the attempt until timeout", async () => {
    const { file } = configuration("process.exit(0);export default {};");
    const started = Date.now();
    await expect(loadBoundedConfiguration(file, signal(), 7000)).rejects.toThrow(/bounded/);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("does not expose executable configuration exceptions or oversized JSON", async () => {
    const thrown = configuration("throw Error('private-config-exception');export default {};");
    await expect(loadBoundedConfiguration(thrown.file, signal(), 5000)).rejects.not.toThrow("private-config-exception");
    const oversized = configuration("export default {value:'x'.repeat(1048576)};");
    await expect(loadBoundedConfiguration(oversized.file, signal(), 5000)).rejects.toThrow(/bounded/);
  }, 12_000);

  it("cancels an already busy configuration without executing further work", async () => {
    const { root, file } = configuration("export default {}"),
      startedFile = join(root, "started.json");
    writeFileSync(
      file,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(startedFile)},'started');while(true){};export default {};`,
    );
    const controller = new AbortController(),
      pending = loadBoundedConfiguration(file, controller.signal, 7000);
    await until(() => existsSync(startedFile));
    controller.abort();
    await expect(pending).rejects.toThrow(/bounded/);
  }, 10_000);

  it("exits its own busy supervisor when the parent's IPC channel disconnects", async () => {
    const { root, file } = configuration("export default {}"),
      startedFile = join(root, "started.json");
    writeFileSync(
      file,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(startedFile)},'started');while(true){};export default {};`,
    );
    const { child, closed } = supervisor(file, 7000);
    await until(() => existsSync(startedFile));
    const disconnectedAt = Date.now();
    child.disconnect();
    expect(await closed).not.toBe(0);
    expect(Date.now() - disconnectedAt).toBeLessThan(3000);
    expect(pidAlive(child.pid!)).toBe(false);
  }, 10_000);

  it("exits after its real parent dies even while configuration is in a busy loop", async () => {
    const { root, file } = configuration("export default {}"),
      startedFile = join(root, "started.json");
    writeFileSync(
      file,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(startedFile)},'started');while(true){};export default {};`,
    );
    const script = `import {spawn} from 'node:child_process';const child=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(configurationSupervisorSource(file, "test-parent-death", 7000))}],{detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});process.send({pid:child.pid});setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ["--input-type=module", "-e", script], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    children.push(parent);
    const pid = await new Promise<number>((accept, reject) => {
      parent.once("error", reject);
      parent.once("message", (value) => accept((value as { pid: number }).pid));
    });
    await until(() => existsSync(startedFile));
    const exited = new Promise<void>((done) => parent.once("close", () => done()));
    parent.kill("SIGKILL");
    await exited;
    // The PID is observed only: no recovery or cleanup signal is ever sent to this persisted value.
    await until(() => !pidAlive(pid), 3000);
  }, 12_000);

  it("rejects invalid timing and cancellation before executable code is imported", async () => {
    const { file } = configuration("export default {};");
    const controller = new AbortController();
    controller.abort();
    await expect(loadBoundedConfiguration(file, controller.signal, 5000)).rejects.toThrow(/cancelled/);
    await expect(loadBoundedConfiguration(file, signal(), Number.NaN)).rejects.toThrow(/finite positive/);
  });
});
