# Phase 4 — Elicitation

## Proposal

### Scope

Add server-initiated `elicitation/create` support, so an MCP server can ask the user a structured question (e.g. "which repo?", "approve this PR?") and receive a typed answer back, without the server having to render its own UI.

### Motivation

`elicitation/create` is the MCP protocol's hook for servers that need user input mid-tool-call but don't ship a UI resource. It's the natural complement to Phase 1's UI integration: tools that declare `ui.resourceUri` render their own UI; tools that don't but still need input use elicitation. Phase 1 omitted it to keep the surface minimal; Phase 4 adds it gated by `meta.json#capabilities.elicitation`.

### In scope

- Honor `elicitation/create` requests from connected MCP servers when `meta.json#capabilities.elicitation === true`.
- Render the request's JSON Schema as a form in the Pi TUI (text fields, booleans, enums, simple objects).
- Validate the user's response against the schema before returning it to the server.
- User consent gate: reuse `ConsentManager` so the first elicitation from a server prompts for blanket approval; subsequent elicitations just render.
- Cancellation: the user can cancel an elicitation, which returns a `cancelled` result to the server.

### Out of scope

- Servers rendering their own elicitation UI via a UI resource (that's Phase 1's UI integration; this phase is for schema-driven forms only).
- Multi-step elicitation wizards (Phase 4 is one schema → one response).
- Elicitation from non-tool contexts (e.g. server-initiated prompts outside a tool call) — Phase 4 only fires during an in-flight tool call.

### Impact

- `server-manager.ts`: register an `elicitation/create` handler when the server's capability flag is set.
- New module: `elicitation-handler.ts` (schema → form, validation, consent gate, cancellation).
- New TUI component: a schema-driven form renderer in `tool-result-renderer.ts`.
- `types.ts`: add `ElicitationRequest` / `ElicitationResult` types.
- `meta.json` schema: populate `capabilities.elicitation`.

### Open questions

- Should we support file uploads in elicitation forms, or restrict to JSON-Schema primitives? Leaning toward primitives only for Phase 4.
- Should the form be rendered inline in the TUI, or as a modal overlay? Leaning toward modal for focus.
