/** Output-boundary sanitization. Evaluation always uses the original in-memory values. */
export const SECRET_KEY =
  /api[_-]?key|(?:^|[_-])token(?:$|[_-])|accessToken|refreshToken|password|passwd|secret|authorization$|cookies?$|credentials?$|private[_-]?key/i;
const PATTERNS = [
  /\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g,
  /((?:api[_-]?key|token|password|passwd|secret|authorization|cookie)\s*[=:]\s*["']?)[^\s"'&,;}]+/gi,
  /(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,
];
export interface RedactionOptions {
  maxStringLength?: number;
  replacement?: string;
  secretValues?: string[];
}

export function collectSecretValues(value: unknown): string[] {
  const found = new Set<string>();
  const seen = new WeakSet<object>();
  const walk = (item: unknown, sensitive = false): void => {
    if (typeof item === "string" && sensitive && item.length >= 4 && item !== "[redacted]") found.add(item);
    if (item && typeof item === "object" && !seen.has(item)) {
      seen.add(item);
      for (const [key, child] of Object.entries(item)) walk(child, sensitive || SECRET_KEY.test(key));
    }
  };
  walk(value);
  return [...found];
}

function replaceText(value: string, options: RedactionOptions): string {
  const replacement = options.replacement ?? "[redacted]";
  let next = value;
  for (const secret of options.secretValues ?? [])
    if (secret.length >= 4 && secret !== replacement) next = next.split(secret).join(replacement);
  for (const pattern of PATTERNS) next = next.replace(pattern, replacement);
  return next;
}

export function redactText(value: string, options: RedactionOptions = {}): string {
  return replaceText(value, {
    ...options,
    secretValues: [...collectSecretValues(process.env), ...(options.secretValues ?? [])],
  });
}

export function redactValue(value: unknown, options: RedactionOptions = {}, key?: string): unknown {
  const resolved = {
    ...options,
    secretValues: [
      ...new Set([...collectSecretValues(process.env), ...(options.secretValues ?? []), ...collectSecretValues(value)]),
    ],
  };
  const walk = (item: unknown, name?: string): unknown => {
    if (name && SECRET_KEY.test(name)) return options.replacement ?? "[redacted]";
    if (typeof item === "string") {
      const clean = replaceText(item, resolved);
      const max = options.maxStringLength ?? 2048;
      return clean.length > max ? `${clean.slice(0, max)}…` : clean;
    }
    if (Array.isArray(item)) return item.map((child) => walk(child));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([field, child]) => [replaceText(field, resolved), walk(child, field)]),
      );
    return item;
  };
  return walk(value, key);
}

/** Never returns matched values. This is a detector, not proof that arbitrary secrets can be recognized. */
export function containsSensitiveText(value: string, options: RedactionOptions = {}): boolean {
  return redactText(value, options) !== value;
}

export function containsSensitiveValue(value: unknown, options: RedactionOptions = {}): boolean {
  return JSON.stringify(redactValue(value, { ...options, maxStringLength: Infinity })) !== JSON.stringify(value);
}
