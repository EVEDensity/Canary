import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  IMPROVEMENT_MAX_RECORD_BYTES,
  IMPROVEMENT_MAX_SESSIONS,
  QUALITY_MAX_RECORD_BYTES,
  parseImprovementSession,
  parseQualityRecord,
  projectMemoryProjectId,
  qualityContentHash,
} from "@canary/core";
import { sha256 } from "./artifacts.js";
import { containsSensitiveValue } from "./privacy.js";
import { qualityOrdinaryParents, readQualityBytes } from "./quality-assessment.js";

export interface RetentionBlocker {
  code: "RETENTION_BUSY" | "RETENTION_STORAGE" | "RETENTION_EVIDENCE";
  store: string;
  message: string;
}
export class RetentionError extends Error {
  constructor(
    readonly code: RetentionBlocker["code"] | "RETENTION_STALE",
    message: string,
  ) {
    super(message);
    this.name = "RetentionError";
  }
}
export interface RetentionReferences {
  hash: string;
  runIds: string[];
  blockers: RetentionBlocker[];
  recordFiles: string[];
}

/** A bounded, validated inventory. Unreadable metadata prevents pruning, never weakens references. */
export function retentionReferences(root: string, ownLocks: ReadonlySet<string> = new Set()): RetentionReferences {
  const runIds = new Set<string>(),
    blockers: RetentionBlocker[] = [],
    records: Array<[string, string]> = [],
    recordFiles: string[] = [];
  const unavailable = (store: string, code: RetentionBlocker["code"], message: string) =>
    blockers.push({ store, code, message });
  let canonical: string;
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe artifact collection");
    canonical = realpathSync.native(resolve(root));
    qualityOrdinaryParents(canonical);
  } catch {
    return {
      hash: qualityContentHash([]),
      runIds: [],
      recordFiles,
      blockers: [
        { code: "RETENTION_STORAGE", store: ".", message: "Restore an ordinary artifact collection before pruning." },
      ],
    };
  }
  const projectId = projectMemoryProjectId(canonical);
  for (const store of [".quality", ".improvements"]) {
    const dir = join(canonical, store);
    if (!existsSync(dir) && !lstatSync(dir, { throwIfNoEntry: false })) continue;
    try {
      qualityOrdinaryParents(dir);
      const names = readdirSync(dir).sort(),
        maxEntries = store === ".quality" ? 192 : 196,
        maxRecord = store === ".quality" ? QUALITY_MAX_RECORD_BYTES : IMPROVEMENT_MAX_RECORD_BYTES;
      if (names.filter((name) => !ownLocks.has(join(dir, name))).length > maxEntries)
        throw new Error("Reference entry budget exceeded");
      let bytes = 0,
        count = 0;
      for (const name of names) {
        const file = join(dir, name);
        if (ownLocks.has(file)) continue;
        const stat = lstatSync(file);
        const valid =
          store === ".quality"
            ? /^quality_[a-f0-9]{24}\.json(?:\.lock|\.[a-f0-9-]{36}\.tmp)?$/.test(name)
            : name === "catalog.lock" ||
              /^improvement_[a-f0-9-]{36}\.json(?:\.lock|\.recover\.lock|\.[a-f0-9-]{36}\.tmp)?$/.test(name);
        if (!valid || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          throw new Error("Unsupported reference entry");
        bytes += stat.size;
        if (stat.size > maxRecord || bytes > 16_777_216) throw new Error("Reference byte budget exceeded");
        if (name.endsWith(".lock") || name.endsWith(".tmp")) {
          unavailable(
            store,
            "RETENTION_BUSY",
            "A reference writer is active or interrupted; inspect its lock or incomplete write before pruning.",
          );
          continue;
        }
        count++;
        if (store === ".improvements" && count > IMPROVEMENT_MAX_SESSIONS) throw new Error("Session limit exceeded");
        const body = readQualityBytes(file, maxRecord),
          value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
        if (store === ".quality") {
          const record = parseQualityRecord(value);
          if (
            record.projectId !== projectId ||
            containsSensitiveValue(record) ||
            name !== `quality_${qualityContentHash({ projectId, runId: record.runId }).slice(0, 24)}.json`
          )
            throw new Error("Quality reference identity mismatch");
          runIds.add(record.runId);
          for (const report of record.reports) {
            runIds.add(report.binding.runId);
            for (const issue of report.issues) for (const evidence of issue.evidence) runIds.add(evidence.runId);
            for (const history of report.history) runIds.add(history.runId);
          }
        } else {
          const session = parseImprovementSession(value);
          if (
            session.plan.projectId !== projectId ||
            containsSensitiveValue(session) ||
            name !== `${session.plan.id}.json`
          )
            throw new Error("Improvement reference identity mismatch");
          runIds.add(session.plan.baseline.runId);
          for (const attempt of session.attempts)
            if (attempt.result?.candidateRunId) runIds.add(attempt.result.candidateRunId);
        }
        records.push([`${store}/${name}`, sha256(body)]);
        recordFiles.push(file);
      }
    } catch {
      unavailable(
        store,
        "RETENTION_STORAGE",
        "Reference records are corrupt, unsafe or outside their read budget; restore them before pruning.",
      );
    }
  }
  return { hash: qualityContentHash({ projectId, records }), runIds: [...runIds].sort(), blockers, recordFiles };
}
