import type { AuthorizationRecord } from "@canary/core";
import { PolicyDenied, PathGuard, assertHostAllowed, assertToolAllowed } from "./paths.js";
import { isAuthorizationLive, type EvolutionPolicyDocument } from "./store.js";

export type PolId = "POL-01" | "POL-02" | "POL-03" | "POL-05" | "POL-06" | "POL-07" | "POL-09";

export interface PolicyAction {
  type:
    | "rewrite_acceptance"
    | "touch_path"
    | "network"
    | "tool"
    | "env"
    | "spawn"
    | "self_approve"
    | "offset_safety"
    | "activate_memory"
    | "import_config"
    | "predicate";
  path?: string;
  url?: string;
  tool?: string;
  envKey?: string;
  report?: Record<string, unknown>;
  qualityGain?: boolean;
  unauthorized?: boolean;
  content?: string;
  source?: string;
}

const INJECTION = /(ignore\s+(all|any|the|previous|prior)|system\s+message|you\s+are\s+now\s+the\s+system|disable\s+(all\s+)?safety)/i;

export function decidePolicy(input: {
  policy: EvolutionPolicyDocument;
  authorization?: AuthorizationRecord;
  action: PolicyAction;
  guard?: PathGuard;
  now?: Date;
}): { allow: true } | { allow: false; code: PolId | "POL-04"; reason: string } {
  try {
    enforcePolicy(input);
    return { allow: true };
  } catch (error) {
    if (error instanceof PolicyDenied) {
      return { allow: false, code: error.code as PolId, reason: error.message };
    }
    throw error;
  }
}

export function enforcePolicy(input: {
  policy: EvolutionPolicyDocument;
  authorization?: AuthorizationRecord;
  action: PolicyAction;
  guard?: PathGuard;
  now?: Date;
}): void {
  const { policy, authorization, action } = input;
  if (authorization) {
    const live = isAuthorizationLive(authorization, input.now);
    if (!live.ok) throw new PolicyDenied("POL-06", live.reason);
    if (resolveProject(authorization.projectRoot) !== resolveProject(policy.projectRoot)) {
      throw new PolicyDenied("POL-06", "authorization project does not match policy");
    }
  }

  if (action.type === "rewrite_acceptance") {
    throw new PolicyDenied("POL-01", "acceptance criteria and failing cases cannot be rewritten by a candidate");
  }
  if (action.type === "import_config" && action.source === "candidate") {
    throw new PolicyDenied("POL-01", "candidate config/predicate is not executed on the control plane");
  }
  if (action.type === "predicate" && action.source === "candidate") {
    throw new PolicyDenied("POL-01", "candidate predicates are not trusted policy");
  }
  if (action.type === "touch_path") {
    const guard = input.guard ?? new PathGuard({ workspace: policy.projectRoot, protect: policy.protect.map((item) => joinProject(policy.projectRoot, item)) });
    guard.assertAllowed(action.path ?? "", "write");
    if (authorization && !pathAllowedByAuth(action.path ?? "", authorization, policy.projectRoot)) {
      throw new PolicyDenied("POL-05", "quality gains cannot authorize an out-of-scope write");
    }
  }
  if (action.type === "network") {
    if (!authorization?.allow.actions.includes("network") && policy.networkAllowHosts.length === 0) {
      throw new PolicyDenied("POL-03", "network is not authorized");
    }
    assertHostAllowed(action.url ?? "", authorization?.network.allowHosts ?? policy.networkAllowHosts);
  }
  if (action.type === "tool") {
    assertToolAllowed(action.tool ?? "", authorization?.tools.allow ?? policy.toolAllow);
  }
  if (action.type === "env") {
    const key = action.envKey ?? "";
    const allow = new Set((authorization?.envAllowlist ?? policy.envAllowlist).map((item) => item.toUpperCase()));
    if (looksLikeSecret(key) || !allow.has(key.toUpperCase())) {
      throw new PolicyDenied("POL-03", `environment key is not allowlisted: ${key}`);
    }
  }
  if (action.type === "spawn") {
    throw new PolicyDenied("POL-03", "background child processes are not permitted inside isolation");
  }
  if (action.type === "self_approve") {
    const report = action.report ?? {};
    if (report.approved === true || report.status === "approved" || report.verified === true) {
      throw new PolicyDenied("POL-06", "candidate report fields cannot approve a proposal");
    }
    throw new PolicyDenied("POL-06", "proposals cannot approve themselves");
  }
  if (action.type === "offset_safety") {
    if (action.unauthorized || action.qualityGain) {
      throw new PolicyDenied("POL-05", "safety/state/required gates cannot be offset by a quality score");
    }
  }
  if (action.type === "activate_memory") {
    if (INJECTION.test(action.content ?? "") || action.source === "tool_output" || action.source === "trace") {
      throw new PolicyDenied("POL-09", "untrusted memory cannot be promoted to a system rule");
    }
  }
}

function resolveProject(value: string): string {
  return value.replace(/[/\\]+$/, "").toLowerCase();
}

function joinProject(root: string, rel: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${rel}`.replace(/\\/g, "/");
}

function pathAllowedByAuth(file: string, authorization: AuthorizationRecord, projectRoot: string): boolean {
  const allow = authorization.allow.paths;
  if (!allow.length) return false;
  const rel = file.replace(/\\/g, "/");
  return allow.some((pattern) => rel === pattern || rel.endsWith("/" + pattern) || rel.includes(`/${pattern}/`) || rel.startsWith(pattern) || rel.replace(/\\/g, "/").includes(pattern.replace(/\\/g, "/")));
}

export function looksLikeSecret(key: string): boolean {
  return /(secret|token|password|passwd|api[_-]?key|access[_-]?key|authorization|credential|private)/i.test(key);
}

export function isolationMissing(policy: EvolutionPolicyDocument, osAvailable: boolean, purpose: "untrusted_candidate" | "auto_hard_write"): never | void {
  if (purpose === "auto_hard_write" && policy.isolation.osRequiredForAutoHard && !osAvailable) {
    throw new PolicyDenied("POL-03", "OS isolation is unavailable; auto hard write is refused (fail closed)");
  }
  if (policy.isolation.mode === "none" && purpose !== "untrusted_candidate") {
    throw new PolicyDenied("POL-03", "isolation disabled; only trusted manual suggestions remain");
  }
}
