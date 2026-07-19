# Changelog

All notable changes to `pi-mcp-bridge` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-07-19

### Changed — registry management is now Pi-idiomatic

- **`/mcp-bridge` is now the primary path for registry management.** `sync`, `validate`, `add`, `list`, `status`, and `reload` are all subcommands of the existing `/mcp-bridge` slash command inside Pi — no separate binary on PATH, no `command not found` after `pi install`. This matches how `pi-mcp-adapter` (the project we ported from) does it: the slash command is the user-facing surface; the CLI is auxiliary.
- **Removed the `bin` field from `package.json` and deleted `bin/pi-mcp-bridge.mjs`.** The published package no longer ships a CLI binary; `pi install npm:@qianhuan-lxs/pi-mcp-bridge` followed by `/mcp-bridge ...` inside Pi is the supported flow.
- **`cli.ts` is now an optional, no-bin wrapper** around the shared `registry-commands.ts` module, kept for scripting / CI. Run it via `npx tsx ./node_modules/@qianhuan-lxs/pi-mcp-bridge/cli.ts <cmd>`. It and the slash command share the exact same logic, so the two paths never diverge.
- **`tsx` moved back to `devDependencies`** — the runtime no longer needs it (no bin shim).
- README (EN + zh-CN) updated to document `/mcp-bridge sync|validate|add|list|status|reload` as the primary flow.

### Added

- **`registry-commands.ts`** — shared `doSync` / `doValidate` / `doAdd` / `doList` logic used by both the slash command and the optional CLI.
- **`slash-parser.ts`** — parses `/mcp-bridge sync|add` argument strings (handles `--env K=V`, `--env K`, `--force`, `--url`, `--description`, and the `-- <command> [args...]` separator).
- **`__tests__/slash-parser.test.ts`** — 9 new tests covering the parser; total suite now 52 tests across 6 files.

### Migration from 0.1.x

If you previously called `pi-mcp-bridge sync ...` from a shell, switch to `/mcp-bridge sync ...` inside Pi. The argument format is identical (`<server> [--env K=V]... [--force] -- <command> [args...]`).

## [0.1.1] — 2026-07-19

### Fixed

- **Bin entry now survives `npm publish`.** The CLI shim `bin/pi-mcp-bridge.mjs` lacked the executable bit, causing npm to strip the `bin` field at publish time with the warning `bin[pi-mcp-bridge] script name ... was invalid and removed`. `chmod +x` the shim so `pi-mcp-bridge` registers on the consumer's PATH after `pi install`.

### Changed

- **Package name is now scoped:** `@qianhuan-lxs/pi-mcp-bridge`. The unscoped `pi-mcp-bridge` name was already taken on npm by another author; the scoped name under the maintainer's GitHub username avoids the collision while staying installable via `pi install npm:@qianhuan-lxs/pi-mcp-bridge`.
- **Pi core packages moved to `peerDependencies` with `"*` range** (`@earendil-works/pi-ai`, `-pi-coding-agent`, `-pi-tui`, `typebox`). They are provided by the pi runtime; bundling them would cause version conflicts. Real versions retained in `devDependencies` for local typechecking.
- **`tsx` moved to `dependencies`** — the CLI bin shim needs it at runtime to load `cli.ts`.
- **`engines: node >=20.19`** declared.
- **`publishConfig: { access: public }`** set for scoped-name safety.
- README install commands updated to `pi install npm:@qianhuan-lxs/pi-mcp-bridge`.

## [0.1.0] — 2026-07-19

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
