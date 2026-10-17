import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  CanaryMcpServer,
  LEGACY_PROTOCOL_VERSION,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_KEY,
  CLIENT_CAPABILITIES_KEY,
  serveStdio,
  parseAssessmentArgs,
  parseImprovementsArgs,
  parseAssessmentDecisionArgs,
  toolList,
  type CanaryMcpPorts,
} from "../src/index.js";

const choice = {
  runId: "run_agent",
  reportHash: "a".repeat(64),
  expectedRevision: 0,
  optionId: "repair:assertion-1",
  action: "select",
  actor: "project-maintainer",
  reason: "Inspect the failing behavior before changing the contract",
};
const ports = (overrides: Partial<CanaryMcpPorts> = {}): CanaryMcpPorts => ({
  projectRoot: "/bound/project",
  run: vi.fn(async () => {
    throw new Error("Assessment must not execute a run");
  }),
  evidence: vi.fn(),
  structure: vi.fn(),
  submitProposal: vi.fn(() => {
    throw new Error("Assessment must not submit a proposal");
  }),
  ...overrides,
});
async function legacyServer(binding: CanaryMcpPorts) {
  const server = new CanaryMcpServer({ token: "fixture", ports: binding });
  await server.handleRequestAsync({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: LEGACY_PROTOCOL_VERSION },
  });
  server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  let id = 1;
  return {
    server,
    call: (name: string, args: object) =>
      server.handleRequestAsync({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  };
}

describe("quality assessment MCP contract", () => {
  it("exposes improvement history only with a read port and never accepts execution authority", async () => {
    expect(toolList().tools.some((tool) => tool.name === "canary.improvements")).toBe(false);
    const tool = toolList({ improvements: true }).tools.find((tool) => tool.name === "canary.improvements")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.inputSchema).toMatchObject({ additionalProperties: false, required: ["runId"] });
    expect(parseImprovementsArgs({ runId: "run_agent" })).toEqual({ runId: "run_agent" });
    for (const value of [
      null,
      [],
      {},
      { runId: "../escape" },
      ...["execute", "projectRoot", "config", "retry", "token", "approved"].map((key) => ({
        runId: "run_agent",
        [key]: true,
      })),
    ])
      expect(() => parseImprovementsArgs(value)).toThrow();
    const history = {
      v: 1,
      kind: "canary.improvement-history",
      runId: "run_agent",
      sessions: [],
      evidence: [],
      omittedSessions: 0,
      untrustedEvidence: true,
      executionGranted: false,
    };
    const improvements = vi.fn(() => history),
      binding = ports({ improvements }),
      bound = await legacyServer(binding);
    expect((await bound.call("canary.improvements", { runId: "run_agent" }))?.result).toMatchObject({
      structuredContent: history,
    });
    expect(improvements).toHaveBeenCalledExactlyOnceWith({ runId: "run_agent" });
    expect((await bound.call("canary.improvements", { runId: "run_agent", execute: true }))?.error?.code).toBe(-32602);
    expect(improvements).toHaveBeenCalledTimes(1);
    expect(binding.run).not.toHaveBeenCalled();
    expect(binding.submitProposal).not.toHaveBeenCalled();
    const disabled = await legacyServer(ports());
    expect((await disabled.call("canary.improvements", { runId: "run_agent" }))?.error?.code).toBe(-32601);
    const listed = await disabled.server.handleRequestAsync({ jsonrpc: "2.0", id: 20, method: "tools/list" });
    expect(JSON.stringify(listed)).not.toContain('"name":"canary.improvements"');
  });

  it("declares read-only assessment and hides decision recording unless explicitly enabled", () => {
    const read = toolList().tools.find((tool) => tool.name === "canary.assessment")!;
    expect(read.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(read.inputSchema).toMatchObject({ additionalProperties: false, required: ["runId"] });
    expect(Object.keys(read.inputSchema.properties)).toEqual(["runId"]);
    expect(toolList().tools.some((tool) => tool.name === "canary.assessment_decide")).toBe(false);
    const decide = toolList({ assessmentDecisions: true }).tools.find(
      (tool) => tool.name === "canary.assessment_decide",
    )!;
    expect(decide.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(decide.description).toMatch(/not authenticated human approval/);
    expect(decide.inputSchema.additionalProperties).toBe(false);
    expect(parseAssessmentArgs({ runId: "run_agent" })).toEqual({ runId: "run_agent" });
    expect(parseAssessmentDecisionArgs(choice)).toEqual(choice);
    expect(parseAssessmentDecisionArgs({ ...choice, action: "reject" }).action).toBe("reject");
  });

  it("rejects malformed identity, unexpected arguments, credentials and self-declared authorization", () => {
    for (const value of [
      null,
      [],
      {},
      { runId: "../foreign" },
      { runId: " run_agent " },
      ...["projectRoot", "cwd", "token", "configPath", "write", "approved", "actor"].map((key) => ({
        runId: "run_agent",
        [key]: "override",
      })),
    ])
      expect(() => parseAssessmentArgs(value)).toThrow();
    for (const value of [
      {},
      null,
      [],
      { ...choice, runId: "../foreign" },
      { ...choice, reportHash: "A".repeat(64) },
      { ...choice, reportHash: "short" },
      ...[-1, 0.5, "0", null, NaN, Infinity].map((expectedRevision) => ({ ...choice, expectedRevision })),
      { ...choice, optionId: "../escape" },
      { ...choice, action: "execute" },
      { ...choice, actor: "" },
      { ...choice, actor: " self " },
      { ...choice, actor: "operator\nadmin" },
      { ...choice, reason: "" },
      { ...choice, reason: "x".repeat(513) },
      ...[
        "project",
        "sourceWrite",
        "executionGranted",
        "approved",
        "allowAssessmentDecisions",
        "authorization",
        "token",
        "password",
      ].map((key) => ({ ...choice, [key]: true })),
    ])
      expect(() => parseAssessmentDecisionArgs(value), JSON.stringify(value)).toThrow();
  });

  it("dispatches assessment reads and choices to separate ports without executing or approving", async () => {
    const report = {
      kind: "canary.quality-assessment-view",
      untrustedEvidence: true,
      revision: 0,
      executionGranted: false,
      report: {
        contentHash: choice.reportHash,
        binding: { runId: choice.runId },
        limitations: ["A recommendation is a hypothesis"],
      },
      decisions: [],
      omittedDecisions: 0,
      selections: [],
    };
    const assessment = vi.fn(() => report);
    const assessmentDecide = vi.fn((input: unknown) => ({
      ...report,
      revision: 1,
      decisions: [{ ...(input as object), executionGranted: false, verificationStatus: "not-executed" }],
      selections: [{ issueId: "issue_assertion", optionId: choice.optionId, revision: 1 }],
    }));
    const binding = ports({ assessment, assessmentDecide });
    const { server, call } = await legacyServer(binding);
    const listed = await server.handleRequestAsync({ jsonrpc: "2.0", id: 80, method: "tools/list" });
    expect(JSON.stringify(listed?.result)).toContain("canary.assessment_decide");
    const read = await call("canary.assessment", { runId: choice.runId });
    expect(read?.error).toBeUndefined();
    expect((read?.result as { structuredContent: unknown }).structuredContent).toEqual(report);
    const selected = await call("canary.assessment_decide", choice);
    expect(selected?.error).toBeUndefined();
    expect((selected?.result as { structuredContent: unknown }).structuredContent).toMatchObject({
      revision: 1,
      executionGranted: false,
      decisions: [{ verificationStatus: "not-executed" }],
      selections: [{ issueId: "issue_assertion", optionId: choice.optionId, revision: 1 }],
    });
    expect(assessmentDecide).toHaveBeenCalledExactlyOnceWith(choice);
    expect(binding.run).not.toHaveBeenCalled();
    expect(binding.submitProposal).not.toHaveBeenCalled();
    await call("canary.assessment_decide", { ...choice, executionGranted: true });
    expect(assessmentDecide).toHaveBeenCalledTimes(1);
  });

  it("refuses decision recording without startup capability and surfaces stale state errors", async () => {
    const disabled = await legacyServer(ports({ assessment: () => ({ revision: 0 }) }));
    const listed = await disabled.server.handleRequestAsync({ jsonrpc: "2.0", id: 80, method: "tools/list" });
    expect(JSON.stringify(listed?.result)).not.toContain("canary.assessment_decide");
    expect((await disabled.call("canary.assessment_decide", choice))?.error).toMatchObject({
      code: -32601,
      message: expect.stringMatching(/disabled/),
    });
    const rejected = await legacyServer(
      ports({
        assessmentDecide() {
          throw Object.assign(new Error("Quality assessment is stale; reread current evidence"), {
            code: "QUALITY_STALE",
          });
        },
      }),
    );
    expect((await rejected.call("canary.assessment_decide", choice))?.error?.message).toMatch(/stale/);
    const missing = await legacyServer(ports());
    expect((await missing.call("canary.assessment", { runId: choice.runId }))?.error?.message).toMatch(/unavailable/);
  });

  it("preserves quality identities through the actual stdio JSON-RPC roundtrip", async () => {
    const response = {
      kind: "canary.quality-assessment-view",
      untrustedEvidence: true,
      revision: 0,
      executionGranted: false,
      report: { contentHash: choice.reportHash, scope: "agent", binding: { runId: choice.runId } },
      decisions: [],
      omittedDecisions: 0,
      selections: [],
    };
    const assessment = vi.fn(() => response);
    const server = new CanaryMcpServer({ token: "fixture", ports: ports({ assessment }) });
    const stdin = new PassThrough(),
      stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    const serving = serveStdio(server, stdin, stdout);
    stdin.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          _meta: { [PROTOCOL_VERSION_KEY]: MODERN_PROTOCOL_VERSION, [CLIENT_CAPABILITIES_KEY]: {} },
          name: "canary.assessment",
          arguments: { runId: choice.runId },
        },
      }) + "\n",
    );
    await serving;
    const result = JSON.parse(output.trim());
    expect(result.error).toBeUndefined();
    expect(result.result.structuredContent).toEqual(response);
    expect(JSON.parse(result.result.content[0].text)).toEqual(response);
    expect(assessment).toHaveBeenCalledExactlyOnceWith({ runId: choice.runId });
  });
});
