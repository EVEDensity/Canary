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
    expect((await fetch(url + "/api/control/actions", { method: "POST" })).status).toBe(403);
  });
  it("validates credential separately, denies cross-origin, Host spoofing and query tokens", async () => {
    const url = await start(token);
    expect(
      (await fetch(url + "/api/control/session", { method: "POST", headers: { "x-canary-control-token": token } }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(url + "/api/control/session", { method: "POST", headers: { "x-canary-control-token": "invalid" } }))
        .status,
    ).toBe(403);
    expect((await fetch(url + "/api/control", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect(
      await new Promise<number>((done) => {
        const req = request(url + "/api/control", { headers: { host: "evil.example" } }, (res) => {
          res.resume();
          done(res.statusCode!);
        });
        req.end();
      }),
    ).toBe(403);
    expect((await fetch(url + "/?token=bad")).status).toBe(400);
  });
  it("requires JSON, bounds bodies and rejects unknown actions", async () => {
    const url = await start(token),
      hea