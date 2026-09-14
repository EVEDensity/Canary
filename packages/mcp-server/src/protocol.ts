export const LEGACY_PROTOCOL_VERSION = "2025-11-25";
export const MODERN_PROTOCOL_VERSION = "2026-07-28";
export const SUPPORTED_PROTOCOL_VERSIONS = [MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION] as const;
export type SupportedProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const JSONRPC_PARSE = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;
export const REQUEST_CANCELLED = -32800;
export const MCP_INVALID_TOKEN = -32001;

export const SERVER_INFO = { name: "canary-mcp-server", version: "0.1.0" } as const;

export const TOOL_NAMES = ["canary.run", "canary.evidence", "canary.submit_proposal"] as const;
export type CanaryMcpToolName = (typeof TOOL_NAMES)[number];

export const COMPATIBILITY_MATRIX = {
  v: 1 as const,
  protocols: [...SUPPORTED_PROTOCOL_VERSIONS],
  transports: ["stdio-ndjson", "in-process"],
  hosts: ["dual-era stdio MCP clients; Canary test client"],
  sdk: "@canary/mcp-server@0.1.0",
  tools: [...TOOL_NAMES],
  sampling: false,
  sourceWrite: false,
  streamableHttpSession: false,
};

export const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
export const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
export const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
export const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: number | string | null;
  method?: unknown;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface ModernMeta {
  protocolVersion: string;
  clientInfo?: { name?: string; version?: string };
  clientCapabilities: Record<string, unknown>;
}

export function isSupportedVersion(value: string): value is SupportedProtocolVersion {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export function unsupportedVersion(requested: string): JsonRpcError {
  return {
    code: UNSUPPORTED_PROTOCOL_VERSION,
    message: "Unsupported protocol version",
    data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested },
  };
}

export function parseModernMeta(params: unknown): { ok: true; meta: ModernMeta } | { ok: false; error: JsonRpcError } {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { ok: false, error: { code: JSONRPC_INVALID_PARAMS, message: "modern requests require params._meta" } };
  }
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { ok: false, error: { code: JSONRPC_INVALID_PARAMS, message: "missing params._meta for modern MCP" } };
  }
  const record = meta as Record<string, unknown>;
  const protocolVersion = record[PROTOCOL_VERSION_KEY];
  const capabilities = record[CLIENT_CAPABILITIES_KEY];
  if (typeof protocolVersion !== "string") {
    return { ok: false, error: { code: JSONRPC_INVALID_PARAMS, message: `${PROTOCOL_VERSION_KEY} is required` } };
  }
  if (protocolVersion === LEGACY_PROTOCOL_VERSION) {
    return { ok: false, error: { code: JSONRPC_INVALID_PARAMS, message: "legacy 2025-11-25 must use initialize, not per-request _meta" } };
  }
  if (!isSupportedVersion(protocolVersion) || protocolVersion !== MODERN_PROTOCOL_VERSION) {
    return { ok: false, error: unsupportedVersion(protocolVersion) };
  }
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return { ok: false, error: { code: JSONRPC_INVALID_PARAMS, message: `${CLIENT_CAPABILITIES_KEY} is required` } };
  }
  const info = record[CLIENT_INFO_KEY];
  return {
    ok: true,
    meta: {
      protocolVersion,
      clientCapabilities: capabilities as Record<string, unknown>,
      clientInfo: info && typeof info === "object" && !Array.isArray(info) ? info as { name?: string; version?: string } : undefined,
    },
  };
}

export function resultMeta(): Record<string, unknown> {
  return { [SERVER_INFO_KEY]: SERVER_INFO };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
