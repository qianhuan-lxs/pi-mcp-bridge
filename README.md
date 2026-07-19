# pi-mcp-bridge

> A [Pi Agent](https://pi.dev/docs/latest/extensions) extension that bridges any [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server into Pi using **exactly two LLM-callable tools** — `CallMcpTool` and `FetchMcpResource` — plus a **filesystem-first registry** that keeps the agent's context window cheap.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.19-green.svg)](./package.json)
[![Specs: OpenSpec](https://img.shields.io/badge/OpenSpec-phase--1--core-orange)](./openspec/)

**简体中文** · [English](./README.md)

---

## Why

Cursor's [Dynamic Context Discovery](https://cursor.com/cn/blog/dynamic-context-discovery) essay makes a sharp observation: exposing every MCP tool directly to the LLM bloats the system prompt and burns context. The fix is to expose only **two generic tools** and let the model fetch specific tool schemas on demand from a compact, discoverable registry.

`pi-mcp-bridge` brings that pattern to the Pi Agent:

- **`CallMcpTool`** — call any MCP tool by `server` + `toolName` + `arguments`.
- **`FetchMcpResource`** — read any MCP resource by `server` + `uri`, optionally saving to disk.
- **Filesystem is everything** — each MCP server is described by `registry/<server>/meta.json` + `registry/<server>/tools/<tool>.json`. The agent reads these files to learn *how* to call a tool, then invokes `CallMcpTool` with the right arguments.
- **Cheap context** — on `session_start`, a compact Markdown index of the registry is injected into the system prompt. The full tool schemas stay on disk until the model asks for them.
- **Lazy by default** — MCP servers connect only when their tools are called, and disconnect after a configurable idle timeout.
- **No vendor lock-in** — the registry is plain JSON. You can `git diff` it, hand-edit it, or generate it from a live MCP server with `pi-mcp-bridge sync`.

## Architecture (60-second tour)

```
┌──────────────────────────────────────────────────────────────────┐
│  Pi Agent (LLM)                                                  │
│    system prompt  ◀──  injected context block (compact index)    │
│    tools: [CallMcpTool, FetchMcpResource]                        │
└───────────────┬──────────────────────────────────────────────────┘
                │ CallMcpTool({server, toolName, arguments})
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  pi-mcp-bridge                                                   │
│   1. resolve (server, toolName) → registry/<server>/tools/*.json │
│   2. lazy connect to that MCP server (idle timeout)             │
│   3. forward arguments, await result                             │
│   4. output-guard: truncate + spill to temp file                 │
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
~/.pi/agent/mcp-bridge/registry/
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

1. Read the injected registry index from its system prompt.
2. Read `registry/filesystem/tools/list_files.json` to learn the schema.
3. Call `CallMcpTool({server:"filesystem", toolName:"list_files", arguments:{path:"/Users/me"}})`.
4. Receive the result (truncated if large, with a temp-file spill for the full content).

## Registry layout

```
registry/
  <server>/
    meta.json          # server config: command, env, transport, timeouts
    tools/
      <tool>.json      # one file per tool: name, description, inputSchema
  index.json           # aggregate index (rebuilt by `sync` / `validate`)
```

`meta.json` example:

```json
{
  "name": "filesystem",
  "transport": {
    "kind": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"],
    "env": {}
  },
  "auth": { "kind": "none" },
  "lifecycle": { "mode": "lazy", "idleTimeoutMinutes": 10 }
}
```

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

## CLI

```bash
npx pi-mcp-bridge <command>

Commands:
  sync <server> -- <command>     Connect to a live MCP server and write its
                                 meta.json + tools/*.json into the registry.
  validate                       Validate the registry against the JSON schemas
                                 and rebuild index.json.
  add <server> [--env K=V]... -- <command>
                                 Add a server stub (meta.json only); use `sync`
                                 afterwards to fetch its tool descriptors.
  list                           List all servers in the registry and their tools.
```

## Configuration

`~/.pi/agent/mcp-bridge.json`:

```jsonc
{
  "registryRoot": "~/.pi/agent/mcp-bridge/registry",  // default
  "idleTimeout": 10,                                  // seconds, default 10
  "requestTimeoutMs": 60000,                          // default 60s
  "contextBudgetChars": 6000,                          // injected index size
  "uiViewer": "auto"                                   // "auto" | "browser" | "glimpse"
}
```

## OpenSpec

This project is spec-driven via [OpenSpec](https://github.com/Fission-AI/OpenSpec). See:

- [`openspec/project.md`](./openspec/project.md) — high-level project context and principles.
- [`openspec/specs/`](./openspec/specs/) — behavior contracts (the "what").
- [`openspec/changes/phase-1-core/`](./openspec/changes/phase-1-core/) — Phase 1 proposal, design, and task list (the "how" and "when").

### Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 — Core | Two tools, filesystem registry, context injection, lazy connect, output guard, UI integration | ✅ This release |
| 2 — OAuth | OAuth 2.1 flow, dynamic client registration, PKCE | 📋 Proposed |
| 3 — Sampling | Server-initiated `sampling/createMessage` | 📋 Proposed |
| 4 — Elicitation | Server-initiated `elicitation/create` | 📋 Proposed |

## License

MIT © 2026 [qianhuan-lxs](https://github.com/qianhuan-lxs)
