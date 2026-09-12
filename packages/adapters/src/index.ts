import { spawn } from "node:child_process";
import type { AgentAdapterKind } from "@canary/core";

export interface AgentInput { value: unknown }
export interface AgentOutput { value: unknown }
export interface AgentContext { executionId: string; emit: (event: unknown) => void }
export interface AgentAdapter { id: string; kind: AgentAdapterKind; run(input: AgentInput, context: AgentContext): Promise<AgentOutput> }
export interface ToolAdapter { readonly kind: "mock" | "mcp-stdio"; call(name: string, args: unknown): Promise<unknown>; close(): Promise<void> }

export function createFunctionAdapter(agent: (input: unknown, context: AgentContext) => Promise<unknown> | unknown): AgentAdapter {
  return {
    id: "function",
    kind: "function",
    async run(input, context) { return { value: await agent(input.value, context) }; },
  };
}

export async function runHttpAgent(url: string, input: unknown, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }), signal: controller.signal });
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
