import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { ProjectContext } from "@canary/core";
import { isChangeVerificationBound, isChangeVerificationV2, verificationReceiptSchema } from "@canary/core";
import { FileArtifactRepository, stableHash } from "@canary/trace";
import type { CanaryMcpOperationInput } from "@canary/mcp-server";
import { runCheckProcess } from "./check-executor.js";
import { boundConfig, boundedReceipt } from "./mcp.js";

export function compatibleMcpVerificationPayload(
  operation: string,
  runId: string,
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (operation === "change-verify")
    return (
      payload.runId === runId &&
      ((payload.v === 1 &&
        payload.kind === "canary.change-verification-operation" &&
        payload.stored === true &&
        ["analyzed", "evidence-insufficient"].includes(String(payload.assessment))) ||
        isChangeVerificationV2(payload))
    );
  return payload.v === 1 && typeof payload.kind === "string";
}

/** Fixed operations only; callers cannot supply executable strings, credentials or another project. */
export async function executeMcpVerification(
  input: CanaryMcpOperationInput,
  context: ProjectContext,
  signal: AbortSignal,
) {
  const repository = input.operation === "change-verify" ? new FileArtifactRepository(context.artifactRoot) : undefined;
  const before = repository?.verify(input.runId);
  if (repository && (before?.status !== "verified" || !before.manifestHash))
    return {
      v: 1,
      kind: "canary.host.operation",
      operation: input.operation,
      exitCode: 5,
      outcome: "evidence-insufficient",
      reason: "Change verification requires sealed evidence in the bound project",
    };
  const args = [input.operation, input.runId];
  if (input.operation === "reproduce") args.push("--check", input.checkId!);
  if (input.operation === "repair-verify") {
    args.push(input.candidateRunId!);
    for (const check of input.regression!) args.push("--regression", check);
    for (const path of input.tests!) args.push("--test", path);
    if (input.candidateWorkspace) args.push("--candidate-workspace", input.candidateWorkspace);
  }
  if (input.operation === "change-verify") args.push("--base", input.base!, "--summary");
  else {
    if (input.action === "prepare") args.push("--prepare");
    if (input.action === "execute") args.push("--execute");
    if (input.workspace) args.push("--workspace", input.workspace);
  }
  args.push("--project", context.projectRoot);
  const config = boundConfig(context);
  if (config) args.push("--config", config);
  const entry = fileURLToPath(new URL("./index.js", import.meta.url));
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 120_000);
  let envelope = "",
    envelopeBytes = 0,
    overflow = false;
  try {
    const runtime = import.meta.url.endsWith(".ts")
      ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href, entry.replace(/\.js$/, ".ts")]
      : [entry];
    const result = await runCheckProcess(
      process.execPath,
      [...runtime, ...args],
      context.projectRoot,
      process.env,
      controller.signal,
      () => {},
      undefined,
      (chunk) => {
        if (overflow) return;
        envelopeBytes += Buffer.byteLength(chunk);
        if (envelopeBytes > 65_536) {
          overflow = true;
          envelope = "";
        } else envelope += chunk;
      },
    );
    const exitCode = result.processExit ?? (controller.signal.aborted ? 3 : 5);
    if (controller.signal.aborted)
      return {
        v: 1,
        kind: "canary.host.operation",
        operation: input.operation,
        exitCode: 3,
        outcome: input.operation === "change-verify" ? "evidence-insufficient" : "cancelled",
        reason: "Verification was interrupted; no successful receipt is returned",
      };
    if (overflow)
      return {
        v: 1,
        kind: "canary.host.operation",
        operation: input.operation,
        exitCode: 5,
        outcome: "evidence-insufficient",
        reason: "Machine output exceeded its budget; use the CLI to inspect the full saved receipt",
      };
    let payload: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(envelope);
      if (!compatibleMcpVerificationPayload(input.operation, input.runId, value)) throw new Error();
      payload = value as Record<string, unknown>;
      if (
        ["verified", "reproduced"].includes(String(payload.outcome)) &&
        !verificationReceiptSchema.safeParse(payload).success
      )
        throw new Error();
      if (
        ["verified", "reproduced"].includes(String(payload.outcome)) &&
        (result.processExit !== 0 || result.exitCode !== 0)
      )
        throw new Error();
    } catch {
      return {
        v: 1,
        kind: "canary.host.operation",
        operation: input.operation,
        exitCode: exitCode || 5,
        outcome: controller.signal.aborted ? "cancelled" : "evidence-insufficient",
        reason: "CLI returned no compatible verification receipt",
        diagnosticExcerpt: result.stderr?.slice(0, 1600),
      };
    }
    if (repository) {
      if (result.processExit !== 0 || result.exitCode !== 0)
        return {
          v: 1,
          kind: "canary.host.operation",
          operation: input.operation,
          exitCode: exitCode || 5,
          outcome: "evidence-insufficient",
          reason: "Change verification did not complete successfully; no earlier receipt is reused",
        };
      try {
        const integrity = repository.verify(input.runId);
        if (
          integrity.status !== "verified" ||
          !integrity.manifestHash ||
          integrity.manifestHash === before?.manifestHash
        )
          throw new Error("Change operation did not publish a new sealed revision");
        const run = repository.readRun(input.runId),
          receipt = repository.readJson(input.runId, "change-verification.json"),
          proof = repository.readJson(input.runId, "execution-source.json");
        if (
          !run ||
          !isChangeVerificationBound(receipt, run, proof, proof === undefined ? undefined : stableHash(proof)) ||
          receipt.manifestHash !== before?.manifestHash
        )
          throw new Error("Stored change assessment does not match the bound operation and source evidence");
        const bounded = boundedReceipt(receipt);
        return {
          v: 1,
          kind: "canary.host.operation",
          operation: input.operation,
          exitCode: 0,
          outcome:
            (bounded.receipt as Record<string, unknown>).outcome === "unavailable" ? "unavailable" : receipt.assessment,
          manifestHash: integrity.manifestHash,
          ...bounded,
        };
      } catch (error) {
        return {
          v: 1,
          kind: "canary.host.operation",
          operation: input.operation,
          exitCode: 5,
          outcome: "evidence-insufficient",
          reason: error instanceof Error ? error.message : "Stored change evidence is unavailable",
        };
      }
    }
    return {
      v: 1,
      kind: "canary.host.operation",
      operation: input.operation,
      exitCode,
      outcome: payload.outcome ?? "measured",
      ...boundedReceipt(payload),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
