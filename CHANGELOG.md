# Changelog

All notable changes to `pi-mcp-bridge` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] — 2026-07-19

### Changed — hard tool-count limit for inline schema injection

- **Registries with more than 30 tools now skip the `renderWithSchemas` level entirely** and fall back to descriptions-only injection. Previously the only gate was the token budget, which made behavior unpredictable: a registry could fit full schemas one turn and not the next (when tools were added), and the injector would build a large schema block only to discard it. The new rule is a hard, predictable cutoff at 30 tools.
- New `BridgeSettings.schemaInjectionToolLimit` (default `30`) controls the threshold. Set it to `0` to disable inline schema injection entirely; set it to a large number to fall back to the pure token-budget behavior.
- Boundary behavior: exactly 30 tools → schemas included; 31 tools → descriptions only.

### Tests

- 4 new tests covering the 30-tool boundary, a custom limit, and `limit=0` (disabled). Total suite: **59 tests across 6 files, all green**. Typecheck: 0 errors.

## [0.2.3] — 2026-07-19

### Fixed — context block path + full-schema injection (review follow-up)

Review of a real `/mcp-bridge sync context7` session exposed two issues in the context-injection design:

- **The schema-file path in the context block was relative (`registry/<server>/tools/<tool>.json`), so the model's `read` resolved it against the agent cwd and got ENOENT.** The actual files live at `getRegistryRoot()` = `~/.pi/agent/mcp-registry/`. The model could never read a schema file and only recovered because the MCP server happened to embed the schema in its validation error. Fix: the footer now uses the absolute `registry.root` (e.g. `~/.pi/agent/mcp-registry/<server>/tools/<tool>.json`), so `read`/`grep`/`ls` actually find the file.

- **The "read the schema file before calling" pattern doubled round-trips and the model often skipped it** (calling with empty params, failing, then reading the schema from the error). Fix: added a new top truncation level `renderWithSchemas` that includes each tool's full `inputSchema` as compact JSON inline. When the registry fits the token budget (default 4000), the model gets every schema directly in the context block and can call `CallMcpTool` correctly on the first try — no extra `read`, no failed-then-retry. When the registry is too large, the injector falls back to the existing description-only levels (which now point at the correct absolute path). `InjectionResult` gains a `schemasIncluded` boolean so callers can tell which mode was used.

### Result

For a small registry (e.g. just `context7` with 2 tools), the call chain becomes:
```
1. model reads schema from the context block (no tool call needed)
2. CallMcpTool(resolve-library-id, {query, libraryName})  → succeeds first try
3. CallMcpTool(query-docs, {libraryId, query})            → succeeds first try
```
2 calls, 0 failures (was 4 calls, 2 failures in v0.2.2).

### Tests

- 3 new tests covering the `renderWithSchemas` level, the fallback-to-descriptions path, and the absolute-path footer. Total suite: **55 tests across 6 files, all green**. Typecheck: 0 errors.

## [0.2.2] — 2026-07-19

### Fixed — context injection actually works now (critical)

- **MCP registry was never injected into the agent context.** `index.ts` called `ctx.injectSystemContext(...)`, but `ExtensionContext` / `ExtensionCommandContext` have no such method — the call was guarded by `if (ctx.injectSystemContext)` which was always falsy, so the compact registry index was never sent to the model. Symptom: the model didn't know `CallMcpTool` / `FetchMcpResource` existed or which MCP tools were available, so it fell back to shell commands (`find /`, etc.) instead of calling MCP tools. Fix: hook the documented `pi.on("context", ...)` event (the SDK's supported "injecting context from external sources" hook), which fires before every provider request with the `AgentMessage[]` and lets the handler return a replacement array. We prepend a user message containing the registry block. Injection is idempotent (skips if a message containing our `## MCP servers (via pi-mcp-bridge)` header is already present), so it's safe whether or not the result is persisted across turns.
- **`/mcp-bridge reload` no longer calls the non-existent `ctx.injectSystemContext`.** It now just updates `state.registry` and clears the cached block; the next `context` event rebuilds the block from the new registry automatically.
- **`/mcp-bridge sync` now auto-reloads the registry after a successful sync.** Previously the user had to run `/mcp-bridge reload` separately, and even then the (broken) injection didn't reach the model. Now sync updates `state.registry` in place, so the next turn sees the new tools immediately.

### Fixed — pre-existing runtime crashes surfaced by the review

- **`FetchMcpResource` imported a non-existent type `ReadResourceResultContents`.** The MCP SDK exports `ResourceContents` (and `ReadResourceResult.contents` is `ResourceContents[]`); the wrong import name would have crashed `FetchMcpResource` the first time it was invoked. Replaced both usages with `ResourceContents`.
- **`host-html-template.ts` called `applyCspMeta(...)` but the function is named `applyCspMetaContent`.** Undefined reference — would have crashed the MCP UI host page builder the first time a tool with a `ui.resourceUri` was invoked. Renamed the call site.
- **`lifecycle.ts` / `server-manager.ts` imported `ServerDefinition` from `types.ts`, which only exports `ServerEntry`.** Type-only import (no runtime crash), but the type annotations were wrong. Aliased `ServerEntry as ServerDefinition` to preserve call sites.
- **`server-manager.callTool` passed `_meta: undefined` explicitly**, which the MCP SDK's stricter type rejects. Omitted the field instead.
- **`index.ts` tool `execute` params had implicit `any` types** (`_toolCallId`, `signal`) because the `registerTool` cast bypassed inference. Added explicit `string` / `AbortSignal` annotations.

### Changed

- **Empty-registry context message** now points at `/mcp-bridge add <server> -- <command>` (the v0.2.0 slash-command flow) instead of the removed `pi-mcp-bridge add` CLI.
- **Typecheck is now clean: 0 errors** (was 13 in v0.2.1, all pre-existing from the 0.1.x port). Tests: 52 passing across 6 files.

## [0.2.1] — 2026-07-19

### Fixed

- **First-time `/mcp-bridge sync <server>` no longer skips with `syncedFrom is "manual"`.** The manual-edit guard in `syncServer` was too coarse: it skipped *any* server whose `meta.json.syncedFrom === "manual"`, including the freshly-created stubs that `doSync`/`doAdd` write (which have `syncedFrom: "manual"` + an empty `tools/` directory). The very first sync therefore never ran, leaving the registry empty and the agent with no MCP tools to call. The guard now only skips when `syncedFrom === "manual"` **and** `tools/` already contains hand-written `.json` descriptors — i.e., only when there's actually something to protect. `--force` still overrides everything.

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
