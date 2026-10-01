import assert from "node:assert/strict";
// Intentional failure validates that the Action preserves a real failing check.
assert.equal(2 + 2, 5);
