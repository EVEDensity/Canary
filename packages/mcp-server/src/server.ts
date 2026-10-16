import {
  CLIENT_CAPABILITIES_KEY,
  COMPATIBILITY_MATRIX,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE,
  LEGACY_PROTOCOL_VERSION,
  MCP_INVALID_TOKEN,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_KEY,
  REQUEST_CANCELLED,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  isRecord,
  isSupportedVersion,
  parseModernMeta,
  resultMeta,
  unsupportedVersion,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";
import { isCanaryTool, parseEvidenceArgs, parseProposalArgs, parseRunArgs, parseStructureArgs, parseVerificationArgs, parseOperationArgs, toolList, type CanaryMcpPorts } from "./tools.js";

export interface CanaryMcpServerOptions {
  token: string;
  ports: CanaryMcpPorts;
  maxConcurrent?: number;
}

type Era = "undetermined" | "legacy" | "modern";

export class CanaryMcpServer {
  readonly token: string;
  readonly ports: CanaryMcpPorts;
  readonly maxConcurrent: number;
  private era: Era = "undetermined";
  private legacyInitialized = false;
  private inFlight = 0;
  private readonly inflightById = new Map<string | number, AbortController>();
  private readonly cancelled = new Set<string | number>();

  constructor(options: CanaryMcpServerOptions) {
    if (!options.token.trim()) throw new Error("MCP server token is required");
    this.token = options.token;
    this.ports = options.ports;
    this.maxConcurrent = options.maxConcurrent ?? 1;
  }

  handleLine(line: string): JsonRpcResponse | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch {
      return { jsonrpc: "2.0", id: null, error: { code: JSONRPC_PARSE, message: "Parse error" } };
    }
    return this.handleMessage(parsed);
  }

  handleMessage(raw: unknown): JsonRpcResponse | null {
    if (Array.isArray(raw)) {
      return { jsonrpc: "2.0", id: null, error: { code: JSONRPC_INVALID_REQUEST, message: "JSON-RPC batches are not supported" } };
    }
    if (!isRecord(raw) || raw.jsonrpc !== "2.0") {
      const id = isRecord(raw) && (typeof raw.id === "string" || typeof raw.id === "number") ? raw.id : null;
      return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_REQUEST, message: "Invalid Request" } };
    }
    const message = raw as JsonRpcRequest;
    if (typeof message.method !== "string") {
      if (message.id === undefined) return null;
      return { jsonrpc: "2.0", id: message.id ?? null, error: { code: JSONRPC_INVALID_REQUEST, message: "Invalid Request" } };
    }
    if (message.method.startsWith("notifications/")) {
      this.handleNotification(message.method, message.params);
      return null;
    }
    if (message.id === undefined || message.id === null) {
      return { jsonrpc: "2.0", id: null, error: { code: JSONRPC_INVALID_REQUEST, message: "requests require an id" } };
    }
    return this.handleRequest(message);
  }

  async handleRequestAsync(raw: unknown): Promise<JsonRpcResponse | null> {
    let message: unknown = raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try { message = JSON.parse(trimmed); }
      catch {
        return { jsonrpc: "2.0", id: null, error: { code: JSONRPC_PARSE, message: "Parse error" } };
      }
    }
    const sync = this.handleMessage(message);
    if (!sync || !("result" in sync) || !isPending(sync.result)) return sync;
    const id = sync.id;
    if ((typeof id === "string" || typeof id === "number") && this.cancelled.has(id)) {
      this.cancelled.delete(id);
      return { jsonrpc: "2.0", id, error: { code: REQUEST_CANCELLED, message: "Request cancelled" } };
    }
    if (this.inFlight >= this.maxConcurrent) {
      return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_REQUEST, message: "resource limit: max concurrent tool calls" } };
    }
    const controller = new AbortController();
    if (typeof id === "string" || typeof id === "number") this.inflightById.set(id, controller);
    this.inFlight += 1;
    try {
      const result = await (sync.result as Pending).run(controller.signal);
      return { jsonrpc: "2.0", id, result: withMeta(result, this.era) };
    } catch (error) {
      if (controller.signal.aborted) {
        return { jsonrpc: "2.0", id, error: { code: REQUEST_CANCELLED, message: "Request cancelled" } };
      }
      const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : JSONRPC_INVALID_PARAMS;
      return { jsonrpc: "2.0", id, error: { code, message: error instanceof Error ? error.message : String(error) } };
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
      if (typeof id === "string" || typeof id === "number") {
        this.inflightById.delete(id);
        this.cancelled.delete(id);
      }
    }
  }

  reconnect(): void {
    this.era = "undetermined";
    this.legacyInitialized = false;
    for (const controller of this.inflightById.values()) controller.abort();
    this.inflightById.clear();
    this.cancelled.clear();
    this.inFlight = 0;
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "notifications/initialized") {
      if (this.era === "legacy") this.legacyInitialized = true;
      return;
    }
    if (method === "notifications/cancelled") {
      const requestId = isRecord(params) ? params.requestId : undefined;
      if (typeof requestId === "string" || typeof requestId === "number") {
        this.cancelled.add(requestId);
        this.inflightById.get(requestId)?.abort();
      }
    }
  }

  private handleRequest(message: JsonRpcRequest): JsonRpcResponse {
    const id = message.id as number | string;
    const method = String(message.method);
    const hasMeta = isRecord(message.params) && "_meta" in message.params;

    if (method === "initialize" && !hasMeta) return this.legacyInitialize(id, message.params);
    if (hasMeta) return this.modernRequest(id, method, message.params);
    if (this.era === "legacy") return this.legacyRequest(id, method, message.params);
    if (method === "server/discover") {
      return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_PARAMS, message: "server/discover requires modern params._meta" } };
    }
    return { jsonrpc: "2.0", id, error: { code: JSONRPC_METHOD_NOT_FOUND, message: `Method not found: ${method}` } };
  }

  private legacyInitialize(id: number | string, params: unknown): JsonRpcResponse {
    if (!isRecord(params) || typeof params.protocolVersion !== "string") {
      return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_PARAMS, message: "initialize requires protocolVersion" } };
    }
    if (params.protocolVersion !== LEGACY_PROTOCOL_VERSION) {
      if (params.protocolVersion === MODERN_PROTOCOL_VERSION) {
        return { jsonrpc: "2.0", id, error: unsupportedVersion(params.protocolVersion) };
      }
      if (!isSupportedVersion(params.protocolVersion)) {
        return { jsonrpc: "2.0", id, error: unsupportedVersion(params.protocolVersion) };
      }
      return { jsonrpc: "2.0", id, error: unsupportedVersion(params.protocolVersion) };
    }
    this.era = "legacy";
    this.legacyInitialized = false;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: LEGACY_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: "Canary MCP Server. Tools cannot write source or raise authorization.",
      },
    };
  }

  private legacyRequest(id: number | string, method: string, params: unknown): JsonRpcResponse {
    if (!this.legacyInitialized && method !== "ping") {
      return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_REQUEST, message: "legacy session is not initialized" } };
    }
    return this.dispatch(id, method, params, "legacy");
  }

  private modernRequest(id: number | string, method: string, params: unknown): JsonRpcResponse {
    const parsed = parseModernMeta(params);
    if (!parsed.ok) return { jsonrpc: "2.0", id, error: parsed.error };
    this.era = "modern";
    if (method === "initialize") {
      return { jsonrpc: "2.0", id, error: { code: JSONRPC_METHOD_NOT_FOUND, message: "initialize is a legacy handshake; modern clients use server/discover and per-request _meta" } };
    }
    return this.dispatch(id, method, params, "modern");
  }

  private dispatch(id: number | string, method: string, params: unknown, era: Era): JsonRpcResponse {
    if (method === "ping") return { jsonrpc: "2.0", id, result: era === "modern" ? { _meta: resultMeta() } : {} };
    if (method === "server/discover") {
      if (era !== "modern") return { jsonrpc: "2.0", id, error: { code: JSONRPC_METHOD_NOT_FOUND, message: "server/discover is a modern method" } };
      return {
        jsonrpc: "2.0",
        id,
        result: {
          supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          capabilities: { tools: {} },
          instructions: "Dual-era Canary MCP Server. Sampling is not implemented.",
          _meta: resultMeta(),
        },
      };
    }
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: withMeta(toolList(), era) };
    if (method === "tools/call") return { jsonrpc: "2.0", id, result: pending((signal) => this.callTool(params, signal)) };
    return { jsonrpc: "2.0", id, error: { code: JSONRPC_METHOD_NOT_FOUND, message: `Method not found: ${method}` } };
  }

  private async callTool(params: unknown, signal: AbortSignal): Promise<unknown> {
    if (!isRecord(params) || typeof params.name !== "string") throw Object.assign(new Error("tools/call requires name"), { code: JSONRPC_INVALID_PARAMS });
    const authError = this.authorize(params);
    if (authError) throw Object.assign(new Error(authError), { code: MCP_INVALID_TOKEN });
    if (!isCanaryTool(params.name)) throw Object.assign(new Error(`Unknown or disabled tool: ${params.name}`), { code: JSONRPC_METHOD_NOT_FOUND });
    const args = isRecord(params.arguments) ? params.arguments : params.arguments === undefined ? {} : undefined;
    if (args === undefined) throw Object.assign(new Error("arguments must be an object"), { code: JSONRPC_INVALID_PARAMS });
    if (params.name === "canary.run") {
      const input = parseRunArgs(args);
      const value = await this.ports.run(input, signal);
      return toolContent(value);
    }
    if (params.name === "canary.evidence") {
      return toolContent(this.ports.evidence(parseEvidenceArgs(args)));
    }
    if (params.name === "canary.structure") {
      return toolContent(this.ports.structure(parseStructureArgs(args)));
    }
    if (params.name === "canary.diagnostics") {
      if (!this.ports.diagnostics) throw new Error("Diagnostics are unavailable in this binding");
      return toolContent(this.ports.diagnostics(parseEvidenceArgs(args, "canary.diagnostics")));
    }
    if (params.name === "canary.verification") {
      if (!this.ports.verification) throw new Error("Verification evidence is unavailable in this binding");
      return toolContent(await this.ports.verification(parseVerificationArgs(args)));
    }
    if (["canary.reproduce", "canary.repair_verify", "canary.change_verify"].includes(params.name)) {
      if (!this.ports.executeVerification) throw new Error("Verification execution is unavailable in this binding");
      return toolContent(await this.ports.executeVerification(parseOperationArgs(params.name, args), signal));
    }
    return toolContent(this.ports.submitProposal(parseProposalArgs(args)));
  }

  private authorize(params: Record<string, unknown>): string | undefined {
    const fromArgs = isRecord(params.arguments) ? params.arguments.token ?? params.arguments.authorization : undefined;
    if (fromArgs !== undefined) return "authorization cannot be supplied or raised by tool arguments";
    return undefined;
  }
}

interface Pending { pending: true; run: (signal: AbortSignal) => Promise<unknown> }
function pending(run: (signal: AbortSignal) => Promise<unknown>): Pending { return { pending: true, run }; }
function isPending(value: unknown): value is Pending {
  return Boolean(value) && typeof value === "object" && (value as Pending).pending === true;
}

function withMeta(result: unknown, era: Era): unknown {
  if (era !== "modern") return result;
  if (!isRecord(result)) return { value: result, _meta: resultMeta() };
  return { ...result, _meta: { ...(isRecord(result._meta) ? result._meta : {}), ...resultMeta() } };
}

function toolContent(value: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false };
}

export function requireServerToken(presented: string | undefined, expected: string): void {
  if (!presented || presented !== expected) {
    const error = new Error("MCP authorization token is missing or invalid") as Error & { code: number };
    error.code = MCP_INVALID_TOKEN;
    throw error;
  }
}

export { PROTOCOL_VERSION_KEY, CLIENT_CAPABILITIES_KEY, COMPATIBILITY_MATRIX };
