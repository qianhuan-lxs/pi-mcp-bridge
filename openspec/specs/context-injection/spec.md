# Spec: context-injection

> Behavior contract for the session-start context injection. This is what
> keeps the per-session context cost fixed regardless of how many MCP
> servers and tools are configured.

## Requirements

### REQ-C-001: Trigger

The injector MUST run on `session_start`, after the registry loader has
loaded `index.json`. The injector MUST complete before
`CallMcpTool` / `FetchMcpResource` are first callable.

### REQ-C-002: Output format

The injected context MUST be a single Markdown block appended to the
session's system context. The block MUST contain, in this order:

1. A one-line header: `## MCP servers (via pi-mcp-bridge)`.
2. A one-line summary: `<n> servers, <m> tools, <k> resources — use CallMcpTool / FetchMcpResource to invoke; read registry/<server>/tools/<tool>.json for full schemas.`
3. One section per server, in the order they appear in `index.json`:
   - `### <server-name>` (or `### <server-name> — <short description>` if
     `meta.json.description` is set).
   - A bulleted list of tools: `- <tool-key>: <truncated description>`
     (description truncated to ~80 chars).
   - A bulleted list of resources (if any): `- <uri>: <truncated description>`.
4. A footer: `Use Pi's read/grep/ls tools on registry/<server>/tools/<tool>.json to see the full input schema before calling CallMcpTool.`

### REQ-C-003: Size budget

The injected block MUST stay under a configurable budget
(`settings.contextBudgetTokens`, default 4000 tokens). If the registry
exceeds the budget:
- The injector MUST truncate the per-tool descriptions to 40 chars.
- If still over budget, the injector MUST drop per-tool descriptions
  entirely and list only tool keys.
- If still over budget, the injector MUST drop per-server tool lists and
  list only server names with tool counts.
- The injector MUST include a final note when truncation happened:
  `> (truncated — read registry/<server>/tools/ for the full list)`.

### REQ-C-004: No live connections

The injector MUST NOT connect to any MCP server. It works purely from
`index.json` on disk. This keeps cold-start latency at zero and avoids
burning tokens on servers the model will not use.

### REQ-C-005: Re-injection on reload

When the Pi host emits a `reload` event (or when the user runs
`/mcp-bridge reload`), the injector MUST:
1. Re-read `index.json`.
2. Replace the previously injected block (identified by its header) with
   the new one.
3. Notify the user via `ctx.ui.notify` if the server/tool count changed.

### REQ-C-006: Empty registry

If the registry is empty, the injector MUST inject a short block:

```
## MCP servers (via pi-mcp-bridge)
0 servers configured. Run `pi-mcp-bridge add <server-name>` or hand-edit
registry/<server>/meta.json to add an MCP server.
```

## Scenarios

```gherkin
Scenario: Typical injection
Given registry/index.json lists 2 servers with 5 tools each
When session_start fires
Then the system context gains a Markdown block with header "## MCP servers (via pi-mcp-bridge)"
And a summary line "2 servers, 10 tools, 0 resources — ..."
And one "###" section per server with 5 tool bullets each
And a footer line about reading registry/<server>/tools/<tool>.json

Scenario: Over-budget truncation
Given the registry has 20 servers with 50 tools each
And settings.contextBudgetTokens = 1000
When session_start fires
Then the injected block lists server names with tool counts only
And includes a "> (truncated — read registry/...)" note

Scenario: Reload updates the block
Given a session is running with an injected block listing 2 servers
And the user adds a 3rd server and runs /mcp-bridge reload
When the reload event fires
Then the previously injected block is replaced
And the new block lists 3 servers
And ctx.ui.notify shows "MCP registry reloaded: 3 servers, ..."
```
