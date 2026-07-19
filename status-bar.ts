// status-bar.ts - Footer status indicator + themed command output for /mcp-bridge.
//
// Uses ctx.ui.setStatus(key, text) — the Pi footer API that lets multiple
// extensions each register their own keyed status line. We key ours
// "mcp-bridge" and refresh it on session_start, sync, and reload.

import { buildContextBlock } from "./context-injector.ts";
import type { ContextInjectionStats, McpBridgeState } from "./state.ts";
import type { ListEntry } from "./registry-commands.ts";

export const STATUS_KEY = "mcp-bridge";

/** A minimal theme shape (subset of Pi's Theme) used for styled output. */
interface ThemeLike {
  fg: (name: string, text: string) => string;
  bold?: (text: string) => string;
}

/** Total tool count across all servers in the registry. */
export function totalToolCount(state: McpBridgeState): number {
  let total = 0;
  for (const server of state.registry.servers.values()) total += server.tools.size;
  return total;
}

/**
 * Recompute MCP injection size from the current registry and stash it on state.
 * Safe to call often — buildContextBlock is pure and cheap for typical registries.
 */
export function updateContextStats(state: McpBridgeState): ContextInjectionStats {
  const result = buildContextBlock(state.registry, state.settings);
  const budgetTokens = state.settings.contextBudgetTokens ?? 4000;
  const stats: ContextInjectionStats = {
    estimatedTokens: result.estimatedTokens,
    budgetTokens,
    percentOfBudget:
      budgetTokens > 0 ? Math.round((result.estimatedTokens / budgetTokens) * 100) : 0,
    schemasIncluded: result.schemasIncluded,
    truncated: result.truncated,
    charCount: result.block.length,
  };
  state.contextStats = stats;
  return stats;
}

/** Compact token count for the footer (`850`, `1.2k`, `12k`). */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const k = tokens / 1000;
  const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
  return `${rounded}k`;
}

/** Build the footer status string including context occupancy. */
export function formatStatusLine(state: McpBridgeState, theme: ThemeLike): string {
  const servers = state.registry.servers.size;
  const tools = totalToolCount(state);
  const base = `MCP: ${servers} server${servers === 1 ? "" : "s"}, ${tools} tool${tools === 1 ? "" : "s"}`;
  const stats = state.contextStats;
  if (!stats) return theme.fg("dim", base);

  const used = formatTokenCount(stats.estimatedTokens);
  const budget = formatTokenCount(stats.budgetTokens);
  const pct = `${stats.percentOfBudget}%`;
  const mode = stats.truncated ? "trunc" : stats.schemasIncluded ? "schemas" : "names";
  return theme.fg("dim", `${base} · ~${used}/${budget} tok (${pct}, ${mode})`);
}

/** Refresh the footer status from the current registry. No-op without a UI. */
export function refreshStatusBar(state: McpBridgeState): void {
  try {
    updateContextStats(state);
  } catch {
    // keep previous stats if rebuild fails
  }
  if (!state.ui?.setStatus) return;
  state.ui.setStatus(STATUS_KEY, formatStatusLine(state, state.ui.theme as ThemeLike));
}

/** Clear the footer status. No-op without a UI. */
export function clearStatusBar(state: McpBridgeState | null): void {
  if (!state?.ui?.setStatus) return;
  state.ui.setStatus(STATUS_KEY, undefined);
}

/** Render the `/mcp-bridge list` output as a themed, aligned table. */
export function renderListTable(entries: ListEntry[], theme: ThemeLike): string {
  if (entries.length === 0) {
    return theme.fg("dim", "(no servers in registry). Run `/mcp-bridge add <server> -- <command>` to add one.");
  }

  // Compute column widths.
  const nameW = Math.max(4, ...entries.map(e => e.name.length));
  const transW = 7; // "stdio" / "http"
  const countW = Math.max(5, ...entries.map(e => String(e.toolCount).length));
  const syncW = 6; // "manual" / "live"

  const header =
    theme.fg("dim", pad("server", nameW)) +
    "  " + theme.fg("dim", pad("trans", transW)) +
    "  " + theme.fg("dim", pad("tools", countW)) +
    "  " + theme.fg("dim", pad("synced", syncW)) +
    "  " + theme.fg("dim", "description");
  const sep = theme.fg("dim", "─".repeat(nameW + transW + countW + syncW + 8 + 11));

  const lines = [header, sep];
  for (const e of entries) {
    const name = theme.fg("accent", bold(theme, e.name));
    const trans = theme.fg("muted", pad(e.transportKind, transW));
    const count = theme.fg("success", pad(String(e.toolCount), countW));
    const sync = theme.fg(
      e.syncedFrom === "live-server" ? "success" : "warning",
      pad(e.syncedFrom ?? "manual", syncW),
    );
    const desc = e.description ? theme.fg("muted", ` — ${e.description}`) : "";
    lines.push(`${name}  ${trans}  ${count}  ${sync}${desc}`);
  }

  // Tool list under each server (indented).
  for (const e of entries) {
    for (const t of e.tools) {
      lines.push(theme.fg("dim", `  ${pad(e.name, nameW)}  ${t}`));
    }
  }

  return lines.join("\n");
}

/** Render the `/mcp-bridge status` output as a themed summary + context occupancy. */
export function renderStatusLine(state: McpBridgeState, theme: ThemeLike): string {
  const servers = state.registry.servers.size;
  const tools = totalToolCount(state);
  const serverPart = theme.fg("accent", bold(theme, String(servers)));
  const toolPart = theme.fg("accent", bold(theme, String(tools)));
  const lines = [
    theme.fg("dim", "pi-mcp-bridge: ") +
      serverPart +
      theme.fg("dim", " servers, ") +
      toolPart +
      theme.fg("dim", " tools"),
  ];

  const stats = state.contextStats ?? (() => {
    try {
      return updateContextStats(state);
    } catch {
      return null;
    }
  })();

  if (stats) {
    const used = theme.fg("accent", bold(theme, String(stats.estimatedTokens)));
    const budget = theme.fg("dim", String(stats.budgetTokens));
    const pctColor =
      stats.percentOfBudget >= 90 ? "error" : stats.percentOfBudget >= 70 ? "warning" : "success";
    const pct = theme.fg(pctColor, bold(theme, `${stats.percentOfBudget}%`));
    const mode = stats.truncated
      ? theme.fg("warning", "truncated")
      : stats.schemasIncluded
        ? theme.fg("success", "full schemas inlined")
        : theme.fg("muted", "names+descriptions (read schema files)");
    lines.push(
      theme.fg("dim", "MCP context block: ") +
        used +
        theme.fg("dim", " / ") +
        budget +
        theme.fg("dim", " tokens (") +
        pct +
        theme.fg("dim", " of budget) — ") +
        mode,
    );
    lines.push(
      theme.fg("dim", `  ${stats.charCount} chars · registry generation ${state.registryGeneration}`),
    );
  }

  return lines.join("\n");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function bold(theme: ThemeLike, text: string): string {
  return theme.bold ? theme.bold(text) : text;
}
