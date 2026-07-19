// tool-result-renderer.ts - Pi render hooks for tool calls/results.
//
// Ported from pi-mcp-adapter with the proxy-tool renderer removed (the
// bridge has no proxy tool). The direct-tool renderer is kept because
// the wrapper tools (`CallMcpTool`, `FetchMcpResource`) use it to
// render their calls compactly in the Pi TUI.

import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type McpToolResultDetails = Record<string, unknown> & { error?: unknown };
type McpToolContentBlock = AgentToolResult<McpToolResultDetails>["content"][number];

interface RenderTheme {
  fg: (name: string, text: string) => string;
  bold?: (text: string) => string;
}

export interface WrapperToolCallInput {
  /** For CallMcpTool: `${toolName} @ ${server}`. For FetchMcpResource: `${uri} @ ${server}`. */
  displayTitle: string;
  /** Optional JSON-pretty-printed argument blob. */
  argsJson?: string;
}

interface McpToolRenderContext {
  isError: boolean;
}

export interface McpToolResultDisplay {
  lines: string[];
  truncated: boolean;
}

const DEFAULT_MAX_CALL_INPUT_CHARS = 1500;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatJsonish(value: unknown, maxChars: number): string {
  if (typeof value === "string") {
    try {
      return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
    } catch {
      return truncateText(value, maxChars);
    }
  }
  try {
    return truncateText(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

function hasUsefulObjectContent(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

/** Format the call lines for a wrapper tool (`CallMcpTool` / `FetchMcpResource`). */
export function formatWrapperToolCallLines(
  args: WrapperToolCallInput,
  maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS,
): string[] {
  if (!args.argsJson || !hasUsefulObjectContent(safeParse(args.argsJson))) {
    return [args.displayTitle];
  }
  return [args.displayTitle, formatJsonish(args.argsJson, maxInputChars)];
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function renderToolCallLines(lines: string[], theme: RenderTheme) {
  const [title = "mcp-bridge", ...rest] = lines;
  const styledTitle = theme.fg("toolTitle", theme.bold ? theme.bold(title) : title);
  const styledRest = rest.map(line => theme.fg("muted", line));
  return new Text([styledTitle, ...styledRest].join("\n"), 0, 0);
}

/** Render hook for a wrapper tool's call. */
export function renderWrapperToolCall(args: WrapperToolCallInput, theme: RenderTheme) {
  return renderToolCallLines(formatWrapperToolCallLines(args), theme);
}

function blockToLines(block: McpToolContentBlock): string[] {
  if (block.type === "text") {
    return block.text.split("\n");
  }
  return [`[image: ${block.mimeType}]`];
}

export function formatMcpToolResultLines(
  result: Pick<AgentToolResult<McpToolResultDetails>, "content">,
  expanded: boolean,
  maxCollapsedLines = 3,
): McpToolResultDisplay {
  const allLines = result.content.flatMap(blockToLines);
  const lines = allLines.length > 0 ? allLines : ["(empty result)"];

  if (expanded || lines.length <= maxCollapsedLines) {
    return { lines, truncated: false };
  }

  return {
    lines: [...lines.slice(0, maxCollapsedLines), "…"],
    truncated: true,
  };
}

export function renderMcpToolResult(
  result: AgentToolResult<McpToolResultDetails>,
  options: ToolRenderResultOptions,
  theme: RenderTheme,
  context?: McpToolRenderContext,
) {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "Running MCP tool..."), 0, 0);
  }

  const hasErrorDetails = Boolean(result.details.error);
  const display = formatMcpToolResultLines(
    result,
    options.expanded || context?.isError === true || hasErrorDetails,
  );
  const output = display.lines
    .map(line =>
      line === "…" ? theme.fg("muted", line) : theme.fg("toolOutput", line),
    )
    .join("\n");
  const hint =
    display.truncated && !options.expanded
      ? `\n${theme.fg("muted", "(Ctrl+O to expand)")}`
      : "";

  return new Text(`${output}${hint}`, 0, 0);
}
