import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { ExperienceStore } from "../src/index.js";

const worker = fileURLToPath(new URL("./storage-worker.ts", import.meta.url));
function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "canary-experience-storage-"));
  const storeRoot = join(projectRoot, ".canary", "experiences");
  const store = new ExperienceStore(storeRoot);
  const propose = (content = "Keep checks deterministic.", key = "safe") => store.propose({ key, projectRoot, source: { kind: "human" }, summary: content, content });
  return { projectRoot, storeRoot, store, propose };
}
function startWorker(storeRoot: string, mode: string, argument = "", fault?: string) {
  const child = spawn(process.execPath, ["--import", "tsx", worker, storeRoot, mode, argument, ...(fault ? [fault] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed };
}
function recordPath(storeRoot: string, id: string) { return join(storeRoot, "records", `${id}.json`); }
function diskPointer(storeRoot: string) { return JSON.parse(readFileSync(join(storeRoot, "active.json"), "utf8")); }

describe("durable experience storage", () => {
  it("rejects torn and invalid records on reads and writes without replacing them", () => {
    const { storeRoot, store, propose } = fixture();
    const record = propose();
    for (const invalid of ['{"v":1,"id":', JSON.stringify({ ...record, v: 2 }), JSON.stringify({ ...record, scope: null }), "null"]) {
      writeFileSync(recordPath(storeRoot, record.id), invalid);
      expect(() => store.get(record.id)).toThrow(/Corrupt experience/);
      expect(() => store.list()).toThrow(/Corrupt experience/);
      expect(() => propose("A new check.")).toThrow(/Corrupt experience/);
      expect(() => store.clear(record.projectRoot)).toThrow(/Corrupt experience/);
      expect(readFileSync(recordPath(storeRoot, record.id), "utf8")).toBe(invalid);
    }
    expect(() => store.get("../outside")).toThrow(/identifier/);
  });

  it("rejects a corrupt pointer rather than treating it as an empty store", () => {
    const { projectRoot, storeRoot, store, propose } = fixture();
    const record = propose();
    store.transition(record.id, "validated");
    for (const invalid of ['{"v":1,"entries":', JSON.stringify({ v: 1, projectRoot, entries: "empty", updatedAt: new Date().toISOString() })]) {
      writeFileSync(join(storeRoot, "active.json"), invalid);
      expect(() => store.activePointer(projectRoot)).toThrow(/Corrupt experience/);
      expect(() => store.load({ projectRoot })).toThrow(/Corrupt experience/);
      expect(() => store.activate(record.id)).toThrow(/Corrupt experience/);
      expect(() => store.clear(projectRoot)).toThrow(/Corrupt experience/);
      expect(() => propose("A new check.")).toThrow(/Corrupt experience/);
      expect(store.get(record.id)?.status).toBe("validated");
      expect(readFileSync(join(storeRoot, "active.json"), "utf8")).toBe(invalid);
    }
  });

  it("rejects a corrupt or unsafe journal before replaying any file", () => {
    const { storeRoot, propose } = fixture();
    const record = propose();
    const before = readFileSync(recordPath(storeRoot, record.id), "utf8");
    const writes = [{ file: `records/${record.id}.json`, value: { ...record, status: "revoked" } }, { file: "../outside.json", value: record }];
    const journal = { v: 1, writes, hash: createHash("sha256").update(JSON.stringify(writes)).digest("hex") };
    for (const invalid of ['{"v":1,"writes":', JSON.stringify(journal), JSON.stringify({ ...journal, writes: writes.slice(0, 1), hash: "0".repeat(64) })]) {
      writeFileSync(join(storeRoot, "transaction.json"), invalid);
      expect(() => new ExperienceStore(storeRoot)).toThrow(/Corrupt experience/);
      expect(readFileSync(recordPath(storeRoot, record.id), "utf8")).toBe(before);
      expect(readFileSync(join(storeRoot, "transaction.json"), "utf8")).toBe(invalid);
    }
  });

  it("preserves the prior activation when killed halfway through writing the journal", async () => {
    const { projectRoot, storeRoot, store, propose } = fixture();
    const old = propose(); store.transition(old.id, "validated"); store.activate(old.id);
    const next = propose("Keep fixtures focused."); store.transition(next.id, "validated");
    const crashed = await startWorker(storeRoot, "activate", next.id, "journal-half-write").completed;
    expect(crashed.code).not.toBe(0);
    expect(crashed.stderr).toBe("");
    expect(existsSync(join(storeRoot, "transaction.json"))).toBe(false);
    expect(readdirSync(storeRoot).some((name) => name.startsWith("transaction.json.") && name.endsWith(".tmp"))).toBe(true);
    const recovered = new ExperienceStore(storeRoot);
    expect(recovered.load({ projectRoot }).loaded.map((item) => item.id)).toEqual([old.id]);
    expect(recovered.get(old.id)?.status).toBe("active");
    expect(recovered.get(next.id)?.status).toBe("validated");
    expect(readdirSync(join(storeRoot, ".write-locks"))).toEqual([]);
  }, 20_000);

  it.each(["after-record", "record-half-write"])("completes activation after an actual process crash: %s", async (fault) => {
    const { projectRoot, storeRoot, store, propose } = fixture();
    const old = propose(); store.transition(old.id, "validated"); store.activate(old.id);
    const next = propose("Keep fixtures focused."); store.transition(next.id, "validated");
    const crashed = await startWorker(storeRoot, "activate", next.id, fault).completed;
    expect(crashed.code).not.toBe(0);
    expect(crashed.stderr).toBe("");
    expect(existsSync(join(storeRoot, "transaction.json"))).toBe(true);
    expect(diskPointer(storeRoot).entries[0].id).toBe(old.id);
    if (fault === "record-half-write") expect(() => JSON.parse(readFileSync(recordPath(storeRoot, next.id), "utf8"))).toThrow();
    const recovered = new ExperienceStore(storeRoot);
    expect(recovered.get(old.id)?.status).toBe("expired");
    expect(recovered.get(next.id)?.status).toBe("active");
    expect(recovered.load({ projectRoot }).loaded.map((item) => item.id)).toEqual([next.id]);
    expect(existsSync(join(storeRoot, "transaction.json"))).toBe(false);
    expect(readdirSync(join(storeRoot, ".write-locks"))).toEqual([]);
    expect(new ExperienceStore(storeRoot).load({ projectRoot }).loaded.map((item) => item.id)).toEqual([next.id]);
  }, 20_000);

  it.each(["revoke", "clear", "restore"])("recovers the record and pointer together after a crash during %s", async (mode) => {
    const { projectRoot, storeRoot, store, propose } = fixture();
    const old = propose(); store.transition(old.id, "validated"); store.activate(old.id);
    const saved = store.activePointer(projectRoot);
    let activeId = old.id;
    if (mode === "restore") {
      const next = propose("Keep fixtures focused."); store.transition(next.id, "validated"); store.activate(next.id);
      activeId = next.id;
      writeFileSync(join(storeRoot, "saved-pointer.json"), JSON.stringify(saved));
    }
    const crashed = await startWorker(storeRoot, mode, activeId, "after-record").completed;
    expect(crashed.code).not.toBe(0);
    expect(crashed.stderr).toBe("");
    expect(diskPointer(storeRoot).entries[0].id).toBe(activeId);
    const recovered = new ExperienceStore(storeRoot);
    if (mode === "restore") {
      expect(recovered.get(old.id)?.status).toBe("active");
      expect(recovered.get(activeId)?.status).toBe("validated");
      expect(recovered.load({ projectRoot }).loaded.map((item) => item.id)).toEqual([old.id]);
    } else {
      expect(recovered.get(old.id)?.status).toBe(mode === "revoke" ? "revoked" : "validated");
      expect(recovered.activePointer(projectRoot).entries).toEqual([]);
    }
    expect(existsSync(join(storeRoot, "transaction.json"))).toBe(false);
  }, 20_000);

  it("allocates unique consecutive versions and retains every concurrent activation", async () => {
    const { projectRoot, storeRoot, store } = fixture();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => startWorker(storeRoot, "concurrent", `${index}`).completed));
    for (const result of results) { expect(result.stderr).toBe(""); expect(result.code).toBe(0); }
    expect(store.list().filter((record) => record.key === "serial").map((record) => record.version).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(store.activePointer(projectRoot).entries).toHaveLength(6);
    expect(store.load({ projectRoot }).loaded).toHaveLength(6);
    expect(readdirSync(join(storeRoot, ".write-locks"))).toEqual([]);
  }, 40_000);

  it("deduplicates identical proposals across processes", async () => {
    const { storeRoot, store } = fixture();
    const results = await Promise.all(Array.from({ length: 4 }, () => startWorker(storeRoot, "dedupe").completed));
    for (const result of results) { expect(result.stderr).toBe(""); expect(result.code).toBe(0); }
    expect(new Set(results.map((result) => result.stdout)).size).toBe(1);
    expect(store.list()).toHaveLength(1);
  }, 30_000);

  it("waits for a live lock owner and refuses malformed lock metadata", async () => {
    const { storeRoot, store } = fixture();
    const { child, completed } = startWorker(storeRoot, "hold");
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
    const started = Date.now();
    expect(store.list()).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect((await completed).code).toBe(0);
    const file = join(storeRoot, ".write-locks", `${process.pid}-${randomUUID()}.json`);
    writeFileSync(file, '{"pid":');
    expect(() => store.list()).toThrow(/Corrupt experience/);
    expect(readFileSync(file, "utf8")).toBe('{"pid":');
  }, 20_000);

  it("restores only matching, reviewed records and demotes displaced active records", () => {
    const { projectRoot, store, propose } = fixture();
    const old = propose(); store.transition(old.id, "validated"); store.activate(old.id);
    const saved = store.activePointer(projectRoot);
    const next = propose("Keep fixtures focused."); store.transition(next.id, "validated"); store.activate(next.id);
    store.restorePointer(saved);
    expect(store.get(old.id)?.status).toBe("active");
    expect(store.get(next.id)?.status).toBe("validated");
    expect(() => store.restorePointer({ ...saved, entries: [{ ...saved.entries[0]!, contentHash: "f".repeat(64) }] })).toThrow(/cannot restore/);
    store.revoke(old.id);
    expect(() => store.restorePointer(saved)).toThrow(/cannot restore/);
    const proposed = propose("Use explicit review.", "unreviewed");
    expect(() => store.restorePointer({ ...saved, entries: [{ id: proposed.id, key: proposed.key, version: proposed.version, contentHash: proposed.contentHash }] })).toThrow(/cannot restore/);
    expect(store.activePointer(projectRoot).entries).toEqual([]);
  });

  it("makes the public active transition update the pointer and hashes normalized content", () => {
    const { projectRoot, store, propose } = fixture();
    const record = propose("  Keep checks deterministic.  ");
    store.transition(record.id, "validated"); store.transition(record.id, "active");
    expect(store.load({ projectRoot }).loaded[0]?.content).toBe("Keep checks deterministic.");
    expect(() => store.importRecord({ ...record, summary: "Changed identity" })).toThrow(/conflicts/);
    expect(() => store.propose({ key: "empty-root", projectRoot: "", source: { kind: "human" }, summary: "Safe", content: "Safe" })).toThrow(/projectRoot/);
  });

  it("allows an isolated trial to reimport its source snapshot and reset its pointer consistently", () => {
    const { projectRoot, storeRoot, store, propose } = fixture();
    const source = propose();
    const isolated = new ExperienceStore(join(storeRoot, "isolated-trial"));
    isolated.importRecord(source);
    isolated.transition(source.id, "validated"); isolated.activate(source.id);
    const retried = new ExperienceStore(isolated.rootDir);
    retried.importRecord(source);
    expect(retried.get(source.id)?.status).toBe("proposed");
    expect(retried.activePointer(projectRoot).entries).toEqual([]);
    retried.transition(source.id, "validated"); retried.activate(source.id);
    expect(retried.load({ projectRoot }).loaded[0]?.id).toBe(source.id);
    expect(store.get(source.id)?.status).toBe("proposed");
    expect(store.activePointer(projectRoot).entries).toEqual([]);
    retried.revoke(source.id);
    expect(() => retried.importRecord(source)).toThrow(/conflicts/);
  });
});
