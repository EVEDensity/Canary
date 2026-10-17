import { resolve } from "node:path";
import { archiveAuthorizationSchema, qualityContentHash } from "@canary/core";
import {
  CollectionBusyError,
  EvidenceArchiveError,
  planEvidenceArchive,
  planEvidenceRestore,
  createEvidenceArchive,
  restoreEvidenceArchive,
  readEvidenceArchive,
  inspectCollectionLocks,
  recoverCollectionLocks,
  containsSensitiveValue,
} from "@canary/trace";
import { resolveProjectContext } from "./home.js";

class ArchiveArgumentError extends Error {}
export function archiveCommand(args: string[]): number {
  const json = args.includes("--json");
  try {
    const [command] = args;
    if (!["create", "restore", "show", "recover"].includes(command ?? ""))
      throw new ArchiveArgumentError(
        "Use canary archive create/restore/show <directory>, or recover, with --json for a reviewable plan.",
      );
    const target = command === "recover" ? undefined : args[1];
    if (command !== "recover" && (!target || target.startsWith("--")))
      throw new ArchiveArgumentError("An explicit archive directory is required.");
    const flags = new Map<string, string>(),
      switches = new Set<string>();
    for (let i = command === "recover" ? 1 : 2; i < args.length; i++) {
      const key = args[i]!;
      if (["--apply", "--rotate", "--json"].includes(key)) {
        if (
          switches.has(key) ||
          (key === "--rotate" && command !== "create") ||
          (key === "--apply" && command === "show")
        )
          throw new ArchiveArgumentError("Duplicate or unsupported archive flag.");
        switches.add(key);
        continue;
      }
      const value = args[++i];
      if (
        !["--project", "--config", "--plan-hash", "--actor", "--reason"].includes(key) ||
        flags.has(key) ||
        !value ||
        value.startsWith("--")
      )
        throw new ArchiveArgumentError("Unknown, duplicate or incomplete archive option.");
      flags.set(key, value);
    }
    const context = resolveProjectContext({ cwd: flags.get("--project"), configPath: flags.get("--config") }),
      root = context.artifactRoot;
    let output: unknown;
    if (command === "show") output = readEvidenceArchive(root, resolve(target!));
    else if (command === "recover") {
      const state = inspectCollectionLocks(root),
        preview = { v: 1, kind: "canary.collection-recovery-plan", ...state, executionGranted: false };
      if (!switches.has("--apply")) output = { ...preview, contentHash: qualityContentHash(preview) };
      else {
        const request = archiveAuthorizationSchema.parse({
          planHash: flags.get("--plan-hash"),
          actor: flags.get("--actor"),
          reason: flags.get("--reason"),
        });
        if (containsSensitiveValue(request))
          throw new ArchiveArgumentError("Operator attribution must not contain credentials.");
        if (request.planHash !== qualityContentHash(preview))
          throw new EvidenceArchiveError("ARCHIVE_STALE", "Lock state changed; inspect a fresh recovery plan.");
        recoverCollectionLocks(root, state.hash, request.actor, request.reason);
        output = {
          v: 1,
          kind: "canary.collection-recovery-receipt",
          locksReleased: state.locks.length,
          executionGranted: false,
        };
      }
    } else if (switches.has("--apply")) {
      const request = {
        planHash: flags.get("--plan-hash"),
        actor: flags.get("--actor"),
        reason: flags.get("--reason"),
      };
      output =
        command === "create"
          ? createEvidenceArchive(root, resolve(target!), switches.has("--rotate") ? "rotate" : "copy", request)
          : restoreEvidenceArchive(root, resolve(target!), request);
    } else
      output =
        command === "create"
          ? planEvidenceArchive(root, resolve(target!), switches.has("--rotate") ? "rotate" : "copy")
          : planEvidenceRestore(root, resolve(target!));
    console.log(json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
    return 0;
  } catch (error) {
    const code =
      error instanceof CollectionBusyError
        ? error.code
        : error instanceof EvidenceArchiveError
          ? error.code
          : error instanceof ArchiveArgumentError || (error instanceof Error && error.name === "ZodError")
            ? "ARCHIVE_INPUT"
            : "ARCHIVE_EVIDENCE";
    const message =
      error instanceof CollectionBusyError || error instanceof EvidenceArchiveError
        ? error.message
        : "Archive inputs are invalid or unavailable. Preserve existing evidence, inspect the collection and provide a complete reviewed command.";
    const output = { v: 1, kind: "canary.archive-error", code, message, executionGranted: false };
    if (json) console.log(JSON.stringify(output));
    else console.error(`${code}: ${message}`);
    return code === "ARCHIVE_INPUT" ? 2 : 1;
  }
}
