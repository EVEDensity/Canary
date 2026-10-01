# Platform verification

```bash
pnpm verify:r6
```

The platform fixture checks installation, command execution, cancellation, ports, paths, concurrent runs and artifact persistence. Results and logs are stored under `.canary/`.

The **Platform checks** workflow in `.github/workflows/r6.yml` verifies Windows, Ubuntu and macOS with Node.js 24. **All platforms / Node 24** is the combined status; it passes only when all three platform jobs succeed. Individual jobs retain their logs and evidence. Use the combined status as the platform check in branch protection settings. A defined workflow is separate from an executed result; each environment keeps its own verification state.

Container results describe the tested container environment. Optional remote-runtime checks require their own dependencies and explicit execution settings.

See [fixtures](../../integrations/fixtures/README.md) and [support scope](support-matrix.md).
