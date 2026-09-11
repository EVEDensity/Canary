import { feature } from "@canary/coverage";

export async function runAgent(input: unknown): Promise<{ output: string; feature: string }> {
  const value = String(input ?? "");
  return feature("planning", () => ({ output: `planned:${value}`, feature: "planning" }));
}
