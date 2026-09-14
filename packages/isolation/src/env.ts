import { looksLikeSecret, DEFAULT_ENV_ALLOWLIST } from "@canary/policy";

export function buildIsolatedEnv(allowlist: string[] = DEFAULT_ENV_ALLOWLIST, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const allow = new Set(allowlist.map((key) => key.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (looksLikeSecret(key)) continue;
    if (key === "NODE_OPTIONS") continue;
    if (allow.has(key.toUpperCase())) env[key] = value;
  }
  env.NODE_OPTIONS = "";
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && !looksLikeSecret(key)) env[key] = value;
  }
  return env;
}
