# Platform verification

```bash
pnpm verify:r6
```

The platform fixture checks installation, command execution, cancellation, ports, paths, concurrent runs and artifact persistence. Results and logs are stored under `.canary/`.

The workflow in `.github/workflows/r6.yml` defines Windows, Ubuntu and macOS jobs with Node.js 22 and 24. A defined workflow is separate from an executed result; each environment keeps its own verification state.

Container results describe the tested container environment. Optional remote-runtime checks require their own dependencies and explicit execution settings.

See [fixtures](../../integrations/fixtures/README.md) and [support scope](support-matrix.md).
