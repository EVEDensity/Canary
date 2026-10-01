// Declaration inventory only: platform detection is not execution evidence.
const scenarios = [
  "Windows",
  "Ubuntu LTS",
  "macOS",
  "Node 24 compatibility",
  "Node 24 primary",
  "paths with spaces",
  "non-default user directory",
  "independent install root",
  "independent project root",
  "clean install",
  "upgrade",
  "uninstall",
  "offline failure",
];
console.log(
  JSON.stringify(
    {
      version: 1,
      kind: "canary.distribution.declarations",
      executed: false,
      root: process.cwd(),
      results: Object.fromEntries(scenarios.map((name) => [name, "declared"])),
      evidence:
        "See docs/guides/r0-cli-contract.md for the CLI contract; this command reports metadata and runs no checks.",
      excluded: ["mandatory six-job CI matrix", "npm registry packaging", "signed artifacts"],
    },
    null,
    2,
  ),
);
