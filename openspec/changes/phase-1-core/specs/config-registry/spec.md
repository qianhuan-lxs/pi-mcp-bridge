# Delta: config-registry

> Phase 1 deltas against `openspec/specs/config-registry/spec.md`. All
> requirements are ADDED.

## ADDED Requirements

- **ADDED REQ-R-001: Registry root resolution** — `$PI_MCP_BRIDGE_REGISTRY`
  → `<agent dir>/mcp-registry/`; empty registry (not throw) if missing.
- **ADDED REQ-R-002: Server directory naming** — server present iff
  `<root>/<server>/meta.json` parses and `name` matches directory;
  mismatches are warnings, server skipped.
- **ADDED REQ-R-003: Tool file naming** — tool present iff
  `<root>/<server>/tools/<key>.json` parses with non-empty `name`;
  filename is the key, `name` is the original MCP name; both tracked.
- **ADDED REQ-R-004: Atomic writes** — temp-file + rename for all
  registry writes.
- **ADDED REQ-R-005: Sync from live server** — connect, list tools +
  resources (paginated), write `tools/<slug>.json` per tool, update
  `meta.json.syncedAt` + `syncedFrom = "live-server"`, rebuild
  `index.json`.
- **ADDED REQ-R-006: Validate command** — walk root, parse all files,
  report missing required fields / name mismatches / duplicate tool
  names / invalid schemas; exit non-zero on error.
- **ADDED REQ-R-007: Hand-editing** — users may hand-edit; loader never
  overwrites except during `sync`; `sync` refuses
  `meta.json.syncedFrom = "manual"` without `--force`.

## ADDED Schemas

- **ADDED** `meta.v1.json` — server identity + transport + auth +
  lifecycle + capabilities + ui + sync metadata.
- **ADDED** `tool.v1.json` — name, title, description, inputSchema,
  outputSchema, annotations, ui, _meta.
- **ADDED** `index.v1.json` — aggregate index with per-server tool and
  resource lists.

## ADDED Scenarios

- **ADDED** Empty registry — empty `Registry` object, no throw.
- **ADDED** Slug-encoded tool name — filename differs from `name`,
  both tracked.
- **ADDED** Sync overwrites stale tools — removes old files, writes
  new ones, updates `syncedAt`.
- **ADDED** Validate catches a bad schema — reports error, exits 1.
