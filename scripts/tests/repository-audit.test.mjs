import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { inspectFile, inspectDocumentationLinks } from "../verify-repository.mjs";

test("reports credential locations without retaining credential values", () => {
  const secret = "sk-" + "a1b2c3d4".repeat(4);
  const findings = inspectFile("config.ts", "const value = '" + secret + "';");
  assert.deepEqual(findings, [{ path: "config.ts", rule: "provider-key", line: 1 }]);
  assert.ok(!JSON.stringify(findings).includes(secret));
  assert.equal(inspectFile("config.ts", "sk-proj-" + "a1b2c3d4".repeat(8))[0].rule, "provider-key");
  assert.equal(inspectFile(".env", "")[0].rule, "environment-file");
  assert.equal(inspectFile(".canary/run.json", "")[0].rule, "private-or-generated-file");
  assert.deepEqual(inspectFile(".env.example", "API_KEY=<your-key>"), []);
  assert.deepEqual(inspectFile("packages/coverage/src/index.ts", ""), []);
  for (const separator of ["/", "\\"]) {
    const personalPath = ["C:", "Users", "synthetic", "project"].join(separator);
    assert.equal(inspectFile("docs/guide.md", personalPath)[0].rule, "personal-path");
    assert.deepEqual(inspectFile("docs/guide.md", personalPath.replace("synthetic", "<user>")), []);
  }
});
test("detects broken, encoded and escaping documentation paths without treating examples as links", (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-audit-")));
  t.after(() => {
    const actual = realpathSync.native(root),
      rel = relative(realpathSync.native(tmpdir()), actual);
    assert.ok(!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
    rmSync(actual, { recursive: true, force: true });
  });
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "README.md"), "Guide");
  writeFileSync(join(root, "docs", "one image.svg"), "<svg/>");
  assert.deepEqual(
    inspectDocumentationLinks(
      root,
      "docs/guide.md",
      "[Start](../README.md#guide) ![Image](one%20image.svg) [Site](https://example.test)\n```md\n[Example](missing.md)\n```",
    ),
    [],
  );
  const findings = inspectDocumentationLinks(
    root,
    "README.md",
    '[Missing](docs/missing.md) [Escape](../outside.md) <img src="docs/one%20image.svg">',
  );
  assert.deepEqual(
    findings.map((f) => f.rule),
    ["broken-document-link", "broken-document-link"],
  );
  const secret = "sk-" + "a1b2c3d4".repeat(4);
  const privateLink = inspectDocumentationLinks(root, "README.md", "[Missing](missing.md?token=" + secret + ")");
  assert.equal(privateLink[0].rule, "broken-document-link");
  assert.ok(!JSON.stringify(privateLink).includes(secret));
});
