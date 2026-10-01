# Integration fixtures

This directory contains reproducible adapter configurations for TypeScript HTTP, Python HTTP and stdio tool services. It does not distribute upstream source.

- `typescript-http/`: use the included configuration with its compatible service and prepared dependencies.
- `python-http/`: prepare the service environment and review the configured interpreter path for your platform.
- `mcp-everything/`: configure the required stdio tool service before running the fixture.

Review each fixture's configuration and dependency declaration before execution. HTTP measurements do not include remote source coverage. Coverage of an adapter wrapper applies only to that wrapper.

Use [adapter guidance](../../docs/guides/adapters-and-environment.md) and [verification comparisons](../../docs/guides/external-validation.md) when preparing an integration.
