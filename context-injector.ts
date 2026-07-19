// context-injector.ts - Inject a compact registry index into the session context.
//
// Implements REQ-C-001..006 of openspec/specs/context-injection/spec.md.
// The injector runs on `session_start` (after the registry loader) and
// appends a Markdown block to the system context. The block lists every
// server and tool, but NOT the full schemas — the model is told to read
// `registry/<server>/tools/<tool>.json` on demand via Pi's native `read`
// tool when it needs the full input schema before calling CallMcpTool.
//
// Token budget: default 4000 tokens, estimated as charCount / 4. When
// the registry exceeds the budget, the injector walks a truncation
// ladder (full descriptions → 40-char descriptions → tool keys only →
// server names + counts only) and appends a "> (truncated — ...)" note.

import type { Registry } from "./registry/registry-types.ts";
import type { BridgeSettings } from "./types.ts";

const HEADER = "## MCP servers (via pi-mcp-bridge)";
const FOOTER =
  "Use Pi's read/grep/ls tools on `registry/<server>/tools/<tool>.json` to see the full input schema before calling CallMcpTool.";

const DEFAULT_BUDGET_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;
const SHORT_DESCRIPTION_CHARS = 40;
const TINY_DESCRIPTION_CHARS = 80;

export interface InjectionResult {
  /** The Markdown block to append to the system context. */
  block: string;
  /** Whether the block was truncated to fit the budget. */
  truncated: boolean;
  /** Estimated token count of the final block. */
  estimatedTokens: number;
}

/** Build the compact registry index block. */
export function buildContextBlock(
  registry: Registry,
  settings: Pick<BridgeSettings, "contextBudgetTokens"> = {},
): InjectionResult {
  const budget = settings.contextBudgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const maxChars = budget * CHARS_PER_TOKEN;

  if (registry.servers.size === 0) {
    const block = [
      HEADER,
      "0 servers configured. Run `pi-mcp-bridge add <server-name>` or hand-edit",
      "`registry/<server>/meta.json` to add an MCP server.",
    ].join("\n");
    return { block, truncated: false, estimatedTokens: estimateTokens(block) };
  }

  // Try each truncation level in turn until the budget fits.
  const levels: Array<(reg: Registry) => string> = [
    reg => renderFull(reg, TINY_DESCRIPTION_CHARS),
    reg => renderFull(reg, SHORT_DESCRIPTION_CHARS),
    reg => renderKeysOnly(reg),
    reg => renderCountsOnly(reg),
  ];

  for (const render of levels) {
    const block = render(registry);
    if (estimateTokens(block) <= maxChars) {
      return { block, truncated: false, estimatedTokens: estimateTokens(block) };
    }
  }

  // Even the most compact form exceeds the budget. Emit it with a truncation note.
  const compact = renderCountsOnly(registry);
  const note = "> (truncated — read `registry/<server>/tools/` for the full list)";
  const block = `${compact}\n${note}`;
  return { block, truncated: true, estimatedTokens: estimateTokens(block) };
}

function renderFull(registry: Registry, maxDescChars: number): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — use CallMcpTool / FetchMcpResource to invoke; read registry/<server>/tools/<tool>.json for full schemas.`;

  const lines: string[] = [HEADER, summary];

  for (const server of registry.servers.values()) {
    const title = server.meta.description
      ? `### ${server.name} — ${truncate(server.meta.description, maxDescChars)}`
      : `### ${server.name}`;
    lines.push(title);

    if (server.tools.size > 0) {
      for (const [key, def] of server.tools) {
        const desc = def.description ? truncate(def.description, maxDescChars) : "";
        lines.push(desc ? `- ${key}: ${desc}` : `- ${key}`);
      }
    } else {
      lines.push("- (no tools registered)");
    }
  }

  lines.push(FOOTER);
  return lines.join("\n");
}

function renderKeysOnly(registry: Registry): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — use CallMcpTool / FetchMcpResource to invoke; read registry/<server>/tools/<tool>.json for full schemas.`;

  const lines: string[] = [HEADER, summary];

  for (const server of registry.servers.values()) {
    lines.push(`### ${server.name}`);
    if (server.tools.size > 0) {
      lines.push(...[...server.tools.keys()].map(key => `- ${key}`));
    } else {
      lines.push("- (no tools registered)");
    }
  }

  lines.push(FOOTER);
  return lines.join("\n");
}

function renderCountsOnly(registry: Registry): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — use CallMcpTool / FetchMcpResource to invoke; read registry/<server>/tools/<tool>.json for full schemas.`;

  const lines: string[] = [HEADER, summary];

  for (const server of registry.servers.values()) {
    lines.push(`- ${server.name} (${server.tools.size} tools)`);
  }

  lines.push(FOOTER);
  return lines.join("\n");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Identifier used to find and replace a previously injected block. */
export const INJECTION_HEADER = HEADER;
