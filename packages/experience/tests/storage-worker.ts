import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, dirname, basename } from "node:path";

const [storeRoot, mode, argument, fault] = process.argv.slice(2) as [string, string, string, string?];
const projectRoot = resolve(storeRoot, "..", "..");
if (fault) {
  const originalRename = fs.renameSync;
  const originalWrite = fs.writeFileSync;
  if (fault === "journal-half-write") {
    fs.writeFileSync = ((file, data, ...options) => {
      if (typeof data === "string" && data.includes('"writes"') && data.includes(argument)) {
        originalWrite(file, data.slice(0, Math.floor(data.length / 2)), ...options);
        process.kill(process.pid, "SIGKILL");
      }
      return originalWrite(file, data, ...options);
    }) as typeof fs.writeFileSync;
  } else {
    fs.renameSync = (from, to) => {
      originalRename(from, to);
      if (basename(dirname(String(to))) === "records" && basename(String(to)) === `${argument}.json`) {
        if (fault === "record-half-write") originalWrite(to, '{"v":1,"id":');
        process.kill(process.pid, "SIGKILL");
      }
    };
  }
  syncBuiltinESMExports();
}

const { ExperienceStore } = await import("../src/index.js");
const store = new ExperienceStore(storeRoot);
if (mode === "concurrent") {
  for (let index = 0; index < 2; index++) store.propose({ key: "serial", projectRoot, source: { kind: "human" }, summary: `Worker ${argument} ${index}`, content: `Use deterministic check ${argument} ${index}.` });
  const record = store.propose({ key: `parallel-${argument}`, projectRoot, source: { kind: "human" }, summary: `Parallel ${argument}`, content: `Keep check ${argument} focused.` });
  store.transition(record.id, "validated");
  store.activate(record.id);
} else if (mode === "dedupe") {
  const record = store.propose({ key: "same", projectRoot, source: { kind: "human" }, summary: "Same", content: "Keep checks deterministic." });
  process.stdout.write(record.id);
} else if (mode === "activate") store.activate(argument);
else if (mode === "revoke") store.revoke(argument);
else if (mode === "clear") store.clear(projectRoot);
else if (mode === "restore") store.restorePointer(JSON.parse(fs.readFileSync(resolve(storeRoot, "saved-pointer.json"), "utf8")));
else if (mode === "hold") {
  const { ExperienceStorage } = await import("../src/storage.js");
  new ExperienceStorage(storeRoot, () => {}).locked(() => {
    process.stdout.write("locked\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  });
}
