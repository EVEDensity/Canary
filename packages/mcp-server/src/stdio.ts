import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { CanaryMcpServer } from "./server.js";

/** Newline-delimited JSON-RPC stdio transport. Not Streamable HTTP. */
export async function serveStdio(
  server: CanaryMcpServer,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<void> {
  if (typeof stdin.setEncoding === "function") stdin.setEncoding("utf8");
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  let writeQueue = Promise.resolve();
  const tasks: Promise<void>[] = [];
  for await (const line of rl) {
    tasks.push((async () => {
      const response = await server.handleRequestAsync(line);
      if (!response) return;
      const payload = `${JSON.stringify(response)}\n`;
      writeQueue = writeQueue.then(
        () =>
          new Promise<void>((resolve, reject) => {
            stdout.write(payload, (error) => (error ? reject(error) : resolve()));
          }),
      );
      await writeQueue;
    })());
  }
  await Promise.all(tasks);
}
