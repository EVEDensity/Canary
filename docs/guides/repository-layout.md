# Repository layout

```text
Canary/
├── apps/          # Report workspace and product website
├── packages/      # CLI and shared verification modules
├── examples/      # Runnable examples and cases
├── integrations/  # Adapter configurations and fixtures
├── scripts/       # Build, installation and validation tools
├── docs/          # Guides, architecture, roadmap and images
├── .github/       # Workflows and contribution templates
└── .changeset/    # Release configuration
```

Source belongs in the relevant application or package. Examples keep their cases with their configuration. Documentation belongs in `docs/guides/`; the architecture and roadmap have separate entry points.

Toolchain configuration and lockfiles remain at the repository root. Generated artifacts, logs and internal working records belong in ignored `.canary/` directories and are not distributed as documentation.
