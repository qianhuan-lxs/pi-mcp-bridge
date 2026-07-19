# Design: pi-mcp-bridge stability pass (v0.5.1)

**Date:** 2026-07-19  
**Status:** approved — implemented in v0.5.1  
**Package:** `@qianhuan-lxs/pi-mcp-bridge`  
**Out of scope:** MCP UI session ↔ `ui-server` wiring (follow-up PR)

## Problem

Users experience “context loss” after `/mcp-bridge reload` or editing `mcp-servers.json`: the model shells around looking for `registry/` relative paths, while the TUI promises “Next turn will use the updated context.” Separately, documented lazy idle-disconnect never runs because lifecycle registration is unwired, and config/reload feedback is silent when nothing is read.

## Goals

1. After registry changes (reload / sync / reconcile), the **next** agent turn’s system prompt contains a **fresh** MCP index (not a stale cached append).
2. Model-facing paths are always **absolute** (`registry.root`); no relative `registry/...` in tool descriptions or truncation notes.
3. `mcp-servers.json` reconcile + auto-sync behave the same on `session_start` and `/mcp-bridge reload`, with explicit user feedback (found / missing / parse errors / sync targets).
4. Servers that need tools (`added`, `updated`, or configured with **0 tools**) get auto-synced.
5. Idle disconnect / keep-alive actually run for registered servers; `idleTimeout: 0` disables the sweep.
6. Sync and runtime use the same stdio env resolution; failed MCP calls surface as Pi tool errors for connect/not-found codes too.

## Non-goals

- Full UI session registration / `pushResult` / browser iframe path.
- OAuth / sampling / elicitation phases.
- Changing the dual-layer model (config file + filesystem registry) to OpenCode’s eager native tools.
- Backgrounding all of `session_start` (partial early-state is in scope; full async init is follow-up if still needed).

---

## Design

### 1. Context injection refresh

**Current bug:** `before_agent_start` skips whenever `systemPrompt` already contains `INJECTION_HEADER`. Reload/sync only nulls `injectedBlock`, which is unused for the skip decision. Pi reuses the augmented system prompt → stale index forever in-session.

**Approach:**

- Add a stable end marker after the MCP block, e.g. `<!-- /pi-mcp-bridge -->` (exported as `INJECTION_FOOTER`).
- Track `registryGeneration` (monotonic int) on `BridgeState`; bump on every successful `loadRegistry` after sync/reload/reconcile.
- On `before_agent_start`:
  1. Build fresh `block = buildContextBlock(...)`.
  2. If prompt contains `INJECTION_HEADER`, **replace** the span from header through footer (inclusive) with the new block.
  3. Else append block + footer.
  4. Only skip rebuild when `registryGeneration` equals the generation last injected **and** the header is already present (optional micro-opt; correctness first: always rebuild when generation changed).

**Helper:** `replaceOrAppendMcpBlock(systemPrompt, block): string` in `context-injector.ts` (unit-tested).

**Messaging:** Reload notify stays honest: “Next turn will use the updated context” only after bumping generation (already true if we fix injection).

### 2. Absolute paths in model-facing strings

| Location | Fix |
|----------|-----|
| `CallMcpTool` / `FetchMcpResource` / `ListMcpResources` descriptions | Point at absolute root from `state.registry.root`, or say “use the `folder:` path under each server in the MCP servers system-prompt block” — never `registry/<server>/...`. |
| Truncation note in `buildContextBlock` | Interpolate real `root` (bug: literal `` `${root}` `` today). |
| README examples (if any still show relative registry paths for agent reads) | Align with absolute `folder:` guidance. |

### 3. Unified reconcile + auto-sync

Extract `reconcileAndAutoSync(opts)` used by `session_start` and `/mcp-bridge reload`:

```ts
type ReconcileAndSyncOpts = {
  cwd?: string;
  /** User-facing notify; if omitted, log only (session_start). */
  notify?: (msg: string, level?: "info" | "warning" | "error") => void;
  /** Sync runner (reload uses runSync for spinner; session_start may use doSync). */
  sync: (name: string) => Promise<{ ok: boolean; error?: string; toolsWritten?: number }>;
};
```

**Auto-sync targets** (replaces `new_only`):

- All names in `rec.added`
- All names in `rec.updated` (transport/auth changed → schemas may be stale)
- Plus any enabled config entry whose registry server has `tools.size === 0` and a usable transport (“needs tools”)

Dedupe the name list; sync in parallel via `Promise.allSettled`.

**Feedback (always on reload; log + optional notify on session_start):**

- No config files found → notify paths checked (`global` + `project`).
- Files found → “Reconciled from …: N added, M updated, K to sync, O orphans”.
- Per-server sync failure → error notify/log.
- After package update: short note in README + `/mcp-bridge status` that **Pi must be restarted** to load new extension code (`/mcp-bridge reload` only reloads registry).

### 4. Lifecycle wiring

On `session_start` (after registry load / reconcile) and after reload:

- For each server in `state.registry.servers`:
  - `lifecycle.registerServer(name, metaToServerEntry(meta), { idleTimeout: meta.lifecycle?.idleTimeoutMinutes })`
  - If `meta.lifecycle?.mode === "keep-alive"`, `lifecycle.markKeepAlive(name, entry)`
- Clear/rebuild registration maps on reload (add `lifecycle.clearServers()` or re-create manager — prefer `clear()` + re-register to avoid leaking old names).

**`idleTimeout: 0`:** In `loadBridgeSettings`, accept `0` as disable (`nonNegativeInt` / explicit `=== 0`). `setGlobalIdleTimeout(0)` → sweep treats timeout `0` as disabled (already `timeout > 0` check in `checkConnections`).

### 5. Connection fingerprint (light)

In `McpServerManager.connect`: if an existing connection is `"connected"` but transport fingerprint (kind + command/args/cwd or url/headers) differs from the new definition, `close(name)` then connect fresh. Prevents stale stdio after `mcp-servers.json` transport edits.

### 6. `doSync` env parity

Export `resolveEnv` from `server-manager.ts` (or tiny `env.ts`) and use it in `registry-commands.ts` `doSync` for stdio transport so sync matches runtime.

### 7. Error signaling

Extend `toolErrorOverride` to treat as errors:

- `tool_error`, `call_failed` (existing)
- `connect_failed`, `server_not_found`, `tool_not_found`
- optionally `auth_required`, `consent_required` (user-visible failures)

Keep validation / soft guidance codes non-error if any exist.

### 8. Early state on session_start (minimal)

Before awaiting auto-sync:

1. Build `nextState` with current registry (metas may exist, tools may be empty).
2. Assign `state = nextState` and register lifecycle.
3. Then run auto-sync; on completion reload registry into `state`, bump `registryGeneration`, refresh status bar.

This shrinks the `not_initialized` window for unrelated tools without a full background architecture.

---

## Tests

| Area | Cases |
|------|--------|
| `replaceOrAppendMcpBlock` | append when missing; replace when present; footer boundary |
| truncation note | contains real absolute path |
| reconcile auto-sync targets | added / updated / zero-tools included; orphans not synced |
| `idleTimeout: 0` | settings load returns 0 |
| `toolErrorOverride` | connect_failed → isError |
| lifecycle | registerServer then idle → close called (mock manager) |
| connect fingerprint | definition change forces reconnect |

Bump package to **0.5.1**; CHANGELOG + short README notes (EN + zh-CN) for restart-after-update and auto-sync policy.

---

## Acceptance

1. `/mcp-bridge reload` after adding a server → next turn system prompt lists the new server/tools (strip/replace verified by unit test + manual).
2. Model-facing strings never recommend relative `registry/...`.
3. Configured servers with 0 tools get synced on session_start/reload without a separate `/mcp-bridge sync`.
4. Idle timeout closes a lazy connection when registered; `idleTimeout: 0` disables.
5. Editing command in `mcp-servers.json` + reload updates tools (or sync runs for `updated`).
6. Failed connect surfaces as tool error in Pi TUI.
7. UI browser path remains deferred (no claim of fix in this release).

## Risks

- Replacing the system-prompt span every registry change busts prompt cache for that session segment — acceptable and correct vs lying about “updated context.”
- Auto-syncing all zero-tool servers on every start may slow first session if many stubs exist; mitigate with parallel `allSettled` and clear failure messages (not serial silent hangs).
- Fingerprint reconnect mid-turn is rare; document that reload may drop live connections for updated servers.
