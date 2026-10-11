import { expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FileArtifactRepository } from "@canary/trace";

it("rejects candidate evidence when a passing check changes production source during execution", () => {
  const tempRoot = realpathSync.native(tmpdir());
  const root = realpathSync.native(mkdtempSync(join(tempRoot, "canary-r22-candidate-source-")));
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", join(root, "canary.project.json")], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
    });
    expect(result.error, result.stderr).toBeUndefined();
    return { code: result.status, body: JSON.parse(result.stdout || "{}"), error: result.stderr };
  };
  const incorrectMath = "export const add = (a,b) => a+b-1;\n";
  const correctedMath = "export const add = (a,b) => a+b;\n";
  const originalTest = [
    "import assert from 'node:assert/strict';",
    "import {existsSync, writeFileSync} from 'node:fs';",
    "if (existsSync(new URL('./candidate.marker', import.meta.url))) {",
    `  writeFileSync(new URL('./math.mjs', import.meta.url), ${JSON.stringify(correctedMath)});`,
    "}",
    "const {add} = await import('./math.mjs');",
    "assert.equal(add(1,1),2);",
    "",
  ].join("\n");
  const originalCheck = { id: "original", type: "command", command: "node", args: ["original.test.mjs"] };
  const config = (checks: unknown[]) => writeFileSync(
    join(root, "canary.project.json"),
    JSON.stringify({ kind: "canary.project", version: 1, checks }),
  );
  try {
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "package.json"), '{"name":"candidate-source-fixture","type":"module"}');
    writeFileSync(join(root, "math.mjs"), incorrectMath);
    writeFileSync(join(root, "original.test.mjs"), originalTest);
    config([originalCheck]);
    git("add", ".");
    git("commit", "-qm", "Failing baseline");

    const baseline = call("run", "--ci");
    expect(baseline.code, baseline.error).toBe(1);
    expect(baseline.body.exitCode).toBe(1);
    expect(readFileSync(join(root, "math.mjs"), "utf8")).toBe(incorrectMath);
    expect(git("status", "--porcelain")).toBe("");

    writeFileSync(join(root, "candidate.marker"), "Enable the unchanged original check's source mutation\n");
    writeFileSync(
      join(root, "regression.test.mjs"),
      "import assert from 'node:assert/strict'; import {add} from './math.mjs'; assert.equal(add(2,3),5);\n",
    );
    config([originalCheck, { id: "regression", type: "command", command: "node", args: ["regression.test.mjs"] }]);
    git("add", ".");
    git("commit", "-qm", "Candidate marker and regression without a production fix");
    expect(git("show", "HEAD:math.mjs")).toBe(incorrectMath.trim());
    expect(readFileSync(join(root, "original.test.mjs"), "utf8")).toBe(originalTest);
    expect(readFileSync(join(root, "math.mjs"), "utf8")).toBe(incorrectMath);

    const candidate = call("run", "--ci");
    expect(candidate.code, candidate.error).toBe(0);
    expect(candidate.body.exitCode).toBe(0);
    expect(readFileSync(join(root, "math.mjs"), "utf8")).toBe(correctedMath);
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    expect(repository.readRun(candidate.body.runId)?.checks?.map(({ status }) => status)).toEqual(["passed", "passed"]);
    const proof = repository.readJson(candidate.body.runId, "execution-source.json") as {
      status: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(proof.status).toBe("changed");
    const fields = ["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"] as const;
    for (const field of fields) {
      expect(proof.before[field], `before.${field}`).toEqual(expect.any(String));
      expect(proof.after[field], `after.${field}`).toEqual(expect.any(String));
    }
    expect(fields.map((field) => proof.after[field])).not.toEqual(fields.map((field) => proof.before[field]));

    const receipt = call(
      "repair-verify",
      baseline.body.runId,
      candidate.body.runId,
      "--regression",
      "regression",
      "--test",
      "regression.test.mjs",
      "--execute",
    );
    expect(receipt.code, receipt.error).toBe(4);
    expect(receipt.body, receipt.error).toMatchObject({ outcome: "evidence-insufficient", executed: false });
    expect(receipt.body.reasons.join(" ")).toMatch(/candidate execution source proof.*changed/i);
  } finally {
    removeFixture(root, tempRoot);
  }
}, 90000);

function removeFixture(root: string, tempRoot: string) {
  const pathFromTemp = relative(tempRoot, root);
  if (!isAbsolute(root) || !pathFromTemp || isAbsolute(pathFromTemp) || pathFromTemp === ".." || pathFromTemp.startsWith(`..${sep}`)) {
    throw new Error("Refusing to remove a fixture outside the temporary directory");
  }
  rmSync(root, { recursive: true, force: true });
}
