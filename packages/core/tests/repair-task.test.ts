import { describe, expect, it } from "vitest";
import { isRepairTaskPath } from "../src/repair-task.js";

describe("repair scope portability", () => {
  it.each([
    "src",
    "src/invoice.ts",
    "packages/core/src",
    "tests/invoice.test.ts",
    "中文/文件.ts",
    ".github/workflows/ci.yml",
  ])("accepts a canonical ordinary project path: %s", (value) => expect(isRepairTaskPath(value)).toBe(true));
  it.each([
    "",
    ".",
    "..",
    "src/../secret",
    "src/./file",
    "/src/file",
    "C:/src/file",
    "file:///src/file",
    "src\\file",
    "src//file",
    "src/",
    "src/*",
    "src/[a]",
    "src/{a,b}",
    "file\nname",
    ".git/config",
    ".canary/artifacts",
    "node_modules/package",
    "src/.env",
    ".ENV.production",
    "config/production.env",
    "certs/key.PEM",
    "certs/secret.KEY",
    ".ssh/config",
    "id_ed25519",
    "src/NUL.ts",
    "src/COM1",
    "src/file.",
    "src/file ",
    " src/file",
    "x".repeat(257),
  ])("refuses unsafe, sensitive, ambiguous or nonportable scope: %s", (value) =>
    expect(isRepairTaskPath(value)).toBe(false),
  );
});
