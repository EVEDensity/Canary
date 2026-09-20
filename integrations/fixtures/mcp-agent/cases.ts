export default [{"id": "mcp-agent", "input": "ping", "assertions": [{"type": "output.exists"}, {"type": "trajectory.required_event", "event": "mcp.request"}]}];
