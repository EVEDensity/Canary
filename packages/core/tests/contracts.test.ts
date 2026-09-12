import { describe, expect, it } from "vitest";
import { CORE_CONTRACTS, FeatureRegistry, defineConfig } from "../src/index.js";

describe("core contracts and barrel compatibility", () => {
  it("keeps existing defineConfig and FeatureRegistry exports", () => {
    const config = defineConfig({
      agent: { adapter: "function", entry: "./agent.ts" },
      cases: "./cases.ts",
      coverage: { include: ["src/**/*.ts"] },
    });
    expect(config.agent.entry).toBe("./agent.ts");
    const registry = new FeatureRegistry([{ id: "planning", files: ["a.ts"] }]);
    expect(registry.get("planning")?.id).toBe("planning");
  });

  it("declares versioned contracts without wiring experiments into default run", () => {
    expect(CORE_CONTRACTS.projectContext.wired).toBe(true);
    expect(CORE_CONTRACTS.experiment.wired).toBe(false);
    expect(CORE_CONTRACTS.trial.wired).toBe(false);
    expect(CORE_CONTRACTS.activation.wired).toBe(false);
  });
});
