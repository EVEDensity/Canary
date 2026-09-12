import { spawn } from "node:child_process";
import type { AgentAdapterKind } from "@canary/core";

export interface AgentInput { value: unknown }
export interface AgentOutput { value: unknown }
export interface AgentContext { executionId: string; emit: (event: unknown) => void }
export interface AgentAdapter { id: string; kind: AgentAdapterKind; run(input: AgentInput, context: AgentContext): Promise<AgentOutput> }
export type ToolAdapterKind = "mock" | "mcp-stdio" | "mcp-http";
export interface ToolAdapter { readonly kind: ToolAdapterKind; call(name: string, args: unknown): Promise<unknown>; close(): Promise<void> }
export type { ModelCompletion, ModelProvider, ModelProviderKind } from "./model.js";
export { createModelProvider, DeterministicModelProvider, EchoModelProvider } from "./model.js";
export interface ToolAdapterConfig {
  adapter: ToolAdapterKind;
  entry?: string;
  export?: string;
  command?: string;
  args?: string[];
  url?: string;
  tools?: Record<string, (args: unknown) => unknown | Promise<unknown>>;
}

export function createFunctionAdapter(agent: (input: unknown, context: AgentContext) => Promise<unknown> | unknown): AgentAdapter {
  return {
    id: "function",
    kind: "function",
    async run(input, context) { return { value: await agent(input.value, context) }; },
  };
}

export async function runHttpAgent(url: string, input: unknown, timeoutMs = 10_000, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }), signal: combined });
    if (!response.ok) throw new Error(`HTTP agent failed with status ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function createHttpAdapter(url: string): AgentAdapter {
  return {
    id: "http",
    kind: "http",
    async run(input, context) {
      context.emit({ type: "http.request", url });
      const value = await runHttpAgent(url, input.value);
      context.emit({ type: "http.response" });
      return { value };
    },
  };
}

export async function runMcpAgent(command: string, args: string[], input: unknown, timeoutMs = 10_000, signal?: AbortSignal): Promise<unknown> {
  const adapter = new McpStdioToolAdapter(command, args);
  const timer = setTimeout(() => { void adapter.close(); }, timeoutMs);
  const onAbort = (): void => { void adapter.close(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try { return await adapter.call("run", input); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    await adapter.close();
  }
}

export function createMcpAdapter(command: string, args: string[] = []): AgentAdapter {
  return {
    id: "mcp",
    kind: "mcp",
    async run(input, context) {
      context.emit({ type: "mcp.request", command });
      const value = await runMcpAgent(command, args, input.value);
      context.emit({ type: "mcp.response" });
      return { value };
    },
  };
}

export class MockToolAdapter implements ToolAdapter {
  readonly kind = "mock" as const;
  constructor(private readonly tools: Record<string, (args: unknown) => unknown | Promise<unknown>>) {}
  async call(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools[name];
    if (!tool) throw new Error(`Unknown mock tool: ${name}`);
    return tool(args);
  }
  async close(): Promise<void> { /* in-memory */ }
}

export class McpStdioToolAdapter implements ToolAdapter {
  readonly kind = "mcp-stdio" as const;
  private child?: ReturnType<typeof spawn>;
  private buffer = "";
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly command: string, private readonly args: string[] = []) {}

  async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
          if (typeof message.id !== "number") continue;
          const waiter = this.pending.get(message.id);
          if (!waiter) continue;
          this.pending.delete(message.id);
          if (message.error) waiter.reject(new Error(message.error.message ?? "MCP tool error"));
          else waiter.resolve(message.result);
        } catch { /* ignore malformed MCP lines */ }
      }
    });
    this.child.once("exit", () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("MCP stdio process exited"));
      this.pending.clear();
    });
  }

  async call(name: string, args: unknown): Promise<unknown> {
    await this.start();
    if (!this.child?.stdin) throw new Error("MCP stdio adapter is not started");
    const id = ++this.seq;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child?.stdin?.write(payload, (error) => { if (error) { this.pending.delete(id); reject(error); } });
    });
  }

  async close(): Promise<void> {
    if (!this.child) return;
    this.child.stdin?.end();
    this.child.kill();
    this.child = undefined;
  }
}

async function readMcpHttpResult(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    let last: { result?: unknown; error?: { message?: string } } | undefined;
    for (const block of text.split("\n\n")) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try { last = JSON.parse(line.slice(5).trim()) as { result?: unknown; error?: { message?: string } }; }
        catch { /* ignore malformed SSE data */ }
      }
    }
    if (!last) throw new Error("MCP HTTP SSE response did not include a JSON-RPC result");
    if (last.error) throw new Error(last.error.message ?? "MCP HTTP error");
    return last.result;
  }
  const payload = await response.json() as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "MCP HTTP error");
  return payload.result;
}

/** JSON-RPC POST + optional SSE body. Not the full MCP Streamable HTTP session spec (out of v0.1). */
export class McpHttpToolAdapter implements ToolAdapter {
  readonly kind = "mcp-http" as const;
  private seq = 0;
  constructor(private readonly url: string, private readonly timeoutMs = 10_000) {}
  async call(name: string, args: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.seq, method: "tools/call", params: { name, arguments: args } }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MCP HTTP failed with status ${response.status}`);
      return await readMcpHttpResult(response);
    } finally { clearTimeout(timer); }
  }
  async close(): Promise<void> { /* HTTP is stateless per call */ }
}

export async function createToolAdapter(config: ToolAdapterConfig): Promise<ToolAdapter> {
  if (config.adapter === "mcp-stdio") {
    if (!config.command) throw new Error("MCP stdio tool adapter requires command");
    return new McpStdioToolAdapter(config.command, config.args ?? []);
  }
  if (config.adapter === "mcp-http") {
    if (!config.url) throw new Error("MCP HTTP tool adapter requires url");
    return new McpHttpToolAdapter(config.url);
  }
  return new MockToolAdapter(config.tools ?? {});
}
