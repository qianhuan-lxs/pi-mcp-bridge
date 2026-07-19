# pi-mcp-bridge

> A [Pi Agent](https://pi.dev/docs/latest/extensions) extension that bridges any [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server into Pi using **three LLM-callable tools** — `CallMcpTool`, `FetchMcpResource`, and `ListMcpResources` — plus a **filesystem-first registry** and **Cursor-style system-prompt injection** that keeps the agent's context window cheap and cache-friendly.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.19-green.svg)](./package.json)
[![Specs: OpenSpec](https://img.shields.io/badge/OpenSpec-phase--1--core-orange)](./openspec/)

**简体中文** · [English](./README.md)

---

## Why

Cursor's [Dynamic Context Discovery](https://cursor.com/cn/blog/dynamic-context-discovery) essay makes a sharp observation: exposing every MCP tool directly to the LLM bloats the system prompt and burns context. The fix is to expose only a few generic tools and let the model fetch specific tool schemas on demand from a compact, discoverable registry.

`pi-mcp-bridge` brings that pattern to the Pi Agent — and aligns with how Cursor actually does it:

- **`CallMcpTool`** — call any MCP tool by `server` + `toolName` + `arguments`.
- **`FetchMcpResource`** — read any MCP resource by `server` + `uri`, optionally saving to disk.
- **`ListMcpResources`** — list the resources exposed by a server (discover before you fetch).
- **Filesystem is everything** — each MCP server is described by `registry/<server>/meta.json` + `registry/<server>/tools/<tool>.json`. The agent reads these files to learn *how* to call a tool, then invokes `CallMcpTool` with the right arguments.
- **Cursor-style system-prompt injection** — on each turn, a compact Markdown index of the registry is **appended to the system prompt** via the `before_agent_start` event (not prepended as a user message). The system prompt is the most stable cache prefix, so the block is cached across turns as long as the registry doesn't change. For small registries (≤ 30 tools by default), full `inputSchema`s are inlined so the model can call correctly on the first try; for larger registries, the block falls back to names + descriptions and the model reads schema files on demand.
- **Server `instructions` captured** — the MCP protocol's `InitializeResult.instructions` (the server's own description of its purpose and usage) is captured at sync time, persisted to `meta.json`, and rendered as a blockquote under each server header — so the model sees the server's intended usage pattern, not just our tool descriptions.
- **Lazy by default** — MCP servers connect only when their tools are called, and disconnect after a configurable idle timeout.
- **No vendor lock-in** — the registry is plain JSON. You can `git diff` it, hand-edit it, or generate it from a live MCP server with `/mcp-bridge sync`.

## Architecture (60-second tour)

```
┌──────────────────────────────────────────────────────────────────┐
│  Pi Agent (LLM)                                                  │
│    system prompt  ◀──  MCP registry block appended via           │
│                       before_agent_start (Cursor-style)           │
│    tools: [CallMcpTool, FetchMcpResource, ListMcpResources]      │
└───────────────┬──────────────────────────────────────────────────┘
                │ CallMcpTool({server, toolName, arguments})
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  pi-mcp-bridge                                                   │
│   1. resolve (server, toolName) → registry/<server>/tools/*.json │
│   2. lazy connect to that MCP server (idle timeout)              │
│   3. forward arguments, await result                             │
│   4. output-guard: truncate + spill to temp file                  │
│   5. return ContentBlocks to Pi                                  │
└───────────────┬──────────────────────────────────────────────────┘
                │ MCP protocol (stdio / HTTP / SSE)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  MCP servers (filesystem, github, slack, …)                      │
└──────────────────────────────────────────────────────────────────┘
```

See [`docs/architecture.md`](./docs/architecture.md) for the full module map, design decisions, and behavior contracts.

## Quick start

### 1. Install

```bash
pi install npm:@qianhuan-lxs/pi-mcp-bridge
```

This installs the package under `~/.pi/agent/npm/` and auto-registers the extension via its `pi.extensions` manifest — no manual config editing required.

> **Note:** `pi install` requires Pi v0.74+. If you're on an older Pi or want to manage it manually, add `"@qianhuan-lxs/pi-mcp-bridge"` to the `packages` array in your `~/.pi/agent/settings.json`.

### 2. Register the extension

Add to your Pi agent config (e.g. `~/.pi/agent.json`):

```jsonc
{
  "extensions": [
    "pi-mcp-bridge"
  ]
}
```

### 3. Add an MCP server to the registry

```
# Inside Pi — sync a live MCP server's tools into the registry (primary path)
/mcp-bridge sync filesystem -- npx -y @modelcontextprotocol/server-filesystem /Users/me

# Or add a server stub first, then sync
/mcp-bridge add github --env GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y @modelcontextprotocol/server-github
/mcp-bridge sync github

# Validate / list / check status
/mcp-bridge validate
/mcp-bridge list
/mcp-bridge status
```

> **Why slash commands?** Registry management happens inside Pi via `/mcp-bridge ...` so there's no PATH setup and no separate CLI binary to install. An optional `cli.ts` is still included for scripting — run it via `npx tsx ./node_modules/@qianhuan-lxs/pi-mcp-bridge/cli.ts <cmd>`.

This produces:

```
~/.pi/agent/mcp-registry/
  filesystem/
    meta.json
    tools/
      read_file.json
      list_files.json
      ...
  index.json
```

### 4. Restart Pi and ask

```
> list the files in my home folder using the filesystem MCP
```

The agent will:

1. Read the MCP registry block from its **system prompt** (injected via `before_agent_start`). For small registries the full `inputSchema` is already inline; for large ones it sees the server's `folder:` path and reads `<folder>/tools/<tool>.json` on demand.
2. Call `CallMcpTool({server:"filesystem", toolName:"list_files", arguments:{path:"/Users/me"}})`.
3. Receive the result (truncated if large, with a temp-file spill for the full content).

To discover resources first, use `ListMcpResources({server:"..."})`, then `FetchMcpResource({server, uri})`.

## Registry layout

```
~/.pi/agent/mcp-registry/
  <server>/
    meta.json          # server config: command, env, transport, timeouts, instructions
    tools/
      <tool>.json      # one file per tool: name, description, inputSchema
  index.json           # aggregate index (rebuilt by `sync` / `validate`)
```

`meta.json` example:

```json
{
  "name": "filesystem",
  "description": "Filesystem MCP server",
  "instructions": "Use this server to read and write files. Always pass absolute paths.",
  "transport": {
    "kind": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"],
    "env": {}
  },
  "auth": { "kind": "none" },
  "lifecycle": { "mode": "lazy", "idleTimeoutMinutes": 10 },
  "syncedFrom": "live-server",
  "syncedAt": "2026-07-19T06:00:00.000Z"
}
```

> `instructions` is captured automatically from the MCP server's `initialize` response during `/mcp-bridge sync`. You can also hand-edit it.

`tools/read_file.json` example:

```json
{
  "name": "read_file",
  "description": "Read a file from the filesystem.",
  "inputSchema": {
    "type": "object",
    "properties": { "path": { "type": "string" } },
    "required": ["path"]
  }
}
```

See [`docs/config-format.md`](./docs/config-format.md) for the full schema reference.

## Context injection (how the model learns about MCP)

The injected block is appended to the **system prompt** on every turn via the `before_agent_start` event. It walks a truncation ladder (most detail first; first level that fits the token budget wins):

| Level | Content | When used |
|-------|---------|-----------|
| 1. `renderWithSchemas` | tool names + descriptions + **full `inputSchema` JSON inline** + server `instructions` | registry ≤ `schemaInjectionToolLimit` tools (default 30) AND fits budget |
| 2. `renderFull(80)` | tool names + 80-char descriptions + server `instructions` | level 1 skipped/overflowed |
| 3. `renderFull(40)` | tool names + 40-char descriptions + `instructions` | level 2 overflowed |
| 4. `renderKeysOnly` | tool keys only + `instructions` | level 3 overflowed |
| 5. `renderCountsOnly` | server names + tool counts | level 4 overflowed |

Each server header includes `folder: <absolute descriptor path>` so the model knows where to `ls`/`read` for schemas. The block also includes a `MANDATORY: read the tool's descriptor file before calling CallMcpTool` instruction (with a caveat that inline schemas let the model skip the read).

**Why system-prompt injection?** It's the most cache-friendly injection point — the system prompt is the stable cache prefix, so the block is cached across turns as long as the registry doesn't change. (Earlier versions prepended a `user` message via the `context` event, which worked but shifted the message array and was less cache-friendly. v0.3.0 switched to `before_agent_start` to match Cursor's approach.)

## Slash commands

The `/mcp-bridge` command is the primary interface for registry management (no separate CLI binary, no PATH setup):

```
/mcp-bridge sync <server> [--env K=V]... [--force] -- <command> [args...]
    Connect to a live MCP server, capture its instructions + tools/resources,
    and write meta.json + tools/*.json into the registry. Auto-reloads the
    agent context for the next turn.

/mcp-bridge add <server> [--env K=V]... -- <command> [args...]
    Add a server stub (meta.json only); use `sync` afterwards to populate tools/.

/mcp-bridge add <server> --url <url> [--description <text>]
    Add an HTTP-transport server stub.

/mcp-bridge validate
    Validate the registry against the JSON schemas and rebuild index.json.

/mcp-bridge list
    List all servers in the registry and their tools.

/mcp-bridge status
    Show how many servers and tools are currently loaded.

/mcp-bridge reload
    Re-read the registry from disk and refresh the agent context.
```

An optional `cli.ts` wraps the same logic for scripting/CI:

```bash
npx tsx ./node_modules/@qianhuan-lxs/pi-mcp-bridge/cli.ts <sync|add|validate|list> ...
```

## Configuration

`~/.pi/agent/mcp-bridge.json` (all fields optional; defaults shown):

```jsonc
{
  "idleTimeout": 10,                  // minutes, default 10, 0 to disable
  "requestTimeoutMs": 0,             // ms, 0 = use SDK default
  "outputGuard": true,               // truncate oversized tool outputs
  "contextBudgetTokens": 4000,       // max tokens for the injected system-prompt block
  "schemaInjectionToolLimit": 30,    // registries with > N tools skip inline schemas
                                     // 0 = disable inline schemas entirely
  "uiViewer": "auto"                 // "auto" | "browser" | "glimpse"
}
```

Environment overrides:
- `PI_CODING_AGENT_DIR` — override the Pi agent directory (default `~/.pi/agent`).
- `PI_MCP_BRIDGE_REGISTRY` — override the registry root (default `<agent dir>/mcp-registry`).
- `MCP_OUTPUT_GUARD=0` — disable the output guard.

## OpenSpec

This project is spec-driven via [OpenSpec](https://github.com/Fission-AI/OpenSpec). See:

- [`openspec/project.md`](./openspec/project.md) — high-level project context and principles.
- [`openspec/specs/`](./openspec/specs/) — behavior contracts (the "what").
- [`openspec/changes/phase-1-core/`](./openspec/changes/phase-1-core/) — Phase 1 proposal, design, and task list (the "how" and "when").

### Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 — Core | Three tools, filesystem registry, system-prompt injection, lazy connect, output guard, UI integration, server `instructions` capture | ✅ This release |
| 2 — OAuth | OAuth 2.1 flow, dynamic client registration, PKCE, `mcp_auth` tool | 📋 Proposed |
| 3 — Sampling | Server-initiated `sampling/createMessage` | 📋 Proposed |
| 4 — Elicitation | Server-initiated `elicitation/create` | 📋 Proposed |

## License

MIT © 2026 [qianhuan-lxs](https://github.com/qianhuan-lxs)
