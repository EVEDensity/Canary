<div align="center">
  <img src="docs/images/logo-hero.png" height="150" alt="Canary" />
  <h3>Explore your architecture. Diagnose failures. Verify every fix.</h3>
  <p>Project checks · Interactive architecture maps · Coverage analysis · Traceable evidence</p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><a href="#quick-start">Quick start</a> · <a href="docs/README.md">Docs</a> · <a href="docs/roadmap/README.md">Roadmap</a> · <a href="https://github.com/EVEDensity/Canary/issues/new/choose">Report an issue</a></p>
  <p><a href="LICENSE">Apache-2.0</a> · Node.js 24 recommended · pnpm 10.15.0</p>
</div>

**Canary is a project verification workspace for developers and coding Agents.** Bring checks, architecture, coverage and error evidence together. Follow a failure into the code, then track verification after a fix. Integrate with existing CI through the CLI, stable exit codes and standard reports.

## Features

- **Unified checks** — Run builds, type checks, lint, tests and Agent cases. Export JSON, JUnit and Markdown reports.
- **Architecture maps** — Explore modules, files and symbols in 2D and layered 3D views. Search nodes, filter dependencies and inspect source.
- **Failure diagnosis** — Inspect categorized issues, redacted logs and source locations. Link original failures to reruns and before/after comparisons.
- **Coverage navigation** — Map collected line, function and branch coverage to structure nodes and locate verification gaps.
- **Traceable evidence** — Connect code versions, check results and execution history through manifests, content hashes and run lineage.

See the [support matrix](docs/guides/support-matrix.md) and [verification record](docs/evidence/2026-09-30-product-verification.md).

## Quick start

Use **Node.js 24, Git and pnpm 10.15.0**:

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

Open [localhost:4318](http://127.0.0.1:4318/?lang=en) to view live checks, architecture maps and run history. Switch between English and Simplified Chinese in the language menu; your preference is remembered.

The repository includes six project checks. Run `pnpm demo` for the Agent evaluation example.

## Use with your project

Run `node scripts/install-global.mjs` from a clean Canary source checkout, then open a new terminal to use `canary`.

Prepare your project's dependencies and add `canary.project.json` at its root. This example runs existing `build` and `test` scripts:

```json
{
  "kind": "canary.project",
  "version": 1,
  "checks": [
    {
      "id": "project.build",
      "type": "command",
      "command": "node",
      "args": ["--run", "build"],
      "timeoutMs": 120000
    },
    {
      "id": "project.test",
      "type": "command",
      "command": "node",
      "args": ["--run", "test"],
      "timeoutMs": 120000
    }
  ]
}
```

Run from your project's directory:

```bash
canary doctor --json             # Check configuration and prerequisites
canary run --ci                  # Execute checks in CI
canary run --port 4318 --no-open  # Run checks with an interactive report
```

Checks follow your project configuration. Coverage requires a configured collector. Artifacts are stored in your project's `.canary/` directory; add it to `.gitignore`.

## Documentation & contributing

- [Installation & setup](docs/guides/getting-started.md) · [Project checks](docs/guides/r4-project-checks.md)
- [Evaluation & coverage](docs/guides/evaluation-and-coverage.md) · [Architecture & CI](docs/guides/architecture-ci.md)
- [Agent adapters](docs/guides/adapters-and-environment.md) · [Repository layout](docs/guides/repository-layout.md)
- [Contributing](CONTRIBUTING.md) · [Translations](docs/guides/localization.md) · [Security policy](SECURITY.md)

Add a language with `pnpm i18n:add <locale>` and validate it with `pnpm i18n:check`. Complete, reviewed resources appear automatically in the language menu after merging.

Issues, documentation improvements and code contributions are welcome. Upcoming work focuses on PR diagnosis, repair verification and change verification gaps. See the [roadmap](docs/roadmap/README.md).

## License

[Apache-2.0](LICENSE). Bundled fonts and icons retain their respective license notices.
