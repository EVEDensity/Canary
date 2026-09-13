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
  try { unlinkSync(tmp); } catch { /* best effort; stale temp files