import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ExperienceStore } from "@canary/experience";
import { hasExperienceDelivery, type CanaryConfig, type TestCase } from "@canary/core";
import { RunStore } from "@canary/trace";
import { runConfiguredCase } from "@canary/runner";
import { runEvaluation } from "../src/app.js";
import { resolveProjectContext } from "../src/home.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(source = "export default async (_, ctx) => ctx.experiences.map(e => e.id);") {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-app-delivery-"))); roots.push(root);
  writeFileSync(join(root, "agent.mjs"), source);
  const experiences = new ExperienceStore(join(root, ".canary", "experiences"));
  const proposed = experiences.propose({ key: "fixture-rule", projectRoot: root, source: { kind: "human" }, summary: "Fixture advisory context", content: "Check the regression input", scope: { caseIds: ["regression"] } });
  experiences.transition(proposed.id, "validated"); experiences.activate(proposed.id);
  const config: CanaryConfig = { agent: { adapter: "function", entry: "agent.mjs" }, cases: "none", coverage: { include: ["agent.mjs"] }, runtime: { timeoutMs: 5000, concurrency: 2 } };
  const selected: TestCase[] = [{ id: "regression", input: "broken", options: { repetitions: 2 } }, { id: "holdout", input: "ok" }];
  return { root, proposed, input: { store: new RunStore(), config, selected, experiences, context: resolveProjectContext({ cwd: root, configPath: "canary.config.ts" }), silent: true } };
}

describe("run selection and context delivery", () => {
  it("records only selection before execution and aggregates real delivery for every repetition", async () => {
    const { input, proposed } = fixture();
    let checkedBeforeExecution = false;
    const run = await runEvaluation({ ...input, ports: { executeCase: async (options, testCase) => {
      if (!checkedBeforeExecution) {
        checkedBeforeExecution = true;
        expect(input.store.get(options.runId)?.experiences).toEqual([expect.objectContaining({ delivery: { status: "selected", adapter: "function" } })]);
      }
      return runConfiguredCase(options, testCase);
    } } });
    expect(run.snapshot.experiences?.[0]?.delivery).toMatchObject({ status: "delivered", adapter: "function", caseIds: ["regression"], executionIds: expect.any(Array) });
    expect(run.snapshot.experiences?.[0]?.delivery?.executionIds).toHaveLength(2);
    expect(hasExperienceDelivery(run.snapshot, proposed, ["regression"], ["holdout"])).toBe(true);
    expect(run.snapshot.results.find((result) => result.caseId === "holdout")?.experienceDelivery?.references).toEqual([]);
  });
  it("leaves import failures selected and ineligible as delivery proof", async () => {
    const { input, proposed } = fixture("export default null;");
    const run = await runEvaluation(input);
    expect(run.snapshot.experiences?.[0]?.delivery).toEqual({ status: "selected", adapter: "function" });
    expect(hasExperienceDelivery(run.snapshot, proposed, ["regression"], ["holdout"])).toBe(false);
  });
  it("never attributes an HTTP result to selected experience context", async () => {
    const { input, proposed } = fixture();
    const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ output: "apparent improvement" })); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    input.config.agent = { adapter: "http", entry: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` };
    try {
      const run = await runEvaluation(input);
      expect(run.snapshot.experiences?.[0]?.delivery).toEqual({ status: "unsupported", adapter: "http" });
      expect(run.snapshot.results.every((result) => result.experienceDelivery?.status === "unsupported")).toBe(true);
      expect(hasExperienceDelivery(run.snapshot, proposed, ["regression"], ["holdout"])).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
