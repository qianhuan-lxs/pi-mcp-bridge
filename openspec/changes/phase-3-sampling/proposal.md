# Phase 3 — Sampling

## Proposal

### Scope

Add server-initiated `sampling/createMessage` support, so an MCP server can ask the host LLM to generate text (e.g. "summarize this file", "draft a reply") and receive the completion back.

### Motivation

Some MCP servers (notably coding assistants and research agents) want to delegate sub-tasks to the host LLM rather than implement their own model integration. The MCP `sampling/createMessage` request is the protocol-level hook for this. Phase 1 deliberately omitted it to keep the two-tool surface clean; Phase 3 adds it as an opt-in capability gated by `meta.json#capabilities.sampling`.

### In scope

- Honor `sampling/createMessage` requests from connected MCP servers when `meta.json#capabilities.sampling === true`.
- Route the request to the host Pi LLM via a new internal hook (not a user-facing tool).
- Apply a per-server token budget and a model preference override from `meta.json#sampling`.
- Surface the sampling round-trip in the Pi TUI as a collapsible "MCP sampling" entry under the originating tool call.
- User consent gate: the first time a server requests sampling, prompt the user (reusing `ConsentManager` with mode `once-per-server`).

### Out of scope

- Letting the LLM initiate sampling (it's strictly server-initiated).
- Streaming sampling results (Phase 3 returns the full completion; streaming is a possible Phase 5).
- Multi-turn sampling conversations (Phase 3 is one-shot per request).

### Impact

- `server-manager.ts`: register a `sampling/createMessage` handler when the server's capability flag is set.
- New module: `sampling-handler.ts` (budget enforcement, model selection, consent gate, TUI surfacing).
- `types.ts`: add `SamplingRequest` / `SamplingResult` types.
- `meta.json` schema: populate `capabilities.sampling` and add an optional `sampling` block (`maxTokens`, `modelPreference`, `temperature`).

### Open questions

- Should the sampling handler reuse the active Pi session's model, or spawn a separate model invocation? Leaning toward the active session for context continuity.
- How should we surface a sampling request that the user denies? Return an error to the server, or just drop the request?
