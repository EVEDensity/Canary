import { createHash } from "node:crypto";
import type { StructureSnapshot, StructureChange, StructureEdge } from "./index.js";

export interface ArchitectureFinding {
  id: string;
  code: "dependency-cycle" | "forbidden-layer-dependency" | "coupling-observation";
  severity: "error" | "warning" | "info";
  title: string;
  reason: string;
  nodeIds: string[];
  edgeIds: string[];
  paths: string[];
}
export interface ArchitectureAnalysis {
  v: 1; kind: "canary.architecture-analysis";
  source: StructureSnapshot["source"];
  findings: ArchitectureFinding[];
  omittedFindings: number;
  unresolvedRelations: number;
  basis: "resolved-static-imports-and-package-dependencies";
}

const dependency = (edge: StructureEdge) => edge.provenance === "static" && edge.certainty === "resolved" && ["imports", "package-dependency"].includes(edge.kind);
const stableId = (code: string, ids: string[]) => `${code}:${createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex").slice(0, 20)}`;

/** Iterative SCC traversal avoids overflowing the stack on a 10,000-file chain. */
function components(edges: StructureEdge[]): string[][] {
  const forward = new Map<string, string[]>(), reverse = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (!forward.has(from)) forward.set(from, []); if (!forward.has(to)) forward.set(to, []);
    if (!reverse.has(from)) reverse.set(from, []); if (!reverse.has(to)) reverse.set(to, []);
    forward.get(from)!.push(to); reverse.get(to)!.push(from);
  }
  const visited = new Set<string>(), order: string[] = [];
  for (const root of forward.keys()) {
    if (visited.has(root)) continue;
    const stack: Array<[string, boolean]> = [[root, false]];
    while (stack.length) {
      const [node, exiting] = stack.pop()!;
      if (exiting) { order.push(node); continue; }
      if (visited.has(node)) continue;
      visited.add(node); stack.push([node, true]);
      for (const target of forward.get(node) ?? []) if (!visited.has(target)) stack.push([target, false]);
    }
  }
  visited.clear(); const result: string[][] = [];
  for (const root of order.reverse()) {
    if (visited.has(root)) continue;
    const members: string[] = [], stack = [root]; visited.add(root);
    while (stack.length) { const node = stack.pop()!; members.push(node); for (const target of reverse.get(node) ?? []) if (!visited.has(target)) { visited.add(target); stack.push(target); } }
    if (members.length > 1 || (forward.get(root) ?? []).includes(root)) result.push(members.sort());
  }
  return result;
}

export function analyzeArchitecture(snapshot: StructureSnapshot): ArchitectureAnalysis {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node])), edges = snapshot.edges.filter(dependency);
  const findings: ArchitectureFinding[] = [];
  const add = (code: ArchitectureFinding["code"], severity: ArchitectureFinding["severity"], title: string, reason: string, ids: string[], related: StructureEdge[]) => {
    findings.push({ id: stableId(code, [...ids, ...related.map((edge) => edge.id)]), code, severity, title, reason, nodeIds: ids, edgeIds: related.map((edge) => edge.id), paths: [...new Set(ids.map((id) => nodes.get(id)?.path).filter((path): path is string => Boolean(path)))].sort() });
  };
  for (const members of components(edges)) {
    const ids = new Set(members), related = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    add("dependency-cycle", "warning", `${members.length} 个模块存在循环依赖`, "已解析的静态依赖构成环；需结合模块初始化及职责判断，不代表已发生运行错误。", members, related);
  }
  for (const edge of edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    const rule = snapshot.rules?.forbiddenDependencies.find((rule) => rule.from === from?.layerId && rule.to === to?.layerId);
    if (rule) add("forbidden-layer-dependency", "error", `${rule.from} → ${rule.to} 违反声明的分层规则`, rule.reason ?? "用户明确禁止该方向的层间依赖。", [edge.from, edge.to], [edge]);
  }
  for (const node of snapshot.nodes.filter((node) => ["file", "package", "app"].includes(node.kind))) {
    const incoming = edges.filter((edge) => edge.to === node.id), outgoing = edges.filter((edge) => edge.from === node.id);
    const fanIn = new Set(incoming.map((edge) => edge.from)).size, fanOut = new Set(outgoing.map((edge) => edge.to)).size;
    if (fanIn >= 8 || fanOut >= 8) add("coupling-observation", "info", `${node.path} · 扇入 ${fanIn} / 扇出 ${fanOut}`, "至少 8 个相邻模块是展示观察的阈值，不是架构质量门禁。", [node.id], [...incoming, ...outgoing]);
  }
  return { v: 1, kind: "canary.architecture-analysis", source: snapshot.source, findings: findings.slice(0, 200), omittedFindings: Math.max(0, findings.length - 200), unresolvedRelations: snapshot.unknown.length, basis: "resolved-static-imports-and-package-dependencies" };
}

export interface ImpactNode {
  nodeId: string; path: string; reason: "changed" | "consumer" | "package-member";
  via?: { nodeId: string; edgeId?: string };
}
export interface ChangeImpact {
  v: 1; kind: "canary.change-impact";
  source: StructureSnapshot["source"];
  baseline?: StructureChange["baseline"];
  changedPaths: string[];
  affected: ImpactNode[];
  confidence: "static-potential" | "unknown";
  fallbackReasons: string[];
  limitations: string[];
}

export function analyzeImpact(snapshot: StructureSnapshot, change?: StructureChange): ChangeImpact {
  if (change && (change.current.inventoryHash !== snapshot.source.inventoryHash || change.current.projectRoot !== snapshot.source.projectRoot)) throw new Error("Change and structure must refer to the same captured source");
  const fallbackReasons: string[] = [];
  if (!change) fallbackReasons.push("missing-git-baseline");
  const changedPaths = [...new Set((change?.entries ?? []).flatMap((entry) => [entry.path, ...(entry.previousPath ? [entry.previousPath] : [])]))].sort();
  const files = snapshot.nodes.filter((node) => node.kind === "file"), byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  if (change?.entries.some((entry) => ["deleted", "renamed"].includes(entry.status))) fallbackReasons.push("removed-or-renamed-dependencies-require-baseline-graph");
  if (changedPaths.some((path) => !files.some((file) => file.path === path))) fallbackReasons.push("changed-input-outside-structure");
  if (snapshot.unknown.some((item) => item.kind === "imports" || item.kind === "package-dependency" || item.kind === "symbols")) fallbackReasons.push("incomplete-static-dependency-graph");
  const adjacency = new Map<string, Array<{ nodeId: string; edgeId?: string; member?: boolean }>>();
  const connect = (from: string, to: string, edgeId?: string, member?: boolean) => { if (!adjacency.has(from)) adjacency.set(from, []); adjacency.get(from)!.push({ nodeId: to, edgeId, member }); };
  for (const edge of snapshot.edges.filter(dependency)) connect(edge.to, edge.from, edge.id);
  for (const file of files) {
    let parent = byId.get(file.parentId ?? "");
    while (parent && !["app", "package", "workspace"].includes(parent.kind)) parent = byId.get(parent.parentId ?? "");
    if (parent && ["app", "package"].includes(parent.kind)) { connect(file.id, parent.id, undefined, true); connect(parent.id, file.id, undefined, true); }
  }
  const affected = new Map<string, ImpactNode>(), queue: string[] = [];
  for (const file of files.filter((file) => changedPaths.includes(file.path))) { affected.set(file.id, { nodeId: file.id, path: file.path, reason: "changed" }); queue.push(file.id); }
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    for (const link of adjacency.get(id) ?? []) {
      if (affected.has(link.nodeId)) continue;
      const node = byId.get(link.nodeId); if (!node) continue;
      affected.set(node.id, { nodeId: node.id, path: node.path, reason: link.member ? "package-member" : "consumer", via: { nodeId: id, ...(link.edgeId ? { edgeId: link.edgeId } : {}) } }); queue.push(node.id);
    }
  }
  return { v: 1, kind: "canary.change-impact", source: snapshot.source, ...(change ? { baseline: change.baseline } : {}), changedPaths, affected: [...affected.values()], confidence: fallbackReasons.length ? "unknown" : "static-potential", fallbackReasons, limitations: ["潜在静态影响不证明实际执行或故障。", "调用图、外部服务及运行环境不用于缩减检查；检查范围声明须覆盖其全部项目输入。", "包依赖会保守扩展到包内全部文件。"] };
}

export interface ScopedCheck { id: string; required: boolean; dependsOn: string[]; type?: string; envAllowlist?: string[]; impact?: { paths?: string[]; always?: boolean } }
export interface CiSelectionPlan {
  v: 1; kind: "canary.ci-selection"; source: StructureSnapshot["source"];
  requested: "full" | "affected"; mode: "full" | "reduced";
  baseline?: StructureChange["baseline"];
  fallbackReasons: string[];
  checks: Array<{ id: string; action: "run" | "omit"; reason: string; matchedPaths: string[] }>;
  selectedCount: number; omittedCount: number;
}

export function matchImpactPath(pattern: string, path: string): boolean {
  if (!pattern || pattern.startsWith("/") || pattern.includes("..") || pattern.includes("\\")) throw new Error("Invalid impact path glob");
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") { i++; if (pattern[i + 1] === "/") { i++; source += "(?:.*/)?"; } else source += ".*"; }
    else if (pattern[i] === "*") source += "[^/]*";
    else if (pattern[i] === "?") source += "[^/]";
    else source += pattern[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(path);
}

export function planAffectedChecks(snapshot: StructureSnapshot, impact: ChangeImpact, checks: ScopedCheck[], requested = true, globalPaths: string[] = []): CiSelectionPlan {
  if (impact.source.inventoryHash !== snapshot.source.inventoryHash) throw new Error("Impact source mismatch");
  const fallbackReasons = requested ? [...impact.fallbackReasons] : [];
  if (requested && !impact.changedPaths.length) fallbackReasons.push("no-changed-inputs-run-full-to-avoid-empty-pass");
  if (requested && impact.changedPaths.some((path) => globalPaths.includes(path) || /(?:^|\/)(?:package\.json|(?:pnpm|package|yarn|bun).*lock.*|tsconfig[^/]*|canary\.[^/]*|[^/]*\.config\.[^/]*|\.env[^/]*|pyproject\.toml|requirements[^/]*|Cargo\.(?:toml|lock)|go\.(?:mod|sum))$/.test(path) || path.startsWith(".github/"))) fallbackReasons.push("global-configuration-changed");
  const paths = [...new Set([...impact.changedPaths, ...impact.affected.map((node) => node.path)])];
  const decisions = checks.map((check) => {
    const matches = (check.impact?.paths ?? []).flatMap((pattern) => paths.filter((path) => matchImpactPath(pattern, path)));
    const runtime = (check.type !== undefined && !["command", "filesystem"].includes(check.type)) || Boolean(check.envAllowlist?.length);
    const always = runtime || check.impact?.always || !check.impact?.paths?.length;
    const run = !requested || fallbackReasons.length > 0 || always || matches.length > 0;
    return { id: check.id, action: run ? "run" as const : "omit" as const, reason: !requested ? "default-full" : fallbackReasons.length ? "conservative-fallback" : runtime ? "runtime-or-environment-check" : always ? "always-or-unscoped" : matches.length ? "affected-input" : "declared-scope-unaffected", matchedPaths: [...new Set(matches)].sort().slice(0, 100) };
  });
  // A changed prerequisite can affect consumers even if their own file scope is unchanged.
  // An unconditional preparation/resource check alone does not claim its inputs changed.
  const changedChecks = new Set(decisions.filter((item) => item.reason === "affected-input").map((item) => item.id));
  for (const check of checks) if (check.dependsOn.some((id) => changedChecks.has(id))) {
    changedChecks.add(check.id); const decision = decisions.find((item) => item.id === check.id)!;
    if (decision.action === "omit") { decision.action = "run"; decision.reason = "affected-check-dependency"; }
  }
  const selected = new Set(decisions.filter((item) => item.action === "run").map((item) => item.id)), byId = new Map(checks.map((check) => [check.id, check]));
  const pending = [...selected];
  for (let i = 0; i < pending.length; i++) for (const id of byId.get(pending[i]!)?.dependsOn ?? []) {
    if (!byId.has(id)) throw new Error("Unknown CI check dependency");
    if (!selected.has(id)) { selected.add(id); pending.push(id); const decision = decisions.find((item) => item.id === id)!; decision.action = "run"; decision.reason = "required-check-dependency"; }
  }
  if (!checks.some((check) => check.required && selected.has(check.id))) {
    fallbackReasons.push("no-selected-required-check"); for (const decision of decisions) { decision.action = "run"; decision.reason = "conservative-fallback"; }
  }
  const omittedCount = decisions.filter((item) => item.action === "omit").length;
  return { v: 1, kind: "canary.ci-selection", source: snapshot.source, requested: requested ? "affected" : "full", mode: omittedCount ? "reduced" : "full", ...(impact.baseline ? { baseline: impact.baseline } : {}), fallbackReasons: [...new Set(fallbackReasons)], checks: decisions, selectedCount: decisions.length - omittedCount, omittedCount };
}
