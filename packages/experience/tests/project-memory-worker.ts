import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const [root, projectId, inputFile, fault] = process.argv.slice(2) as [string, string, string, string?];
if (fault === "record-half-write") {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (/^memory_[a-f0-9]{24}\.json$/.test(basename(String(to)))) {
      fs.writeFileSync(to, '{"v":1,"id":');
      process.kill(process.pid, "SIGKILL");
    }
  };
  syncBuiltinESMExports();
}
const { ProjectMemoryStore } = await import("../src/project-memory.js");
const value = new ProjectMemoryStore(root, projectId).record(JSON.parse(fs.readFileSync(inputFile, "utf8")));
process.stdout.write(value.id);
