import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ControlPlane, type Action, type Command } from "@canary/control-plane";
import { resolveProjectContext } from "./home.js";
export async function controlCommand(rest: string[], configPath?: string): Promise<number> {
  const context = resolveProjectContext({ configPath });
  const plane = new ControlPlane(context.projectRoot, context.artifactRoot);
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  try {
    switch (rest[0] ?? "status") {
      case "status":
        print(plane.snapshot());
        return 0;
      case "audit":
        print(plane.audit());
        return 0;
      case "revision": {
        if (!rest[1] || !rest[2]) throw new Error("Usage: canary control revision <action> <target>");
        print({ action: rest[1], target: rest[2], revision: plane.revision(rest[1] as Action, rest[2]) });
        return 0;
      }
      case "act": {
        const file = flag("--file");
        if (!file)
          throw new Error(
            "Usage: canary control act --file <command.json>; command requires action, target, expectedRevision, requestId, actor, reason",
          );
        const command = JSON.parse(
          readFileSync(resolve(context.invocationRoot, file), "utf8").replace(/^\uFEFF/, ""),
        ) as Command;
        print(plane.execute(command, { role: "operator" }));
        return 0;
      }
      case "serve": {
        const portText = flag("--port"),
          port = portText === undefined ? 0 : Number(portText);
        if (!Number.isInteger(port) || port < 0 || port > 65535)
          throw new Error("Port must be an integer from 0 to 65535");
        const { createControlServer } = await import("@canary/web");
        const control = createControlServer(plane, { port, writeToken: process.env.CANARY_CONTROL_TOKEN });
        const address = await control.listen();
        print({
          kind: "canary.control",
          ...address,
          mode: process.env.CANARY_CONTROL_TOKEN ? "operator_available" : "read_only",
          projectRoo