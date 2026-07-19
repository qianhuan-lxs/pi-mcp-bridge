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
/** Stable end marker so reload/sync can replace a previously injected block. */
const FOOTER_MARKER = "<!-- /pi-mcp-bridge -->";
// Used when full inputSchemas are inlined below each tool. Tells the model
// to call directly and NOT waste a round-trip reading schema files.
const INSTRUCTION_INLINE =
  "Full input schemas are inlined below each tool. Call CallMcpTool / FetchMcpResource directly with the arguments shown — do NOT read schema files first.";
// Used when schemas are NOT inlined (registry over the tool-count limit, or
// the block was truncated). Tells the model to read the descriptor file with
// an ABSOLUTE path and explicitly warns against relative paths (which resolve
// against the agent cwd and miss the real registry location).
const INSTRUCTION_READ_FILES =
  "Before calling CallMcpTool, read the tool's descriptor file to confirm its parameters. Each server's descriptor folder (absolute path) is shown under its name above — use `read <folder>/tools/<toolName>.json`. Do NOT use relative paths like `registry/<server>/...`; they resolve against the agent cwd and will miss the registry.";
const FOOTER_WITH_SCHEMAS =
  "Full input schemas are included above. Call CallMcpTool / FetchMcpResource directly with the arguments shown.";
const FOOTER_READ_FILES = (root: string) =>
  `Use Pi's read/grep/ls tools on \`${root}/<server>/tools/<tool>.json\` to see the full input schema before calling CallMcpTool. Each server's descriptor folder is listed next to its name above.`;

const DEFAULT_BUDGET_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;
const SHORT_DESCRIPTION_CHARS = 40;
const TINY_DESCRIPTION_CHARS = 80;
/** Default tool-count limit for inline schema injection. Registries with
 * more tools fall back to descriptions-only. */
const DEFAULT_SCHEMA_INJECTION_TOOL_LIMIT = 10;

export interface InjectionResult {
  /** The Markdown block to prepend to the messages. */
  block: string;
  /** Whether the block was truncated to fit the budget (even counts-only exceeded it). */
  truncated: boolean;
  /** Whether full per-tool inputSchemas were included (level 1 was used). */
  schemasIncluded: boolean;
  /** Estimated token count of the final block. */
  estimatedTokens: number;
  /**
   * Estimated tokens if we always inlined every tool's full inputSchema
   * (ignoring schemaInjectionToolLimit / budget). Used to report savings.
   */
  fullSchemaTokens: number;
  /** `max(0, fullSchemaTokens - estimatedTokens)` — what truncation/limit saved. */
  tokensSaved: number;
}

/** Build the compact registry index block. */
export function buildContextBlock(
  registry: Registry,
  settings: Pick<BridgeSettings, "contextBudgetTokens" | "schemaInjectionToolLimit"> = {},
): InjectionResult {
  const budget = settings.contextBudgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const maxChars = budget * CHARS_PER_TOKEN;
  const root = registry.root;
  const schemaLimit = settings.schemaInjectionToolLimit ?? DEFAULT_SCHEMA_INJECTION_TOOL_LIMIT;
  const totalToolCount = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  // Hard rule: if the registry has more tools than the limit, skip the
  // full-schema level entirely. This makes behavior predictable (no
  // "it fit last turn but not this turn" surprises when tools are added)
  // and avoids building a large block only to discard it.
  const allowSchemas = schemaLimit > 0 && totalToolCount <= schemaLimit;

  if (registry.servers.size === 0) {
    const block = withInjectionFooter(
      [
        HEADER,
        "0 servers configured. Run `/mcp-bridge add <server-name> -- <command>` or hand-edit",
        `\`${root}/<server>/meta.json\` to add an MCP server.`,
      ].join("\n"),
    );
    const estimatedTokens = estimateTokens(block);
    return {
      block,
      truncated: false,
      schemasIncluded: false,
      estimatedTokens,
      fullSchemaTokens: estimatedTokens,
      tokensSaved: 0,
    };
  }

  // Baseline: always measure the full-schema block so we can report how much
  // the tool-count limit + truncation ladder saved vs inlining everything.
  const fullSchemaTokens = estimateTokens(withInjectionFooter(renderWithSchemas(registry)));

  const withSavings = (
    block: string,
    truncated: boolean,
    schemasIncluded: boolean,
  ): InjectionResult => {
    const estimatedTokens = estimateTokens(block);
    return {
      block,
      truncated,
      schemasIncluded,
      estimatedTokens,
      fullSchemaTokens,
      tokensSaved: Math.max(0, fullSchemaTokens - estimatedTokens),
    };
  };

  // Try each truncation level in turn until the budget fits.
  // Each level returns { block, schemasIncluded }.
  // Level 1 (renderWithSchemas) is skipped when the registry exceeds the
  // configured tool-count limit.
  const levels: Array<{ render: (reg: Registry) => string; schemasIncluded: boolean }> = [
    { render: reg => renderWithSchemas(reg), schemasIncluded: true },
    { render: reg => renderFull(reg, TINY_DESCRIPTION_CHARS, root), schemasIncluded: false },
    { render: reg => renderFull(reg, SHORT_DESCRIPTION_CHARS, root), schemasIncluded: false },
    { render: reg => renderKeysOnly(reg, root), schemasIncluded: false },
    { render: reg => renderCountsOnly(reg, root), schemasIncluded: false },
  ];

  for (const level of levels) {
    if (level.schemasIncluded && !allowSchemas) continue; // skip renderWithSchemas when over the limit
    const block = withInjectionFooter(level.render(registry));
    if (estimateTokens(block) <= maxChars) {
      return withSavings(block, false, level.schemasIncluded);
    }
  }

  // Even the most compact form exceeds the budget. Emit it with a truncation note.
  const compact = renderCountsOnly(registry, root);
  const note = `> (truncated — read \`${root}/<server>/tools/\` for the full list)`;
  const block = withInjectionFooter(`${compact}\n${note}`);
  return withSavings(block, true, false);
}

/**
 * Replace a previously injected MCP block in the system prompt, or append
 * a new one. Used by `before_agent_start` so reload/sync can refresh the
 * index instead of leaving a stale header forever.
 */
export function replaceOrAppendMcpBlock(systemPrompt: string, block: string): string {
  const finalized = withInjectionFooter(block.trimEnd());
  const start = systemPrompt.indexOf(HEADER);
  if (start === -1) {
    if (systemPrompt.length === 0) return finalized;
    const separator = systemPrompt.endsWith("\n") ? "\n" : "\n\n";
    return `${systemPrompt}${separator}${finalized}`;
  }

  const fromHeader = systemPrompt.slice(start);
  const footerInSlice = fromHeader.indexOf(FOOTER_MARKER);
  let end: number;
  if (footerInSlice !== -1) {
    end = start + footerInSlice + FOOTER_MARKER.length;
    while (end < systemPrompt.length && (systemPrompt[end] === "\n" || systemPrompt[end] === "\r")) {
      end++;
    }
  } else {
    // Legacy injections without a footer marker: replace through end of prompt.
    end = systemPrompt.length;
  }

  const before = systemPrompt.slice(0, start).replace(/[\r\n]+$/, "");
  const after = systemPrompt.slice(end).replace(/^[\r\n]+/, "");
  if (!before) return after ? `${finalized}\n\n${after}` : finalized;
  if (!after) return `${before}\n\n${finalized}`;
  return `${before}\n\n${finalized}\n\n${after}`;
}

function withInjectionFooter(block: string): string {
  const trimmed = block.trimEnd();
  if (trimmed.includes(FOOTER_MARKER)) return trimmed;
  return `${trimmed}\n${FOOTER_MARKER}`;
}

/** Render every tool with its full inputSchema as compact JSON. */
function renderWithSchemas(registry: Registry): string {
  const totalTools = [...registry.servers.values()].reduce((sum, s) => sum + s.tools.size, 0);
  const summary = `${registry.servers.size} servers, ${totalTools} tools — full input schemas included; call CallMcpTool / FetchMcpResource directly.`;

  const lines: string[] = [HEADER, summary, INSTRUCTION_INLINE];

  for (const server of registry.servers.values()) {
    lines.push(renderServerHeader(server, TINY_DESCRIPTION_CHARS));
    appendInstructions(lines, server);

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

  const lines: string[] = [HEADER, summary, INSTRUCTION_READ_FILES];

  for (const server of registry.servers.values()) {
    lines.push(renderServerHeader(server, maxDescChars));
    appendInstructions(lines, server);

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

  const lines: string[] = [HEADER, summary, INSTRUCTION_READ_FILES];

  for (const server of registry.servers.values()) {
    lines.push(renderServerHeader(server, TINY_DESCRIPTION_CHARS));
    appendInstructions(lines, server);
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

/** Render the `### <name> — <description>` header for a server, with the
 * absolute descriptor folder path (Cursor-style) so the model knows where
 * to `ls`/`read` for tool schemas. */
function renderServerHeader(
  server: { name: string; meta: { description?: string }; directory: string },
  maxDescChars: number,
): string {
  const desc = server.meta.description
    ? ` — ${truncate(server.meta.description, maxDescChars)}`
    : "";
  return `### ${server.name}${desc}\nfolder: \`${server.directory}\``;
}

/**
 * Append the server's MCP `instructions` (captured at sync time) as a
 * blockquote under the server header. Truncated to a generous length
 * (320 chars) so the model gets the server's purpose without blowing
 * the budget; the full text is in `meta.json` if needed.
 */
function appendInstructions(
  lines: string[],
  server: { meta: { instructions?: string } },
): void {
  const raw = server.meta.instructions?.trim();
  if (!raw) return;
  const INSTRUCTIONS_BUDGET = 320;
  const text = truncate(raw, INSTRUCTIONS_BUDGET);
  // Render as a markdown blockquote, one line per source line.
  for (const line of text.split("\n")) {
    lines.push(`> ${line}`);
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
/** End marker paired with {@link INJECTION_HEADER}. */
export const INJECTION_FOOTER = FOOTER_MARKER;
