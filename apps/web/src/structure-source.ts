import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { StructureSnapshot } from "@canary/structure";

export interface StructureSourceDetail {
  nodeId: string;
  path: string;
  availability: "current-hash-match" | "git-hash-match" | "unavailable";
  startLine?: number;
  endLine?: number;
  lines?: string[];
  expectedHash: string;
}

const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

/** Source is shown only when its bytes match the sealed R10 file hash. */
export function readStructureSource(snapshot: StructureSnapshot, nodeId: string, centerLine?: number): StructureSourceDetail | undefined {
  const node = snapshot.nodes.find((item) => item.id === nodeId);
  if (!node || !["file", "function", "class"].includes(node.kind)) return undefined;
  const file = snapshot.nodes.find((item) => item.kind === "file" && item.path === node.path);
  if (!file?.sourceHash || !/\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(file.path)) return undefined;
  const path = file.path;
  const unavailable: StructureSourceDetail = { nodeId, path, availability: "unavailable", expectedHash: file.sourceHash };
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "")) return unavailable;
  const root = resolve(snapshot.source.projectRoot);
  const full = resolve(root, path);
  const inside = (candidate: string) => {
    const rel = relative(realpathSync.native(root), candidate);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  let bytes: Buffer | undefined;
  let availability: StructureSourceDetail["availability"] = "unavailable";
  try {
    if (existsSync(full) && !lstatSync(full).isSymbolicLink() && inside(realpathSync.native(full))) {
      const current = readFileSync(full);
      if (sha256(current) === file.sourceHash) { bytes = current; availability = "current-hash-match"; }
    }
  } catch { /* Source may have moved or become unreadable. */ }
  if (!bytes && snapshot.source.gitCommit && /^[a-f0-9]{40,64}$/.test(snapshot.source.gitCommit)) {
    try {
      const historical = execFileSync("git", ["show", `${snapshot.source.gitCommit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      if (sha256(historical) === file.sourceHash) bytes = historical;
      else {
        // Git often stores LF while Windows checked-out source was CRLF.
        // Reconstruction is accepted only if the exact recorded byte hash matches.
        const checkout = Buffer.from(historical.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8");
        if (sha256(checkout) === file.sourceHash) bytes = checkout;
      }
      if (bytes) availability = "git-hash-match";
    } catch { /* Dirty or removed source may not exist in the commit. */ }
  }
  if (!bytes) return unavailable;
  const sourceLines = bytes.toString("utf8").split(/\r?\n/);
  const requested = centerLine && Number.isInteger(centerLine) && centerLine > 0 && centerLine <= sourceLines.length ? centerLine : undefined;
  const startLine = requested ? Math.max(1, requested - 12) : Math.max(1, (node.line ?? 1) - (node.kind === "file" ? 0 : 5));
  const endLine = requested ? Math.min(sourceLines.length, startLine + 39) : Math.min(sourceLines.length, Math.max(startLine, node.endLine ? node.endLine + 5 : startLine + 79), startLine + 79);
  return { nodeId, path, availability, startLine, endLine, lines: sourceLines.slice(startLine - 1, endLine), expectedHash: file.sourceHash };
}
