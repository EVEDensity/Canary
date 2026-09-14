import { assertHostAllowed, assertToolAllowed, PolicyDenied, type EvolutionPolicyDocument } from "@canary/policy";

export interface NetworkProxyOptions {
  allowHosts: string[];
}

export function assertIsolatedNetwork(url: string, options: NetworkProxyOptions): void {
  assertHostAllowed(url, options.allowHosts);
}

export function assertIsolatedTool(name: string, allow: string[]): void {
  assertToolAllowed(name, allow);
}

export function denyUncontrolledMcp(): never {
  throw new PolicyDenied("POL-03", "MCP process spawn is not authorized in isolation");
}

export function proxyPolicyHosts(policy: EvolutionPolicyDocument, extra?: string[]): string[] {
  return extra?.length ? extra : policy.networkAllowHosts;
}
