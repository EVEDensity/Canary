import type { CoverageFragment, CoverageScript } from "@canary/core";

export function fragmentKey(fragment: Pick<CoverageFragment, "executionId" | "processId" | "isolateId" | "sequence">): string {
  return `${fragment.executionId}:${fragment.processId ?? 0}:${fragment.isolateId ?? ""}:${fragment.sequence ?? 0}`;
}

export function dedupeCoverageFragments(fragments: CoverageFragment[]): CoverageFragment[] {
  const seen = new Set<string>();
  const result: CoverageFragment[] = [];
  for (const fragment of fragments) {
    const key = fragmentKey(fragment);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fragment);
  }
  return result;
}

function rangeKey(name: string, start: number, end: number): string {
  return `${name}:${start}:${end}`;
}

export function mergeV8Scripts(groups: CoverageScript[][]): CoverageScript[] {
  const byUrl = new Map<string, CoverageScript>();
  for (const scripts of groups) {
    for (const script of scripts) {
      const key = script.url || script.scriptId || "";
      const existing = byUrl.get(key);
      if (!existing) {
        byUrl.set(key, { ...script, functions: script.functions.map((fn) => ({ functionName: fn.functionName, ranges: fn.ranges.map((range) => ({ ...range })) })) });
        continue;
      }
      if (!existing.source && script.source) existing.source = script.source;
      if (!existing.sourceMap && script.sourceMap) existing.sourceMap = script.sourceMap;
      const counts = new Map<string, { functionName: string; startOffset: number; endOffset: number; count: number }>();
      for (const fn of existing.functions) {
        for (const range of fn.ranges) counts.set(rangeKey(fn.functionName, range.startOffset, range.endOffset), { functionName: fn.functionName, ...range });
      }
      for (const fn of script.functions) {
        for (const range of fn.ranges) {
          const id = rangeKey(fn.functionName, range.startOffset, range.endOffset);
          const prev = counts.get(id);
          if (prev) prev.count = Math.max(prev.count, range.count);
          else counts.set(id, { functionName: fn.functionName, ...range });
        }
      }
      const grouped = new Map<string, CoverageScript["functions"][number]["ranges"]>();
      for (const item of counts.values()) {
        const list = grouped.get(item.functionName) ?? [];
        list.push({ startOffset: item.startOffset, endOffset: item.endOffset, count: item.count });
        grouped.set(item.functionName, list);
      }
      existing.functions = [...grouped.entries()].map(([functionName, ranges]) => ({ functionName, ranges }));
    }
  }
  return [...byUrl.values()];
}

export function mergeCoverageFragments(fragments: CoverageFragment[]): CoverageScript[] {
  return mergeV8Scripts(dedupeCoverageFragments(fragments).map((fragment) => fragment.scripts));
}
