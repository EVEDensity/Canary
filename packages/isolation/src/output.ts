import type { ExecutionOutputCapture } from "@canary/core";

export const DEFAULT_OUTPUT_MAX_BYTES = 64 * 1024;
type Stream = "stdout" | "stderr";
type Chunk = { stream: Stream; bytes: Buffer };

function take(chunks: Chunk[], maxBytes: number, fromEnd = false): Chunk[] {
  const retained: Chunk[] = [];
  let remaining = Math.max(0, maxBytes);
  const source = fromEnd ? [...chunks].reverse() : chunks;
  for (const chunk of source) {
    if (!remaining) break;
    const length = Math.min(remaining, chunk.bytes.length);
    const bytes = fromEnd ? chunk.bytes.subarray(chunk.bytes.length - length) : chunk.bytes.subarray(0, length);
    retained.push({ stream: chunk.stream, bytes: Buffer.from(bytes) });
    remaining -= length;
  }
  return fromEnd ? retained.reverse() : retained;
}

function byteBounded(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const characters: string[] = [];
  let size = 0;
  for (const character of text) {
    size += Buffer.byteLength(character);
    if (size > maxBytes) break;
    characters.push(character);
  }
  return characters.join("");
}

/** Both streams share one budget. Retention is bounded even for a line without a newline. */
export class BoundedExecutionOutput {
  private chunks: Chunk[] = [];
  private head: Chunk[] = [];
  private retained = 0;
  private observed = 0;
  private cut = false;
  private pending: Record<Stream, string> = { stdout: "", stderr: "" };
  private firstError?: { stream: Stream; text: string; context: number };
  constructor(readonly maxBytes = DEFAULT_OUTPUT_MAX_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw new RangeError("Output budget must be at least 256 bytes");
  }
  get truncated(): boolean { return this.cut; }
  append(stream: Stream, value: Buffer | string): void {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    if (!bytes.length) return;
    this.observed = Math.min(Number.MAX_SAFE_INTEGER, this.observed + bytes.length);
    this.scanError(stream, bytes);
    if (!this.cut && this.retained + bytes.length <= this.maxBytes) {
      this.chunks.push({ stream, bytes: Buffer.from(bytes) });
      this.retained += bytes.length;
      return;
    }
    if (!this.cut) {
      this.cut = true;
      this.head = take(this.chunks, Math.floor(this.maxBytes / 4));
    }
    // Copy only the bounded suffix: subarrays of a huge chunk would retain its backing allocation.
    const suffix = Buffer.from(bytes.subarray(Math.max(0, bytes.length - this.maxBytes)));
    this.chunks = take([...this.chunks, { stream, bytes: suffix }], Math.floor(this.maxBytes / 2) - 128, true);
    this.retained = this.chunks.reduce((size, chunk) => size + chunk.bytes.length, 0);
  }
  private scanError(stream: Stream, bytes: Buffer): void {
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const parts = (this.pending[stream] + bytes.subarray(offset, offset + 4096).toString("utf8")).split("\n");
      this.pending[stream] = parts.pop()!.slice(-4096);
      for (const line of parts) this.errorLine(stream, line + "\n");
      // Also recognize a single oversized error line, keeping only a bounded excerpt.
      if (!this.firstError && /\berror\b|\bfail(?:ed|ure)?\b|exception|错误|失败/i.test(this.pending[stream])) {
        this.firstError = { stream, text: byteBounded(this.pending[stream], Math.floor(this.maxBytes / 4)), context: 0 };
      }
    }
  }
  private errorLine(stream: Stream, line: string): void {
    if (!this.firstError && /\berror\b|\bfail(?:ed|ure)?\b|exception|错误|失败/i.test(line)) {
      this.firstError = { stream, text: byteBounded(line, Math.floor(this.maxBytes / 4)), context: 4 };
    } else if (this.firstError?.stream === stream && this.firstError.context > 0) {
      this.firstError.text = byteBounded(this.firstError.text + line, Math.floor(this.maxBytes / 4));
      this.firstError.context--;
    }
  }
  finish(): ExecutionOutputCapture {
    const render = (stream: Stream): string => {
      const decode = (chunks: Chunk[]) => Buffer.concat(chunks.filter((chunk) => chunk.stream === stream).map((chunk) => chunk.bytes)).toString("utf8");
      if (!this.cut) return decode(this.chunks);
      const head = decode(this.head);
      const tail = decode(this.chunks);
      const first = this.firstError?.stream === stream ? this.firstError.text : "";
      const error = first && !head.includes(first) && !tail.includes(first) ? `\n[first error]\n${first}` : "";
      return head + error + "\n[output truncated]\n" + tail;
    };
    const rawStdout = render("stdout");
    const rawStderr = render("stderr");
    const stdout = byteBounded(rawStdout, this.maxBytes);
    const stderr = byteBounded(rawStderr, this.maxBytes - Buffer.byteLength(stdout));
    const retainedBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
    const truncated = this.cut || Buffer.byteLength(rawStdout) + Buffer.byteLength(rawStderr) > this.maxBytes;
    return { maxBytes: this.maxBytes, observedBytes: this.observed, retainedBytes, truncated, stdout, stderr };
  }
}
