import { describe, expect, it } from "vitest";
import { ControlError, assert, hash, safeId } from "../src/storage.js";
describe("control-plane safety", () => {
  it("refuses invalid ids", () => expect(() => safeId("../x")).toThrow(ControlError));
  it("hashes deterministically", () => expect(hash({ a: 1 })).toBe(hash({ a: 1 })));
  it("requires conditions", () => expect(() => assert(false, "nope", 403)).toThrow(/nope/));
});
