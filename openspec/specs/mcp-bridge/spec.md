# Spec: mcp-bridge

> Behavior contract for the `pi-mcp-bridge` extension as a whole. The other
> specs (`wrapper-tools`, `config-registry`, `context-injection`) elaborate
> on the parts of this contract.

## Purpose

`pi-mcp-bridge` is a Pi extension that gives the LLM access to MCP servers
through exactly two tools (`CallMcpTool`, `FetchMcpResource`) and a
filesystem-based registry of server/tool metadata.

## Requirements

### REQ-001: Extension lifecycle

The extension MUST register itself as a Pi extension via a default-exported
factory function `(pi: ExtensionAPI) => void` at `./index.ts`.

The extension MUST subscribe to at least these Pi events:
- `session_start` — load the registry, inject context, prepare the
  server manager.
- `session_shutdown` — flush the metadata cache, close all server
  connections, release timers.

The extension MUST NOT start long-lived resources (processes, sockets,
timers) from the factory body. All such resources MUST be deferred to
`session_start` or later.

### REQ-002: Two-tool surface

The extension MUST register exactly two tools with the Pi host:

- `CallMcpTool`
- `FetchMcpResource`

The extension MUST NOT register any other LLM-callable tools. Native Pi
tools (`read`, `bash`, `edit`, `grep`, `ls`, ...) remain available and are
the primary discovery mechanism for the registry.

The behavior contracts of these two tools live in
`openspec/specs/wrapper-tools/spec.md`.

### REQ-003: Filesystem registry

The extension MUST read all server and tool metadata from a filesystem
registry rooted at `<agent dir>/mcp-registry/` (or `$PI_MCP_BRIDGE_REGISTRY`
if set). The format is defined in `openspec/specs/config-registry/spec.md`.

The extension MUST NOT require a live MCP server to be running in order to
read the registry. The registry is the source of truth for *what exists*;
live connections are only needed for *what to call*.

### REQ-004: Context injection

On `session_start`, the extension MUST inject a compact index of available
servers and tools into the session context. The index MUST be small enough
to fit comfortably in a system prompt regardless of how many tools are
registered (target: < 1 token per tool, < 50 tokens per server).

The full contract lives in `openspec/specs/context-injection/spec.md`.

### REQ-005: Lazy connections

Servers MUST connect on first `CallMcpTool` or `FetchMcpResource` invocation
that targets them, not at startup. Idle servers MUST disconnect after a
configurable timeout (default 10 minutes). The next call after disconnect
MUST transparently reconnect.

### REQ-006: Output guard

Tool and resource results returned to the model MUST be guarded against
oversized payloads. Inline text output MUST be capped at 50 KiB / 2000
lines by default. Larger output MUST be truncated to a head preview and
spilled to a temp file whose path is included in the result.

The output guard MUST be disable-able via `settings.outputGuard = false` or
the `MCP_OUTPUT_GUARD=0` environment variable.

### REQ-007: Abort propagation

`CallMcpTool` and `FetchMcpResource` MUST accept and honor an `AbortSignal`.
When the signal aborts, in-flight MCP requests MUST be cancelled and the
tool MUST return a result indicating the call was aborted (not failed).

### REQ-008: No silent failures

When a server is not configured, not connected, or returns an error, the
wrapper tools MUST return a structured result whose `content` explains the
problem in human-readable English AND whose `details` carries a machine-
readable `error` code. The model MUST be able to recover from the error
without user intervention when possible (e.g., by calling
`CallMcpTool` again after the registry says the server is lazy-connectable).

## Out of scope (Phase 1)

- OAuth flows — see `openspec/changes/phase-2-oauth/proposal.md`.
- Sampling — see `openspec/changes/phase-3-sampling/proposal.md`.
- Elicitation — see `openspec/changes/phase-4-elicitation/proposal.md`.
- Host-config importers (Cursor/Claude/Codex/Windsurf/VSCode).
- `directTools` promotion — the registry replaces this mechanism.

## Scenarios

### SCN-001: Cold start with no registry

```gherkin
Given the registry directory does not exist
When the agent session starts
Then the extension injects an empty index into context
And the extension registers CallMcpTool and FetchMcpResource
And no MCP server processes are started
```

### SCN-002: First call triggers lazy connect

```gherkin
Given the registry contains server "filesystem" with tool "read_file"
And the server is not currently connected
When the LLM calls CallMcpTool({ server: "filesystem", toolName: "read_file", arguments: { path: "/tmp/x" } })
Then the extension connects to the "filesystem" server
And the extension forwards the call
And the connection is kept open for the idle timeout window
```

### SCN-003: Idle disconnect

```gherkin
Given server "filesystem" is connected
And the idle timeout is 10 minutes
When 10 minutes pass with no calls to "filesystem"
Then the extension closes the connection
And the next CallMcpTool to "filesystem" reconnects transparently
```

### SCN-004: Output guard spills to disk

```gherkin
Given a CallMcpTool result with 200 KiB of text
When the output guard is enabled (default)
Then the result content is truncated to a head preview
And the full text is written to a temp file
And the result content includes the temp file path
And the result details include { outputGuard: { truncated: true, fullOutputPath: <path> } }
```
