import { describe, expect, it } from "vitest";
import { auditTestChanges } from "../src/test-audit.js";

const changes = (before: string, after: string, path = "tests/basic.test.cjs") => auditTestChanges([{ path, before, after }]);

describe("bounded test weakening audit", () => {
  const commonjs = "const test = require('node:test');\nconst assert = require('node:assert/strict');\n";
  const original = `${commonjs}test('regression', () => assert.equal(1, 2));`;

  it.each(["skip", "only", "todo"])("observes newly added CommonJS test.%s without assuming an ESM import", method => {
    const findings = changes(original, `${commonjs}test.${method}('regression', () => assert.equal(1, 2));`);
    expect(findings).toContainEqual({ path: "tests/basic.test.cjs", line: 3, type: "skip-todo-or-only-added", certainty: "observed" });
  });

  it("recognizes explicit CommonJS destructured aliases and skip options", () => {
    const bindings = "const { test: spec } = require('node:test');\nconst { strict: verify } = require('node:assert');\n";
    const before = `${bindings}spec('regression', () => verify.equal(1, 2));`;
    expect(changes(before, `${bindings}spec('regression', { skip: true }, () => verify.equal(1, 2));`)).toContainEqual({ path: "tests/basic.test.cjs", line: 3, type: "skip-todo-or-only-added", certainty: "observed" });
    expect(changes(before, `${bindings}spec('regression', () => verify(true));`)).toContainEqual({ path: "tests/basic.test.cjs", line: 3, type: "unconditional-assertion-added", certainty: "observed" });
  });

  it("recognizes aliased CommonJS assertion removal and named assertion functions", () => {
    const bindings = "const { test: spec } = require('node:test');\nconst { equal: same, ok: ensure } = require('assert/strict');\n";
    const before = `${bindings}spec('regression', () => { same(1, 2); same(2, 3); });`;
    expect(changes(before, `${bindings}spec('regression', () => same(1, 2));`)).toContainEqual({ path: "tests/basic.test.cjs", type: "assertion-count-reduced", certainty: "advisory" });
    expect(changes(before, `${bindings}spec('regression', () => ensure(true));`)).toContainEqual({ path: "tests/basic.test.cjs", line: 3, type: "unconditional-assertion-added", certainty: "observed" });
  });

  it("uses the same canonical aliases for ESM and namespace bindings", () => {
    const esm = "import { test as spec } from 'node:test';\nimport { strict as verify } from 'node:assert';\n";
    const before = `${esm}spec('regression', () => verify.equal(1, 2));`;
    expect(changes(before, `${esm}spec.only('regression', () => verify(true));`, "tests/basic.test.mjs").map(item => item.type)).toEqual(expect.arrayContaining(["skip-todo-or-only-added", "unconditional-assertion-added"]));
    const namespace = "import * as checks from 'node:test';\nimport * as verify from 'node:assert/strict';\n";
    expect(changes(`${namespace}checks.test('regression', () => verify.equal(1, 2));`, `${namespace}checks.test.skip('regression', () => verify.equal(1, 2));`, "tests/basic.test.mjs")).toContainEqual(expect.objectContaining({ type: "skip-todo-or-only-added", certainty: "observed" }));
  });

  it("does not label ordinary ESM helpers, local functions or nonassertion utilities as tests", () => {
    const before = "import helper from './helper.mjs';\nimport { vi } from 'vitest';\nconst assert = () => {};\nhelper('before');\nvi.fn();\n";
    const after = "import helper from './helper.mjs';\nimport { vi } from 'vitest';\nconst assert = () => {};\nhelper.skip('after');\nvi.only();\nassert(true);\n";
    expect(changes(before, after, "tests/helper.test.mjs")).toEqual([]);
    const shadowed = "import assert from 'node:assert/strict';\nimport test from 'node:test';\n";
    expect(changes(`${shadowed}function helper(assert, test) { assert(false); test('before'); }`, `${shadowed}function helper(assert, test) { assert(true); test.skip('after'); }`, "tests/helper.test.mjs")).toEqual([]);
    const realAssert = "import assert from 'node:assert/strict';\n";
    expect(changes(`${realAssert}assert.deepEqual({ skip: false }, {});`, `${realAssert}assert.deepEqual({ skip: true }, {});`, "tests/basic.test.mjs").some(item => item.type === "skip-todo-or-only-added")).toBe(false);
  });

  it("does not infer dynamic, nonconstant or custom-require bindings", () => {
    for (const prefix of [
      "const moduleName = 'node:test'; const test = require(moduleName);",
      "let test = require('node:test');",
      "const test = condition ? require('node:test') : helper;",
      "const require = helper; const test = require('node:test');",
      "function require(name) { return helper; } const test = require('node:test');",
      "const { test = helper } = require('node:test');",
    ]) expect(changes(`${prefix}\ntest('before');`, `${prefix}\ntest.skip('after');`), prefix).toEqual([]);
  });

  it("does not re-report an unchanged existing skip", () => {
    const skipped = `${commonjs}test.skip('regression', () => assert.equal(1, 2));`;
    expect(changes(skipped, skipped)).toEqual([]);
  });
});
