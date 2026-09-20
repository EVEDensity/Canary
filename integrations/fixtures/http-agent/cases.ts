export default [{"id": "http-agent", "input": "ping", "assertions": [{"type": "output.exists"}, {"type": "trajectory.required_event", "event": "http.request"}]}];
