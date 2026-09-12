export function lookup(query: string): string {
  if (!query.trim()) return "empty";
  return `found:${query.trim()}`;
}

export function parse(text: string): { tokens: string[] } {
  const tokens = String(text).split(/\s+/).filter(Boolean);
  return { tokens };
}

export function compute(tokens: string[]): number {
  return tokens.length;
}

export function failTool(reason = "tool_failed"): never {
  throw new Error(reason);
}

export const demoTools: Record<string, (args: unknown) => unknown> = {
  lookup: (args) => lookup(String((args as { q: string }).q)),
  parse: (args) => parse(String((args as { text: string }).text)),
  compute: (args) => compute((args as { tokens: string[] }).tokens),
  fail: () => failTool(),
};
