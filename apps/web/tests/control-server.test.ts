import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlPlane } from "@canary/control-plane";
import { createControlServer } from "../src/control-server.js";
const servers: ReturnType<typeof createControlServer>[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.server.closeAllConnections();
    await new Promise<void>((r) => s.server.close(() => r()));
  }
});
async function start(writeToken?: string) {
  const p = new ControlPlane(mkdtempSync(join(tmpdir(), "canary-http-")));
  const s = createControlServer(p, { writeToken });
  servers.push(s);
  return (await s.listen()).url;
}
const token = "synthetic-test-token-not-a-secret-000000";
describe("L02 HTTP security", () => {
  it("defaults read-only and refuses mutations", async () => {
    const url = await start();
    expect((await (await fetch(url + "/api/control")).json()).mode).toBe("read_only");
    expect((await fetch(url + "/api/control/actio