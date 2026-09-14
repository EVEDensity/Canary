export { probeIsolation, requiredMode, PROCESS_BOUNDARY } from "./capability.js";
export type { IsolationCapability, IsolationMode, IsolationPurpose, ProcessBoundary } from "./capability.js";
export { buildIsolatedEnv } from "./env.js";
export { createIsolationPreload } from "./preload-source.js";
export { assertIsolationReady, writePreload, runIsolatedScript, isolationGuard, spawnIsolatedNode } from "./executor.js";
export type { IsolationRequest, IsolatedRunResult } from "./executor.js";
export { assertIsolatedNetwork, assertIsolatedTool, denyUncontrolledMcp, proxyPolicyHosts } from "./proxy.js";
