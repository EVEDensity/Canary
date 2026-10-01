import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(siteRoot, "../..");
const output = join(siteRoot, "dist");
const pageFiles = [
  "index.html",
  "site.css",
  "site.js",
  "motion.js",
  "motion.css",
  "playground.js",
  "playground.css",
  "workspace-tour.js",
  "workspace-tour.css",
];

// Keep clean builds strictly inside this app's own generated directory.
if (relative(siteRoot, output) !== "dist") {
  throw new Error("Invalid site output directory.");
}

const sharedAssets = [
  ["docs/images/dashboard-en.jpg", "dashboard-en.jpg"],
  ["docs/images/dashboard-zh-CN.jpg", "dashboard-zh-CN.jpg"],
  ["apps/web/assets/fonts/inter-latin-wght-normal.woff2", "inter-latin.woff2"],
  ["apps/web/assets/fonts/inter-OFL.txt", "inter-OFL.txt"],
  ["apps/web/LUCIDE-LICENSE.txt", "LUCIDE-LICENSE.txt"],
];

// Validate source files before removing the previous build.
for (const file of pageFiles) {
  await stat(join(siteRoot, file));
}
for (const [source] of sharedAssets) {
  await stat(join(repoRoot, source));
}

await rm(output, { recursive: true, force: true });
await mkdir(join(output, "assets"), { recursive: true });
for (const file of pageFiles) {
  await cp(join(siteRoot, file), join(output, file));
}

// App-specific assets are optional; shared images and fonts remain tracked once.
try {
  await stat(join(siteRoot, "assets"));
  await cp(join(siteRoot, "assets"), join(output, "assets"), {
    recursive: true,
    dereference: true,
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const [source, target] of sharedAssets) {
  await cp(join(repoRoot, source), join(output, "assets", target));
}
await cp(join(repoRoot, "LICENSE"), join(output, "LICENSE.txt"));
await writeFile(join(output, ".nojekyll"), "");
console.log(`Canary website built: ${output}`);
