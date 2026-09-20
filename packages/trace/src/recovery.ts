import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ArtifactIntegrityError, atomicWrite, sha256 } from "./artifacts.js";

/** Only an invalid final, unterminated JSONL record can be discarded, with hashes retained. */
export function recoverTraceTail(
  dir: string,
): { originalHash: string; recoveredHash: string; removedBytes: number; removedHash: string } | undefined {
  const file = join(dir, "trace.jsonl");
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  const text = bytes.toString("utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
    } catch {
      if (i !== lines.length - 1)
        throw new ArtifactIntegrityError({
          v: 1,
          kind: "canary.artifact-integrity",
          runId: basename(dir),
          status: "invalid",
          issues: [{ code: "JSONL_MIDDLE_CORRUPT", path: "trace.jsonl" }],
        });
      const prefix = text.slice(0, text.lastIndexOf("\n") + 1);
      const removed = bytes.subarray(Buffer.byteLength(prefix));
      atomicWrite(file, prefix);
      return {
        originalHash: sha256(bytes),
        recoveredHash: sha256(prefix),
        removedBytes: removed.length,
        removedHash: sha256(removed),
      };
    }
  }
  return undefined;
}
