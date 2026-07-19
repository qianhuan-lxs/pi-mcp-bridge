import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConsentManager } from "./consent-manager.ts";
import type { McpLifecycleManager } from "./lifecycle.ts";
import type { McpServerManager } from "./server-manager.ts";
import type { ToolMetadata, BridgeSettings, UiSessionMessages, UiStreamSummary } from "./types.ts";
import type { UiResourceHandler } from "./ui-resource-handler.ts";
import type { UiServerHandle } from "./ui-server.ts";
import type { Registry } from "./registry/registry-types.ts";

export interface CompletedUiSession {
  serverName: string;
  toolName: string;
  completedAt: Date;
  reason: string;
  messages: UiSessionMessages;
  stream?: UiStreamSummary;
}

/** Snapshot of how much system-prompt space the MCP index occupies. */
export interface ContextInjectionStats {
  /** Estimated tokens of the injected Markdown block (chars/4). */
  estimatedTokens: number;
  /** Configured `contextBudgetTokens` (default 4000). */
  budgetTokens: number;
  /** `round(estimated / budget * 100)`. */
  percentOfBudget: number;
  /** Tokens if every tool's full inputSchema were inlined (baseline). */
  fullSchemaTokens: number;
  /** Tokens avoided vs full-schema baseline (`fullSchemaTokens - estimated`). */
  tokensSaved: number;
  /** `round(tokensSaved / fullSchemaTokens * 100)` when baseline > 0. */
  percentSaved: number;
  /** Whether full inputSchemas were inlined. */
  schemasIncluded: boolean;
  /** Whether even the compact form exceeded the budget. */
  truncated: boolean;
  /** Raw character length of the block. */
  charCount: number;
}

export type SendMessageFn = (
  message: {
    customType: string;
    content: Array<{ type: "text"; text: string }>;
    display?: string;
    details?: unknown;
  },
  options?: { triggerTurn?: boolean },
) => void;

/**
 * In-memory state for one Pi session.
 *
 * Created on `session_start`, torn down on `session_shutdown`. The
 * `Registry` is the on-disk source of truth; the in-memory `toolMetadata`
 * map is a denormalized view used for fast lookups during `CallMcpTool`.
 */
export interface McpBridgeState {
  /** Live MCP client connections (lazy, idle-disconnect). */
  manager: McpServerManager;
  /** Idle sweep + keep-alive health checks. */
  lifecycle: McpLifecycleManager;
  /** Per-server tool metadata, keyed by server name. */
  toolMetadata: Map<string, ToolMetadata[]>;
  /** Loaded filesystem registry (in-memory mirror of `registry/`). */
  registry: Registry;
  /**
   * Bumped whenever the in-memory registry is replaced after reconcile/sync/reload.
   * `before_agent_start` uses this to decide whether to replace the injected MCP block.
   */
  registryGeneration: number;
  /**
   * Latest MCP system-prompt injection size estimate (vs contextBudgetTokens).
   * Refreshed with the status bar / before_agent_start.
   */
  contextStats: ContextInjectionStats | null;
  /** Bridge-wide settings (from `~/.pi/agent/mcp-bridge.json` if present). */
  settings: BridgeSettings;
  /** Failure backoff tracker: server name → last failure timestamp. */
  failureTracker: Map<string, number>;
  /** UI resource fetcher (for tools that ship interactive UIs). */
  uiResourceHandler: UiResourceHandler;
  /** Per-server tool consent gate. */
  consentManager: ConsentManager;
  /** Local HTTP server hosting MCP UI iframes. */
  uiServer: UiServerHandle | null;
  /** UI sessions that completed and have queued messages for the model. */
  completedUiSessions: CompletedUiSession[];
  /** Opens a URL in the user's preferred browser (or OS default). */
  openBrowser: (url: string) => Promise<void>;
  /** Pi UI handle (only set in interactive sessions). */
  ui?: ExtensionContext["ui"];
  /** AppBridge → agent message channel (only set when a UI session is open). */
  sendMessage?: SendMessageFn;
}
