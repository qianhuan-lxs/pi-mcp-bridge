# Delta: mcp-bridge

> Phase 1 deltas against `openspec/specs/mcp-bridge/spec.md`. All
> requirements are ADDED (this is a greenfield repo).

## ADDED Requirements

- **ADDED REQ-001: Extension lifecycle** — register as a Pi extension,
  subscribe to `session_start` and `session_shutdown`, no long-lived
  resources from the factory body.
- **ADDED REQ-002: Two-tool surface** — register exactly `CallMcpTool`
  and `FetchMcpResource`, no other LLM-callable tools.
- **ADDED REQ-003: Filesystem registry** — read all metadata from
  `<agent dir>/mcp-registry/` (or `$PI_MCP_BRIDGE_REGISTRY`); no live
  server needed to read the registry.
- **ADDED REQ-004: Context injection** — on `session_start`, inject a
  compact index of servers/tools into the system context.
- **ADDED REQ-005: Lazy connections** — connect on first call, idle
  disconnect after configurable timeout (default 10 min), transparent
  reconnect.
- **ADDED REQ-006: Output guard** — cap inline text at 50 KiB / 2000
  lines, spill to temp file, disable-able via `settings.outputGuard` or
  `MCP_OUTPUT_GUARD=0`.
- **ADDED REQ-007: Abort propagation** — honor `AbortSignal`, cancel
  in-flight requests, return `details.error = "aborted"`, keep
  connection usable.
- **ADDED REQ-008: No silent failures** — structured results with
  human-readable content + machine-readable `details.error` codes.

## ADDED Scenarios

- **ADDED SCN-001: Cold start with no registry** — empty index, both
  tools registered, no server processes started.
- **ADDED SCN-002: First call triggers lazy connect** — connect on
  first `CallMcpTool`, keep open for idle window.
- **ADDED SCN-003: Idle disconnect** — disconnect after 10 min idle,
  transparent reconnect on next call.
- **ADDED SCN-004: Output guard spills to disk** — 200 KiB result
  truncated, full text in temp file, path in content + details.
