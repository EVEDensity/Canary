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
        return