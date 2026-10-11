import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { invocationRoot, resolveProjectContext, RUNTIME_INSTALL_ROOT } from "./home.js";

/** Project-local official Skill delivery uses the source installation's Node runtime. */
export async function skillCommand(args: string[]): Promise<number> {
  const installer = resolve(RUNTIME_INSTALL_ROOT, "scripts/install-skill.mjs");
  if (!existsSync(installer)) {
    console.error("Canary Skill installer is missing; restore or update this Canary source installation.");
    return 4;
  }
  const help = !args.length || (args.length === 1 && ["help", "--help", "-h"].includes(args[0]!));
  const effective = help || args.includes("--project") ? args : [...args, "--project", resolveProjectContext({ cwd: invocationRoot() }).projectRoot];
  const result = spawnSync(process.execPath, [installer, ...effective], {
    cwd: invocationRoot(),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) console.error("Cannot start the Canary Skill installer; check the Node runtime.");
  return result.status ?? 4;
}

/** Produce spec-valid metadata for advisory experience drafts, including an empty/non-ASCII key. */
export function buildSkillDraftMetadata(input: { key: string; contentHash: string; checkId: string }): {
  name: string;
  description: string;
  frontmatter: string;
} {
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) throw new Error("Skill draft requires a SHA-256 content hash");
  const slug =
    input.key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "check-guidance";
  const name = `canary-${slug}-${input.contentHash.slice(0, 8)}`;
  const check =
    input.checkId
      .replace(/[\r\n\u0000-\u001f]+/g, " ")
      .trim()
      .slice(0, 160) || "the recorded check";
  const description = `Review this project's validated Canary guidance for ${check} when the current task matches its recorded check and case scope.`;
  return {
    name,
    description,
    frontmatter: ["---", `name: ${name}`, `description: ${JSON.stringify(description)}`, "---"].join("\n"),
  };
}
