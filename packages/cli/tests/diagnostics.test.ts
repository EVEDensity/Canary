import { describe, expect, it } from "vitest";
import { diagnosticSnapshot } from "../src/diagnostics.js";
describe("diagnostics", () => { it("reports roots and local-first exporter state", () => { const d = diagnosticSnapshot("C:\\Users\\Example User\\project"); expect(d.localFirst).toBe(true); expect((d.exporter as { enabled: boolean }).enabled).toBe(false); expect(d).toHaveProperty("invocationRoot"); expect(d).toHaveProperty("artifactRoot"); }); });
