# Troubleshooting

| Symptom                                   | Check                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `No test case files matched`              | `cases` glob is relative to the config file directory                               |
| Coverage `unavailable`                    | HTTP/MCP Agent, or `include` missed the Agent files                                 |
| Coverage `preparing` stuck                | Source-map scan; watch CLI logs, not only the UI                                    |
| `hard-gate: fail` with passing assertions | Unexpected `policy.violation` or `loop_detected`, or a core feature `unavailable`   |
| `agent-loop-stop` fails the loop gate     | The case must `requiredEvent("loop_detected")`                                      |
| UI blank / disconnected                   | Banner should switch to snapshot poll; without JS use the noscript snapshot         |
| `canary improve` cannot find runId        | Artifacts are under the **cwd** `.canary/artifacts`, even when `--config` is nested |

Bun is a CLI smoke target only. Do not expect Node V8 coverage under Bun.
