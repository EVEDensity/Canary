import { collectSecretValues, redactText } from "@canary/trace";

/** Bounded, line-aware capture. Redaction precedes retention and excerpt selection. */
export class DiagnosticOutput {
  private pending = "";
  private dropping = false;
  private privateBlock = false;
  private secretContinuation = false;
  private tail: string[] = [];
  private head: string[] = [];
  private headSize = 0;
  private errors: string[] = [];
  private size = 0;
  private context = 0;
  truncated = false;
  private secrets: string[];
  constructor(env: NodeJS.ProcessEnv, args: string[] = []) {
    this.secrets = collectSecretValues({ environment: { ...process.env, ...env }, args }).flatMap((value) => [value, ...value.split(/\r?\n/)]);
  }
  append(chunk: string): void {
    for (const part of chunk.split(/(?<=\n)/)) {
      if (!this.dropping) this.pending += part;
      if (this.pending.length > 16_384) {
        // Never keep a fragment of an oversized credential or private-key line.
        if (/-----BEGIN .*PRIVATE KEY/.test(this.pending)) this.privateBlock = true;
        this.pending = "";
        this.dropping = true;
        this.truncated = true;
      }
      if (part.endsWith("\n")) {
        if (this.dropping) this.keep("[oversized line omitted]");
        else this.line(this.pending);
        this.pending = "";
        this.dropping = false;
      }
    }
  }
  private line(raw: string): void {
    if (this.secretContinuation) {
      this.secretContinuation = false;
      this.keep("[redacted continuation]");
      return;
    }
    this.secretContinuation = /(?:\b(?:password|secret|token|api[_-]?key)\s*[:=]|\bBearer)\s*$/i.test(raw);
    if (/-----BEGIN .*PRIVATE KEY/.test(raw)) this.privateBlock = true;
    if (this.privateBlock) {
      if (/-----END .*PRIVATE KEY/.test(raw)) this.privateBlock = false;
      this.keep("[redacted private key]");
      return;
    }
    const clean = redactText(raw, { secretValues: this.secrets })
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
      .trimEnd();
    if (clean.length > 1600) {
      this.truncated = true;
      this.keep("[oversized line omitted]");
      return;
    }
    this.keep(clean);
  }
  private keep(line: string): void {
    if (this.head.length < 12 && this.headSize + line.length < 6000) {
      this.head.push(line);
      this.headSize += line.length + 1;
    }
    this.tail.push(line);
    this.size += line.length + 1;
    while (this.size > 24_000 || this.tail.length > 160) {
      this.size -= this.tail.shift()!.length + 1;
      this.truncated = true;
    }
    if (/\berror\b|\bfail(?:ed|ure)?\b|exception|timeout|错误|失败/i.test(line)) this.context = 4;
    if (this.context > 0) {
      this.errors.push(line);
      this.context--;
      while (this.errors.length > 24) this.errors.shift();
    }
  }
  finish(): { summary: string; lines: string[]; truncated: boolean } {
    if (this.pending) this.line(this.pending);
    if (this.dropping) this.keep("[oversized line omitted]");
    this.pending = "";
    const lines = this.truncated
      ? [...this.errors, "[initial output]", ...this.head, "[recent output]", ...this.tail]
      : this.tail;
    const excerpt: string[] = [];
    let size = 0;
    for (const line of new Set(
      this.size <= 1900 && !this.truncated ? this.tail : [...this.errors, ...this.head, ...this.tail.slice(-12)],
    )) {
      if (size + line.length + 1 > 1900) continue;
      excerpt.push(line);
      size += line.length + 1;
    }
    return { summary: excerpt.join("\n"), lines, truncated: this.truncated || lines.join("\n").length > 1900 };
  }
}
