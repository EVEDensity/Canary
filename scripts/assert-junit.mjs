import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { countJunitFailures } from "../packages/reporters/dist/index.js";

const root = join(process.cwd(), ".canary/artifacts");
if (!existsSync(root)) {
  console.error("No canary artifacts found under .canary/artifacts");
  process.exit(1);
}

const latest = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const xml = join(root, entry.name, "report.xml");
    return { runId: entry.name, xml, mtime: existsSync(xml) ? statSync(xml).mtimeMs : 0 };
  })
  .sort((a, b) => b.mtime - a.mtime)[0];

if (!latest || !existsSync(latest.xml)) {
  console.error("Latest canary artifact is missing report.xml");
  process.exit(1);
}

const xml = readFileSync(latest.xml, "utf8");
const failures = countJunitFailures(xml);
if (!Number.isFinite(failures) || failures > 0) {
  console.error(`JUnit failures=${failures} in ${latest.xml}`);
  process.exit(1);
}

console.log(`JUnit OK: ${latest.runId} failures=${failures}`);
