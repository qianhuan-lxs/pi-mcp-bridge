# Tasks: phase-1-core

> Implementation checklist. Each task maps to a module in `design.md` and
> to requirements in `openspec/specs/*/spec.md`.

## T1 — Project skeleton (DONE in M0)

- [x] `package.json` with deps + `pi.extensions` manifest.
- [x] `tsconfig.json` (strict, NodeNext, ES2022).
- [x] `vitest.config.ts`.
- [x] `.gitignore`, `LICENSE` (MIT).

## T2 — OpenSpec specs (DONE in M1)

- [x] `openspec/specs/mcp-bridge/spec.md`.
- [x] `openspec/specs/wrapper-tools/spec.md`.
- [x] `openspec/specs/config-registry/spec.md`.
- [x] `openspec/specs/context-injection/spec.md`.

## T3 — OpenSpec change proposal (DONE in M2)

- [x] `openspec/changes/phase-1-core/proposal.md`.
- [x] `openspec/changes/phase-1-core/design.md`.
- [ ] `openspec/changes/phase-1-core/specs/*.md` (delta specs — see T3.1).

## T3.1 — Delta specs

- [ ] `specs/mcp-bridge/spec.md` — ADDED REQ-001..008 (mark as ADDED).
- [ ] `specs/wrapper-tools/spec.md` — ADDED REQ-W-001..014.
- [ ] `specs/config-registry/spec.md` — ADDED REQ-R-001..007.
- [ ] `specs/context-injection/spec.md` — ADDED REQ-C-001..006.

## T4 — Port core reusable code

Port from `pi-mcp-adapter` with minimal changes (drop proxy-tool code,
drop OAuth/sampling/elicitation code, keep the rest).

- [ ] `agent-dir.ts` — verbatim port.
- [ ] `utils.ts` — port env interpolation, path resolution, truncation;
  drop `getConfigPathFromArgv` (no `--mcp-config` flag in bridge).
- [ ] `logger.ts` — verbatim port.
- [ ] `errors.ts` — verbatim port.
- [ ] `abort.ts` — verbatim port.
- [ ] `error-signal.ts` — verbatim port.
- [ ] `types.ts` — port `McpTool`, `McpResource`, `ServerEntry`,
  `McpConfig` (rename to `BridgeSettings`), `ToolMetadata`,
  `formatToolName`, `isToolExcluded`, `getServerPrefix`. Drop UI types
  that are only used by OAuth/sampling.
- [ ] `state.ts` — port `McpExtensionState` as `McpBridgeState`; drop
  `consentManager` if Phase 1 UI port keeps it, otherwise keep.
- [ ] `npx-resolver.ts` — verbatim port.
- [ ] `server-manager.ts` — port; drop `setSamplingConfig`,
  `setElicitationConfig`, `handleUrlElicitationRequired`,
  `acceptedUrlElicitations`. Keep `connect`, `readResource`, `close`,
  `touch`, idle helpers, `getRequestOptions`.
- [ ] `lifecycle.ts` — port; drop sampling/elicitation wiring.
- [ ] `metadata-cache.ts` — port for compat (the registry replaces it as
  the source of truth, but the cache is still useful for fast reconnect).
- [ ] `tool-metadata.ts` — port `buildToolMetadata`, `findToolByName`,
  `formatSchema`, `getToolNames`. Drop `totalToolCount` (registry has it).
- [ ] `resource-tools.ts` — verbatim port.
- [ ] `mcp-output-guard.ts` — verbatim port.
- [ ] `tool-registrar.ts` — port content transforms; drop proxy-tool
  specifics.
- [ ] `tool-result-renderer.ts` — port; drop proxy-tool renderer, keep
  direct-tool renderer (used by UI sessions).
- [ ] `config.ts` — new module: `BridgeSettings` (outputGuard,
  contextBudgetTokens, idleTimeoutMinutes, requestTimeoutMs). No
  `mcp.json` loader (registry replaces it).

## T5 — Registry

- [ ] `registry/registry-types.ts` — TS types for `meta.v1.json`,
  `tool.v1.json`, `index.v1.json`.
- [ ] `registry/registry-loader.ts` — read registry root, build
  `Registry` object. REQ-R-001..003.
- [ ] `registry/registry-writer.ts` — `sync(serverName)`, `validate()`,
  `rebuildIndex()`. REQ-R-004..006.
- [ ] `registry/schemas/meta.v1.json` — JSON Schema for `meta.json`.
- [ ] `registry/schemas/tool.v1.json` — JSON Schema for `tools/*.json`.
- [ ] `registry/schemas/index.v1.json` — JSON Schema for `index.json`.
- [ ] `examples/filesystem/meta.json` — example registry entry.
- [ ] `examples/filesystem/tools/read_file.json`.
- [ ] `examples/filesystem/tools/list_files.json`.

## T6 — Wrapper tools

- [ ] `call-mcp-tool.ts` — implements REQ-W-001..008.
- [ ] `fetch-mcp-resource.ts` — implements REQ-W-009..014.
- [ ] `context-injector.ts` — implements REQ-C-001..006.

## T7 — UI integration

- [ ] `ui-stream-types.ts` — verbatim port.
- [ ] `ui-server.ts` — verbatim port.
- [ ] `ui-session.ts` — verbatim port.
- [ ] `ui-resource-handler.ts` — verbatim port.
- [ ] `host-html-template.ts` — verbatim port.
- [ ] `glimpse-ui.ts` — verbatim port.
- [ ] `consent-manager.ts` — verbatim port.
- [ ] `app-bridge.bundle.js` — vendored copy from `pi-mcp-adapter`.

## T8 — Entry point + CLI

- [ ] `index.ts` — Pi extension factory; registers `CallMcpTool` +
  `FetchMcpResource`; hooks `session_start` (load registry, inject
  context, init server manager + lifecycle); hooks `session_shutdown`
  (flush + close); registers `/mcp-bridge reload` command.
- [ ] `cli.ts` — `pi-mcp-bridge sync <server>`, `validate`, `add
  <name> --command ...`.

## T9 — Tests

- [ ] `__tests__/registry-loader.test.ts`.
- [ ] `__tests__/registry-writer.test.ts`.
- [ ] `__tests__/context-injector.test.ts`.
- [ ] `__tests__/call-mcp-tool.test.ts`.
- [ ] `__tests__/fetch-mcp-resource.test.ts`.
- [ ] `__tests__/output-guard.test.ts`.

## T10 — Bilingual docs

- [ ] `README.md` (English).
- [ ] `README.zh-CN.md` (Chinese).
- [ ] `docs/architecture.md` (English).
- [ ] `docs/architecture.zh-CN.md` (Chinese).
- [ ] `docs/config-format.md` (English).
- [ ] `docs/config-format.zh-CN.md` (Chinese).
- [ ] `CHANGELOG.md`.

## T11 — CI

- [ ] `.github/workflows/ci.yml` — `npm ci`, `npm test`, `npm run
  typecheck` on Node 20 + 22.
- [ ] `.github/workflows/validate-registry.yml` — run
  `pi-mcp-bridge validate` on registry examples.

## T12 — Future phase proposals

- [ ] `openspec/changes/phase-2-oauth/proposal.md`.
- [ ] `openspec/changes/phase-3-sampling/proposal.md`.
- [ ] `openspec/changes/phase-4-elicitation/proposal.md`.

## Verification checklist (run before archive)

- [ ] `npm run typecheck` passes with no errors.
- [ ] `npm test` passes with no failures.
- [ ] `pi-mcp-bridge validate` on `examples/` passes.
- [ ] Manual smoke test: install the extension in Pi, run a session,
  call `CallMcpTool` on the example filesystem server, observe the
  injected context block.
- [ ] Every REQ-* in `openspec/specs/` has at least one test.
