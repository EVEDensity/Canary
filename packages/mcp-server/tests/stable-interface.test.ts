import { expect, it } from "vitest";
import { TOOL_NAMES, SUPPORTED_PROTOCOL_VERSIONS, COMPATIBILITY_MATRIX } from "../src/protocol.js";
it("freezes the supported MCP v1 tool and authority surface", () => {
  expect([...TOOL_NAMES]).toEqual([
    "canary.run",
    "canary.evidence",
    "canary.structure",
    "canary.submit_proposal",
    "canary.diagnostics",
    "canary.repair_task",
    "canary.memory",
    "canary.assessment",
    "canary.improvements",
    "canary.assessment_decide",
    "canary.verification",
    "canary.reproduce",
    "canary.repair_verify",
    "canary.change_verify",
  ]);
  expect([...SUPPORTED_PROTOCOL_VERSIONS]).toEqual(["2026-07-28", "2025-11-25"]);
  expect(COMPATIBILITY_MATRIX).toMatchObject({
    v: 1,
    sampling: false,
    sourceWrite: false,
    assessmentDecisionRecording: "startup-opt-in",
    controlledImprovementHistory: "read-only-bound-port",
    streamableHttpSession: false,
  });
});
