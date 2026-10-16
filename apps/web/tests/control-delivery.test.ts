import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { controlScript } from "../src/control-client.js";

const summary = controlScript.match(/^function experienceSummary\(run\).*$/m)![0];
describe("control context delivery display", () => {
  it("counts only verified function context and preserves partial, unsupported, selected and unknown states", () => {
    const run = { experienceReferences: [
      { deliveryStatus: "delivered", delivery: { status: "delivered", adapter: "function" }, verifiedDelivery: { executionIds: ["actual-execution"] } },
      { deliveryStatus: "partial" }, { deliveryStatus: "selected" }, { deliveryStatus: "unsupported" }, { deliveryStatus: "unknown" },
      { deliveryStatus: "delivered", delivery: { status: "delivered", adapter: "function" } },
    ] };
    const result = runInNewContext(`${summary};experienceSummary(run)`, { run });
    expect(result.counts).toEqual({ delivered: 1, partial: 1, selected: 1, unsupported: 1, unknown: 2 });
    expect(result.text).toContain("已送达 1");
  });
  it("marks a legacy server's loaded array unknown", () => {
    const result = runInNewContext(`${summary};experienceSummary(run)`, { run: { loadedExperiences: [{ id: "legacy", loadedAt: "2026-10-11" }] } });
    expect(result.counts.delivered).toBe(0);
    expect(result.counts.unknown).toBe(1);
  });
  it("shows legacy trial benefit and validation as unavailable without verified delivery", () => {
    const view = controlScript.match(/function experienceView\(root\)\{[\s\S]*?\n\}/)![0];
    const rows: unknown[][] = [];
    const node = () => ({ append: () => {}, childNodes: [] });
    runInNewContext(`${view};experienceView(root)`, {
      root: node(), el: node, row: (key: string, value: unknown) => { rows.push([key, value]); return node(); }, pill: (value: unknown) => value,
      detail: node, deliveryLabel: () => "送达状态未知",
      data: { activeExperience: null, actions: [], experiences: [{ id: "legacy", key: "legacy", status: "active" }], trials: [{ id: "trial", experienceId: "legacy", status: "approved", validation: { valid: true }, comparison: { verdict: "improve", improvements: ["case0"] } }] },
    });
    expect(rows).toContainEqual(["收益", "不可用（送达未核对）"]);
    expect(rows).toContainEqual(["改善", "不可用"]);
    expect(rows).toContainEqual(["验证", "未知（送达未核对）"]);
  });
});
