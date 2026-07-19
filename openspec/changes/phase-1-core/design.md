# Design: phase-1-core

> Technical approach for Phase 1. Read alongside
> `openspec/specs/*/spec.md` and `tasks.md`.

## Module map

```
pi-mcp-bridge/
├── index.ts                     ← Pi extension entry; registers tools, hooks session_start
├── cli.ts                       ← `pi-mcp-bridge sync|validate|add` CLI
├── state.ts                     ← McpBridgeState (in-memory session state)
├── types.ts                     ← Shared types (McpTool, McpResource, ServerEntry, ...)
├── agent-dir.ts                 ← Pi agent dir resolution
├── utils.ts                     ← env interpolation, path resolution, truncation
├── logger.ts                    ← debug logger
├── errors.ts                    ← typed error helpers
├── abort.ts                     ← abortable / throwIfAborted helpers
├── error-signal.ts              ← tool_result error re-flagging
├── config.ts                    ← bridge settings (outputGuard, contextBudget, ...)
├── server-manager.ts            ← MCP client manager (lazy connect, idle timeout)
├── lifecycle.ts                 ← lifecycle manager (idle sweep, keep-alive health)
├── metadata-cache.ts            ← (legacy) on-disk metadata cache (kept for compat)
├── tool-metadata.ts             ← ToolMetadata helpers (find, format schema)
├── resource-tools.ts            ← resource URI → tool name conversion
├── npx-resolver.ts              ← resolve `npx -y foo` to a direct binary
├── tool-result-renderer.ts      ← Pi render hooks for tool calls/results
├── mcp-output-guard.ts          ← 50 KiB / 2000 line guard + spill to disk
├── tool-registrar.ts            ← MCP content → Pi content block transforms
├── consent-manager.ts           ← tool consent gate (per-server, once, always)
├── call-mcp-tool.ts             ← CallMcpTool implementation
├── fetch-mcp-resource.ts        ← FetchMcpResource implementation
├── context-injector.ts          ← session_start context injection
├── ui-server.ts                 ← local HTTP server for MCP UI iframes
├── ui-session.ts                ← per-tool UI session lifecycle
├── ui-resource-handler.ts      ← fetch + open MCP UI resources
├── ui-stream-types.ts          ← UI stream envelope schemas
├── host-html-template.ts       ← HTML host page template for UI iframes
├── glimpse-ui.ts               ← Glimpse native window integration (macOS)
├── app-bridge.bundle.js         ← (vendored) MCP SDK + Zod for the iframe
├── registry/
│   ├── registry-types.ts        ← meta.json / tool.json / index.json TS types
│   ├── registry-loader.ts       ← load registry from disk → Registry object
│   ├── registry-writer.ts       ← sync live server → registry files; rebuild index
│   └── schemas/                 ← JSON Schemas for meta.v1, tool.v1, index.v1
├── __tests__/
│   ├── registry-loader.test.ts
│   ├── registry-writer.test.ts
│   ├── context-injector.test.ts
│   ├── call-mcp-tool.test.ts
│   ├── fetch-mcp-resource.test.ts
│   └── output-guard.test.ts
└── examples/
    └── filesystem/              ← example registry entry for the filesystem MCP
```

## Key design decisions

### D1: Two tools, no proxy

`CallMcpTool` and `FetchMcpResource` are registered directly with
`pi.registerTool`. There is no `mcp({...})` proxy. This means:

- The model's tool list is exactly `[CallMcpTool, FetchMcpResource]` plus
  Pi's native tools. No discriminated unions, no DSL.
- Discovery happens via the filesystem: the model uses `ls registry/`,
  `read registry/<server>/tools/<tool>.json`, etc. The injected context
  index tells the model which files exist.
- The bridge never has to implement search/describe sub-commands. The
  filesystem already does that better.

### D2: Registry is the source of truth

`registry/<server>/meta.json` + `tools/*.json` are the *only* way the
bridge knows a server exists. The legacy `mcp.json` config from
`pi-mcp-adapter` is NOT supported in Phase 1. Users add servers either by:

1. Hand-editing `registry/<server>/meta.json` and writing `tools/*.json`
   from the MCP server's docs, or
2. Running `pi-mcp-bridge add <server-name> --command "npx -y foo"` to
   scaffold `meta.json`, then `pi-mcp-bridge sync <server-name>` to
   populate `tools/` from a live server.

This is a deliberate simplification. The legacy `mcp.json` importer will
return as a separate OpenSpec change if needed.

### D3: Lazy connect, idle disconnect

`server-manager.ts` is ported from `pi-mcp-adapter` with minimal changes:

- `connect(name, definition, signal)` — dedupes concurrent connects,
  reuses healthy connections, resolves `npx` to a direct binary.
- `readResource(name, uri, signal)` — touches the connection, forwards.
- `close(name)` / `closeAll()` — idempotent cleanup.
- `lifecycle.ts` — periodic sweep disconnects idle servers after
  `idleTimeoutMinutes`. `keep-alive` servers get health checks + reconnect.

The bridge does NOT connect at `session_start`. Connections happen on
first `CallMcpTool` / `FetchMcpResource` targeting a server.

### D4: Output guard

`mcp-output-guard.ts` is ported almost verbatim from `pi-mcp-adapter`:

- Inline text capped at 50 KiB / 2000 lines.
- Oversized output spilled to a temp file (mode 0600) whose path is in
  the result content.
- `details.mcpResult` kept raw when ≤ 16 KiB; larger results summarized.
- Image blocks pass through unchanged.
- Kill switch: `MCP_OUTPUT_GUARD=0` or `settings.outputGuard = false`.

### D5: Context injection budget

`context-injector.ts` builds the Markdown block from `index.json` and
applies a token budget. Token estimation is a fast heuristic
(`Math.ceil(charCount / 4)`) — no tokenizer dependency. The truncation
ladder is:

1. Full per-tool descriptions (default).
2. Truncate descriptions to 40 chars.
3. Drop descriptions, list tool keys only.
4. Drop per-server tool lists, list server names + counts only.

Each step is tried in order until the block fits the budget.

### D6: UI integration

The MCP UI / Glimpse integration is ported because some high-value MCP
servers (e.g., chart tools, dashboards) ship UI resources. Without it,
`CallMcpTool` on those tools would be useless.

Ported modules: `ui-server.ts`, `ui-session.ts`, `ui-resource-handler.ts`,
`ui-stream-types.ts`, `host-html-template.ts`, `glimpse-ui.ts`,
`consent-manager.ts`, `app-bridge.bundle.js`.

The `ui.resourceUri` field on `tools/<tool>.json` triggers the UI session
when set. `CallMcpTool` checks this field before forwarding the call.

### D7: Abort propagation

Both wrapper tools accept Pi's `signal: AbortSignal`. The bridge passes
it to `server-manager` via `RequestOptions.signal`. On abort:

- The MCP SDK cancels the in-flight request.
- The wrapper returns `details.error = "aborted"`.
- The connection stays open for reuse.

### D8: TypeScript strict

`tsconfig.json` sets `strict: true`. No `any` leaks. The only `any`-typed
boundary is the MCP `arguments` object, which is intentionally opaque
(the server validates it).

## Verification plan

Each spec requirement maps to at least one test:

| Requirement         | Test file                          |
|---------------------|------------------------------------|
| REQ-R-001 (root)     | `registry-loader.test.ts`          |
| REQ-R-002 (naming)   | `registry-loader.test.ts`          |
| REQ-R-003 (tools)    | `registry-loader.test.ts`          |
| REQ-R-004 (atomic)   | `registry-writer.test.ts`           |
| REQ-R-005 (sync)     | `registry-writer.test.ts`           |
| REQ-R-006 (validate) | `registry-writer.test.ts`           |
| REQ-W-002..007       | `call-mcp-tool.test.ts`            |
| REQ-W-009..014       | `fetch-mcp-resource.test.ts`       |
| REQ-C-001..006       | `context-injector.test.ts`          |
| REQ-006 (guard)      | `output-guard.test.ts`             |

## Risks

- **R1: MCP SDK API drift.** The adapter pins `@modelcontextprotocol/sdk@^1.25.1`. If the SDK
  changes `Client.callTool` / `readResource` signatures, the bridge breaks.
  Mitigation: pin the SDK in `package.json` and test against the pinned version.
- **R2: Pi extension API drift.** `ExtensionAPI` is sourced from
  `@earendil-works/pi-coding-agent@^0.79.1`. Mitigation: same pinning strategy.
- **R3: UI bundle size.** `app-bridge.bundle.js` is ~408 KB. We vendor it
  as-is. Mitigation: keep it vendored, document its origin.
- **R4: Token budget heuristic.** `charCount / 4` is a rough estimate.
  Mitigation: make the budget conservative (default 4000) and let users
  tune it via `settings.contextBudgetTokens`.
