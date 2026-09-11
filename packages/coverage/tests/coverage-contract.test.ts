import { describe, expect, it } from "vitest";
import { emptyCoverage } from "../src/index.js";
describe("coverage contract", () => { it("represents unavailable coverage", () => { const summary=emptyCoverage("run_1","hash"); expect(summary.status).toBe("unavailable"); expect(summary.lines.pct).toBe(0); }); });
