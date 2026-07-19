# Proposal: phase-1-core

## Why

`pi-mcp-bridge` needs a working Phase 1 to validate the two-tool +
filesystem-registry architecture end-to-end. Without it, the OpenSpec
specs are unverified claims.

## What

Implement Phase 1 of the extension:

- **Core** — port the reusable parts of `pi-mcp-adapter` (server manager,
  lifecycle, metadata cache, npx resolver, output guard, tool metadata,
  resource tools, logger, errors, abort helpers, agent dir).
- **Registry** — new filesystem registry (`registry/`), loader, writer,
  `index.json` generator, `sync` and `validate` CLI commands.
- **Wrapper tools** — `CallMcpTool` and `FetchMcpResource` registered with
  Pi, with lazy connect, abort propagation, and output guard.
- **Context injector** — `session_start` hook that injects the compact
  registry index into the system context.
- **UI integration** — port the MCP UI / Glimpse integration so tools with
  `ui.resourceUri` open in a native window or browser.

## Impact

### ADDED

- `openspec/specs/mcp-bridge/spec.md` — extension lifecycle, two-tool
  surface, lazy connections, output guard, abort propagation.
- `openspec/specs/wrapper-tools/spec.md` — `CallMcpTool` and
  `FetchMcpResource` contracts.
- `openspec/specs/config-registry/spec.md` — filesystem registry layout
  and schemas.
- `openspec/specs/context-injection/spec.md` — session-start injection.
- All TypeScript source files listed in `tasks.md`.
- Bilingual README + architecture docs.
- Vitest test suite + GitHub Actions CI.

### MODIFIED

- `package.json` — add `@modelcontextprotocol/sdk`, `typebox`, `open`,
  `pi-ai`, `pi-tui`, `pi-coding-agent` deps; add `pi.extensions` manifest.

### REMOVED

- (none — this is a greenfield repo)

## Out of scope (deferred to future changes)

- `phase-2-oauth` — OAuth flows, dynamic client registration, callback
  server.
- `phase-3-sampling` — sampling handler, model preferences.
- `phase-4-elicitation` — form and URL elicitation handlers.
- Host-config importers (Cursor/Claude/Codex/Windsurf/VSCode).
- `directTools` promotion — replaced by the registry.

## Open questions

- None blocking. The two-tool surface and registry format are settled by
  the specs.
