# Delta: context-injection

> Phase 1 deltas against `openspec/specs/context-injection/spec.md`. All
> requirements are ADDED.

## ADDED Requirements

- **ADDED REQ-C-001: Trigger** — run on `session_start` after the
  registry loader; complete before the wrapper tools are first callable.
- **ADDED REQ-C-002: Output format** — single Markdown block with
  header `## MCP servers (via pi-mcp-bridge)`, summary line, one `###`
  section per server (tools + resources), footer about reading
  `registry/<server>/tools/<tool>.json`.
- **ADDED REQ-C-003: Size budget** — stay under
  `settings.contextBudgetTokens` (default 4000); truncation ladder:
  full descriptions → 40-char descriptions → tool keys only → server
  names + counts only; include `> (truncated — ...)` note when applied.
- **ADDED REQ-C-004: No live connections** — works purely from
  `index.json`; zero cold-start latency.
- **ADDED REQ-C-005: Re-injection on reload** — on `reload` event or
  `/mcp-bridge reload`, re-read `index.json`, replace the previously
  injected block (identified by header), notify via `ctx.ui.notify` if
  counts changed.
- **ADDED REQ-C-006: Empty registry** — inject a short "0 servers
  configured" block with add-server instructions.

## ADDED Scenarios

- **ADDED** Typical injection — 2 servers × 5 tools → full Markdown
  block with summary, per-server sections, footer.
- **ADDED** Over-budget truncation — 20 servers × 50 tools, budget 1000
  → server names + counts only, with truncation note.
- **ADDED** Reload updates the block — replace previous block, notify
  on count change.
