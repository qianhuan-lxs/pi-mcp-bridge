// context-injector.ts - Inject a compact registry index into the session context.
//
// Implements REQ-C-001..006 of openspec/specs/context-injection/spec.md.
// The injector runs on the `context` event (fired before every provider
// request) and prepends a Markdown block to the message array. The block
// lists every server and tool.
//
// Truncation ladder (most detail first; first level that fits the token
// budget wins):
//   1. renderWithSchemas  — full inputSchema JSON per tool. The model can
//                           call CallMcpTool directly with no extra round-trip.
//   2. renderFull(80)     — tool names + descriptions (80 chars). Model must
//                           read the schema file before calling.
//   3. renderFull(40)     — same, 40-char descriptions.
//   4. renderKeysOnly     — tool keys only.
//   5. renderCountsOnly   — server names + tool counts.
//
// Token budget: default 4000 tokens, estimated as charCount / 4. When even
// the most compact form exceeds the budget, append a truncation note.
//
// Schema file paths in the footer are ABSOLUTE (registry.root), so the
// model's read/grep/ls tools can actually find them — a relative path would
// resolve against the agent's cwd and miss the real registry location.

import type { Registry } from "./registry/registry-types.ts";
import type { BridgeSettings } from "./types.ts";

const HEADER = "## MCP servers (via pi-mcp-bridge)";
const FOOTER_WITH_SCHEMAS =
  "Full input schemas are included above. Call CallMcpTool / FetchMcpResource directly with the arguments shown.";
const FOOTER_READ_FILES = (root: string) =>
  `Use Pi's read/grep/ls tools on \`${root}/<server>/tools/<tool>.json\` to see the full input schema before calling CallMcpTool.`;

const DEFAULT_BUDGET_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;
const SHORT_DESCRIPTION_CHARS = 40;
const TINY_DESCRIPTION_CHARS = 80;

export interface InjectionResult {
  /** The Markdown block to prepend to the messages. */
  block: string;
  /** Whether the block was truncated to fit the budget (even counts-only exceeded it). */
  truncated: boolean;
  /** Whether full per-tool inputSchemas were included (level 1 was used). */
  schemasIncluded: boolean;
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
  const root = registry.root;

  if (registry.servers.size === 0) {
    const block = [
      HEADER,
      "0 servers configured. Run `/mcp-bridge add <server-name> -- <command>` or hand-edit",
      `\`${root}/<server>/meta.json\` to add an MCP server.`,
    ].join("\n");
    return { block, truncated: false, schemasIncluded: false, estimatedTokens: estimateTokens(block) };
  }

  // Try each truncation level in turn until the budget fits.
  // Each level returns { block, schemasIncluded }.
  const levels: Array<{ render: (reg: Registry) => string; schemasIncluded: boolean }> = [
    { render: reg => renderWithSchemas(reg), schemasIncluded: true },
    { render: reg => renderFull(reg, TINY_DESCRIPTION_CHARS, root), schemasIncluded: false },
    { render: reg => renderFull(reg, SHORT_DESCRIPTION_CHARS, root), schemasIncluded: false },
    { render: reg => renderKeysOnly(reg, root), schemasIncluded: false },
    { render: reg => renderCountsOnly(reg, root), schemasIncluded: false },
  ];

  for (const level of levels) {
    const block = level.render(registry);
    if (estimateTokens(block) <= maxChars) {
      return { block, truncated: false, schemasIncluded: level.schemasIncluded, estimatedTokens: estimateTokens(block) };
    }
  }

  // Even the most compact form exceeds the budget. Emit it with a truncation note.
  const compact = renderCountsOnly(registry, root);
  const note = "> (truncated — read `${root}/<server>/tools/` for the full list)";
  const block = `${compact}\n${note}`;
  return { block, truncated: true, schemasIncluded: false, estimatedTokens: estimateTokens(block) };
}

/** Render every tool with its full inputSchema as compact JSON. */
function renderWithSchemas(registry: Registry): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — full input schemas included; call CallMcpTool / FetchMcpResource directly.`;

  const lines: string[] = [HEADER, summary];

  for (const server of registry.servers.values()) {
    const title = server.meta.description
      ? `### ${server.name} — ${truncate(server.meta.description, TINY_DESCRIPTION_CHARS)}`
      : `### ${server.name}`;
    lines.push(title);

    if (server.tools.size > 0) {
      for (const [key, def] of server.tools) {
        const desc = def.description ? truncate(def.description, TINY_DESCRIPTION_CHARS) : "";
        lines.push(desc ? `- ${key}: ${desc}` : `- ${key}`);
        const schemaJson = compactSchema(def.inputSchema);
        lines.push(`    args: ${schemaJson}`);
      }
    } else {
      lines.push("- (no tools registered)");
    }
  }

  lines.push(FOOTER_WITH_SCHEMAS);
  return lines.join("\n");
}

function renderFull(registry: Registry, maxDescChars: number, root: string): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — use CallMcpTool / FetchMcpResource to invoke; read \`${root}/<server>/tools/<tool>.json\` for full schemas.`;

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

  lines.push(FOOTER_READ_FILES(root));
  return lines.join("\n");
}

function renderKeysOnly(registry: Registry, root: string): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — use CallMcpTool / FetchMcpResource to invoke; read \`${root}/<server>/tools/<tool>.json\` for full schemas.`;

  const lines: string[] = [HEADER, summary];

  for (const server of registry.servers.values()) {
    lines.push(`### ${server.name}`);
    if (server.tools.size > 0) {
      lines.push(...[...server.tools.keys()].map(key => `- ${key}`));
    } else {
      lines.push("- (no tools registered)");
    }
  }

  lines.push(FOOTER_READ_FILES(root));
  return lines.join("\n");
}

function renderCountsOnly(registry: Registry, root: string): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — use CallMcpTool / FetchMcpResource to invoke; read \`${root}/<server>/tools/<tool>.json\` for full schemas.`;

  const lines: string[] = [HEADER, summary];

  for (const server of registry.servers.values()) {
    lines.push(`- ${server.name} (${server.tools.size} tools)`);
  }

  lines.push(FOOTER_READ_FILES(root));
  return lines.join("\n");
}

/** Compact a JSON Schema into a single-line JSON string (no whitespace). */
function compactSchema(schema: unknown): string {
  if (schema === null || schema === undefined) return "{}";
  try {
    return JSON.stringify(schema);
  } catch {
    return "{}";
  }
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
