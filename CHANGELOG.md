# Changelog

All notable changes to `pi-mcp-bridge` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 1 (core)

- **Two-tool surface.** The LLM only sees `CallMcpTool` and `FetchMcpResource`. Every MCP tool is reached by `server` + `toolName` (+ `arguments`); every MCP resource is read by `server` + `uri` (with optional `downloadPath`).
- **Filesystem-first registry.** Server config lives in `registry/<server>/meta.json`; tool descriptors live in `registry/<server>/tools/<tool>.json`; the aggregate `index.json` is derived and rebuilt by `sync` / `validate`. JSON Schemas for all three formats live in `registry/schemas/`.
- **Context injection.** On `session_start`, a compact Markdown index of the registry is injected into the system prompt. Full tool schemas stay on disk until the model asks for them. A configurable `contextBudgetChars` budget truncates the block gracefully.
- **Lazy connections.** MCP servers connect on first tool call and disconnect after a configurable `idleTimeout`. `McpLifecycleManager` runs periodic keep-alive health checks.
- **Output guard.** Large tool outputs are truncated and the full content is spilled to a temp file, with a short summary + pointer returned to the model.
- **Abort propagation.** Both wrappers thread Pi's `AbortSignal` through to `McpServerManager.callTool`; cancelling a tool call cancels the in-flight MCP request and closes the connection.
- **`npx` resolution.** `npx` / `npm exec` commands are resolved to direct binary paths on first connect and cached, avoiding the per-call `npx` startup overhead.
- **Bearer token auth.** `meta.json#bearerToken` (and `headers.Authorization`) support `${env.VAR}` interpolation for HTTP/SSE servers.
- **StreamableHTTP + SSE fallback.** HTTP transport tries StreamableHTTP first and falls back to SSE.
- **CLI.** `pi-mcp-bridge sync | validate | add | list` for managing the registry from the shell.
- **UI integration.** Tools that declare `ui.resourceUri` render in a sandboxed iframe served by a local HTTP server. The iframe communicates back via `/proxy/*` endpoints, which forward tool calls through `McpServerManager` (gated by `ConsentManager`). Optional native macOS window viewer via Glimpse.
- **Slash commands.** `/mcp-bridge reload` re-reads the registry and re-injects the context block; `/mcp-bridge status` prints connection state.
- **OpenSpec.** Behavior contracts for `mcp-bridge`, `wrapper-tools`, `config-registry`, and `context-injection`, plus the Phase 1 proposal/design/tasks in `openspec/changes/phase-1-core/`.
- **Bilingual docs.** `README.md` (EN), `README.zh-CN.md` (中文), `docs/architecture.md` / `architecture.zh-CN.md`, `docs/config-format.md` / `config-format.zh-CN.md`.

### Non-goals for Phase 1

- OAuth 2.1 flow (Phase 2).
- Server-initiated `sampling/createMessage` (Phase 3).
- Server-initiated `elicitation/create` (Phase 4).
- A `directTools` mode that registers one Pi tool per MCP tool (out of scope by design).
