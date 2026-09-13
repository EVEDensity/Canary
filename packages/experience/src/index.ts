import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ActiveExperiencePointer, ExperienceRecord, ExperienceScope, ExperienceSourceKind, ExperienceStatus, LoadedExperience } from "@canary/core";

export const EXPERIENCE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_EXPERIENCE_MAX_ITEMS = 8;
export const DEFAULT_EXPERIENCE_MAX_CHARS = 8_000;
export const MAX_EXPERIENCE_CONTENT_CHARS = 4_096;

export interface ExperienceInput {
  key: string;
  projectRoot: string;
  source: { kind: ExperienceSourceKind; ref?: string };
  summary: string;
  content: string;
  counterexamples?: string[];
  scope?: Partial<ExperienceScope>;
  expiresAt?: string;
  expiryReason?: string;
}

export interface ExperienceLoadContext {
  projectRoot: string;
  caseId?: string;
  tags?: string[];
  featureIds?: string[];
  now?: string;
  maxItems?: number;
  maxChars?: number;
}

export interface ExperienceLoadResult {
  loaded: LoadedExperience[];
  skipped: Array<{ id: string; reason: string }>;
  totalChars: number;
}

export interface ExperienceValidation {
  valid: boolean;
  errors: string[];
  contentHash?: string;
}

const SECRET = /(api[_-]?key|access[_-]?token|authorization|bearer\s+[a-z0-9._-]+|password|passwd|secret|cookie|private\s+key)/i;
const INJECTION = /(ignore\s+(all|any|the|previous|prior)|system\s+message|developer\s+message|tool\s+output|reveal\s+(the|your)|exfiltrat|disable\s+(all\s+)?safety|you\s+are\s+now\s+the\s+system)/i;
const SAFE_KEY = /^[A-Za-z0-9._:-]{1,96}$/;

function nowIso(): string { return new Date().toISOString(); }
function hashContent(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; } }
function atomicWrite(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  writeFileSync(file, readFileSync(tmp, "utf8"), "utf8");
  try { unlinkSync(tmp); } catch { /* best effort; stale temp files are ignored */ }
}

export function validateExperienceInput(input: ExperienceInput, now = nowIso()): ExperienceValidation {
  const errors: string[] = [];
  if (!SAFE_KEY.test(input.key)) errors.push("key must contain only letters, numbers, '.', '_', ':' or '-'");
  if (!input.projectRoot || !resolve(input.projectRoot)) errors.push("projectRoot is required");
  if (!input.summary.trim()) errors.push("summary must not be empty");
  if (!input.content.trim()) errors.push("content must not be empty");
  if (input.content.length > MAX_EXPERIENCE_CONTENT_CHARS) errors.push(`content exceeds ${MAX_EXPERIENCE_CONTENT_CHARS} characters`);
  if (SECRET.test(input.content) || SECRET.test(input.summary)) errors.push("content or summary appears to contain sensitive data");
  if (INJECTION.test(input.content) || INJECTION.test(input.summary)) errors.push("content or summary appears to contain prompt/tool injection");
  if (input.source.kind === "tool_output") errors.push("tool output cannot become an experience rule");
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) errors.push("expiresAt must be an ISO date");
  if (input.expiresAt && input.expiresAt <= now) errors.push("expiresAt must be in the future");
  const contentHash = hashContent(input.content);
  return errors.length ? { valid: false, errors } : { valid: true, errors: [], contentHash };
}

function matchesScope(record: ExperienceRecord, context: ExperienceLoadContext): boolean {
  if (record.projectRoot !== context.projectRoot || record.scope.projectRoot !== context.projectRoot) return false;
  if (record.scope.caseIds?.length && (!context.caseId || !record.scope.caseIds.includes(context.caseId))) return false;
  if (record.scope.tags?.length && !record.scope.tags.some((tag) => context.tags?.includes(tag))) return false;
  if (record.scope.featureIds?.length && !record.scope.featureIds.some((id) => context.featureIds?.includes(id))) return false;
  return true;
}

export class ExperienceStore {
  readonly rootDir: string;
  private readonly recordsDir: string;
  private readonly pointerFile: string;
  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    this.recordsDir = resolve(this.rootDir, "records");
    this.pointerFile = resolve(this.rootDir, "active.json");
    mkdirSync(this.recordsDir, { recursive: true });
  }
  private recordFile(id: string): string { return resolve(this.recordsDir, `${id}.json`); }
  get(id: string): ExperienceRecord | undefined {
    const record = readJson<ExperienceRecord | undefined>(this.recordFile(id), undefined);
    return record?.v === EXPERIENCE_SCHEMA_VERSION ? record : undefined;
  }
  list(): ExperienceRecord[] {
    if (!existsSync(this.recordsDir)) return [];
    const records: ExperienceRecord[] = [];
    // The directory is intentionally small and bounded by the caller's authoring process.
    for (const file of readdirSync(this.recordsDir)) {
      if (!file.endsWith(".json")) continue;
      const record = this.get(file.slice(0, -5));
      if (record) records.push(record);
    }
    return records.sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version);
  }
  activePointer(projectRoot: string): ActiveExperiencePointer {
    const pointer = readJson<ActiveExperiencePointer>(this.pointerFile, { v: 1, projectRoot, entries: [], updatedAt: nowIso() });
    return pointer.projectRoot === projectRoot ? pointer : { v: 1, projectRoot, entries: [], updatedAt: nowIso() };
  }
  propose(input: ExperienceInput): ExperienceRecord {
    const validation = validateExperienceInput(input);
    if (!validation.valid) throw new Error(`Experience rejected: ${validation.errors.join("; ")}`);
    const versions = this.list().filter((item) => item.projectRoot === input.projectRoot && item.key === input.key);
    const version = (versions[0]?.version ?? 0) + 1;
    const stamp = nowIso();
    const record: ExperienceRecord = {
      v: 1, id: `experience_${input.key.replace(/[^A-Za-z0-9_-]+/g, "-")}_${version}_${hashContent(input.content).slice(0, 12)}`,
      key: input.key, version, status: "proposed", projectRoot: resolve(input.projectRoot), source: { ...input.source }, summary: input.summary.trim(), content: input.content.trim(), contentHash: validation.contentHash!, counterexamples: [...(input.counterexamples ?? [])].slice(0, 16),
      scope: { projectRoot: resolve(input.projectRoot), ...(input.scope?.caseIds?.length ? { caseIds: [...new Set(input.scope.caseIds)] } : {}), ...(input.scope?.tags?.length ? { tags: [...new Set(input.scope.tags)] } : {}), ...(input.scope?.featureIds?.length ? { featureIds: [...new Set(input.scope.featureIds)] } : {}) },
      createdAt: stamp, updatedAt: stamp, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), ...(input.expiryReason ? { expiryReason: input.expiryReason } : {}),
    };
    atomicWrite(this.recordFile(record.id), record);
    return record;
  }
  transition(id: string, status: Ex