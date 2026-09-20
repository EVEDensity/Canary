export default [{"id": "tool-calling-agent", "input": "ping", "assertions": [{"type": "output.exists"}, {"type": "tool.called", "name": "echo"}]}];
