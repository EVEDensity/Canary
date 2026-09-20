import { test } from "node:test";
import assert from "node:assert/strict";
import { sum } from "./math.mjs";
test("sums empty, signed and multiple values", () => {
  assert.equal(sum([]), 0);
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([-3, 3]), 0);
});
