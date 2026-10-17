#!/usr/bin/env node
import { upgradeInstallation } from "./lib/upgrade.mjs";
const args = process.argv.slice(2);
try {
  await upgradeInstallation({ args });
} catch (error) {
  const message = error instanceof Error ? error.message : "Upgrade could not be completed";
  if (args.includes("--check") && args.includes("--json"))
    console.log(
      JSON.stringify({ kind: "canary.upgrade-check", v: 1, status: "unavailable", mutation: false, error: message }),
    );
  else console.error(message);
  process.exitCode = 1;
}
