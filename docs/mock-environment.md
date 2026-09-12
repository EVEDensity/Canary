# Mock Environment

Default tools are in-process mocks (`tools.adapter: "mock"`) plus an in-memory state store per execution.

- Each case gets a fresh state. `environment.state` on a TestCase is the seed.
- `state.equals` / `state.has` / `state.contains` assert the last snapshot (`state.changed` / `state.snapshot` events).
- Mock tools must throw on unknown names. MCP stdio/http adapters replace mocks when configured.
- The runner is **not** a security sandbox. Untrusted Agents need an external sandbox.

Deterministic `model.provider: "deterministic"` is the default Demo model. No API key is required.
