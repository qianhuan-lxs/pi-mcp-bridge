# Project: pi-mcp-bridge

> Context for AI assistants working on this repository. Read this before
> proposing or implementing changes.

## What this is

`pi-mcp-bridge` is a [Pi](https://github.com/badlogic/pi-mono/) extension that
exposes MCP (Model Context Protocol) servers to the LLM through **exactly two
tools**:

- `CallMcpTool(server, toolName, arguments)` — call any tool on any MCP server.
- `FetchMcpResource(server, uri, downloadPath?)` — read any resource on any
  MCP server.

This is the same idea Cursor uses for
[dynamic context discovery](https://cursor.com/cn/blog/dynamic-context-discovery):
instead of dumping every MCP tool's schema into the system prompt (which can
burn 10k+ tokens per server), the agent gets two cheap tools and a
**filesystem-based registry** that it can read on demand.

## The "filesystem is everything" principle

Every MCP server the agent can talk to is described by a directory on disk:

```
registry/
└── <server-name>/
    ├── meta.json              ← server identity, transport, capabilities
    └── tools/
        ├── <tool-name>.json    ← one file per tool: name, description, schema
        └── ...
```

The model never needs to load every schema into context. On `session_start`,
`pi-mcp-bridge` injects a **compact index** of available servers and tools
into the context. When the model needs the full schema for a specific tool, it
reads the corresponding `<tool-name>.json` file (via Pi's native `read` tool)
and then calls `CallMcpTool` with the right arguments.

This keeps the per-session context cost fixed (~hundreds of tokens for the
index) regardless of how many MCP servers are configured.

## Why two tools instead of one proxy

The upstream `pi-mcp-adapter` project uses a single `mcp({...})` proxy tool
with a discriminated-union parameter (`tool` | `search` | `describe` |
`connect` | `action` | ...). That works, but it pushes discovery logic into
the tool's runtime and forces the model to learn a custom DSL.

`pi-mcp-bridge` takes the opposite stance:

- **Discovery is the filesystem's job.** The model uses Pi's native `read`,
  `grep`, and `ls` to explore `registry/`. No custom search protocol.
- **Invocation is two thin tools.** `CallMcpTool` and `FetchMcpResource` map
  1:1 to the MCP SDK's `tools/call` and `resources/read`. The model already
  knows how to use them from any other MCP-aware host (Cursor, Claude Code,
  etc.).

## Non-goals (for Phase 1)

Phase 1 deliberately omits features that the upstream adapter has. They are
tracked as future OpenSpec changes:

- ❌ OAuth flows (`phase-2-oauth`)
- ❌ Sampling handler (`phase-3-sampling`)
- ❌ Elicitation handler (`phase-4-elicitation`)
- ❌ `directTools` promotion (the whole point of this extension is to *not*
  promote tools — the registry replaces that mechanism)
- ❌ Host-config importers (Cursor/Claude/Codex/Windsurf/VSCode) — out of
  scope for the bridge; use a separate config-migration tool

## Principles

1. **Filesystem is the source of truth.** If a fact about an MCP server is
   not in `registry/<server>/`, the model does not know it. Code that needs
   that fact reads it from disk; code that changes that fact writes it to
   disk.
2. **Two tools, period.** No `mcp({...})` proxy. No discriminated unions.
   `CallMcpTool` and `FetchMcpResource` are the entire surface.
3. **Lazy by default.** Servers connect on first call, not at startup. The
   registry can be read without any server running.
4. **Context is cheap.** The session-start injection is a compact index, not
   the full schemas. Schemas are read on demand.
5. **Brownfield-friendly.** The registry is plain JSON. Users can hand-edit
   it, version-control it, or generate it from a live server with
   `pi-mcp-bridge sync <server>`.
6. **No vendor lock-in.** The two-tool surface matches Cursor's MCP wrapper,
   so prompts and skills that work there port to Pi and vice versa.

## Architecture (high level)

```
┌──────────────────────────────────────────────────────────────┐
│  Pi Agent session                                            │
│                                                              │
│  system prompt  ←── context-injector (session_start)         │
│      • compact server/tool index from registry/              │
│                                                              │
│  tools available to LLM:                                     │
│      • CallMcpTool      ──┐                                   │
│      • FetchMcpResource ──┤── server-manager ── MCP servers  │
│      • Pi native tools   ──┘    (lazy connect, idle timeout)  │
│                                                              │
│  registry/  (filesystem)                                     │
│      <server>/meta.json     ←─ registry-writer (sync)        │
│      <server>/tools/*.json   ←─      reads from live MCP      │
└──────────────────────────────────────────────────────────────┘
```

See `openspec/specs/*/spec.md` for the behavior contracts and
`openspec/changes/phase-1-core/design.md` for the Phase 1 design.

## Target audience

This is an interview project. Reviewers will look at:

- **Spec discipline** — do the OpenSpec artifacts match the code?
- **Architecture clarity** — is the two-tool + registry story easy to
  explain and easy to justify?
- **Code quality** — TypeScript strict mode, no `any` leaks, clear module
  boundaries.
- **Bilingual docs** — README + architecture docs in both English and
  Chinese.
- **Test coverage** — unit tests for the registry loader, the context
  injector, and the two wrapper tools.

## License

MIT, © 2026 qianhuan-lxs.
