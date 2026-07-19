// index.ts - Pi extension entry point.
//
// Registers exactly two LLM-callable tools (CallMcpTool, FetchMcpResource)
// and hooks session_start (load registry, inject context, init server
// manager + lifecycle) and session_shutdown (flush + close).
//
// Implements REQ-001..008 of openspec/specs/mcp-bridge/spec.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { McpBridgeState } from "./state.ts";
import { loadBridgeSettings } from "./config.ts";
import { loadRegistry } from "./registry/registry-loader.ts";
import { buildContextBlock, INJECTION_HEADER } from "./context-injector.ts";
import { executeCallMcpTool } from "./call-mcp-tool.ts";
import { executeFetchMcpResource } from "./fetch-mcp-resource.ts";
import { McpServerManager } from "./server-manager.ts";
import { McpLifecycleManager } from "./lifecycle.ts";
import { ConsentManager } from "./consent-manager.ts";
import { UiResourceHandler } from "./ui-resource-handler.ts";
import { startUiServer, type UiServerHandle } from "./ui-server.ts";
import { toolErrorOverride } from "./error-signal.ts";
import { logger } from "./logger.ts";

export default function mcpBridge(pi: ExtensionAPI) {
  let state: McpBridgeState | null = null;
  let initPromise: Promise<McpBridgeState> | null = null;
  let lifecycleGeneration = 0;
  let injectedBlock: string | null = null;

  async function shutdownState(current: McpBridgeState | null, reason: string): Promise<void> {
    if (!current) return;
    if (current.uiServer) {
      current.uiServer.close(reason);
    }
    try {
      await current.lifecycle.gracefulShutdown();
    } catch (error) {
      logger.error(`graceful shutdown failed (${reason})`, error instanceof Error ? error : undefined);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    state = null;
    initPromise = null;

    try {
      await shutdownState(previousState, "session_restart");
    } catch (error) {
      logger.error("failed to shut down previous session state", error instanceof Error ? error : undefined);
    }

    if (generation !== lifecycleGeneration) return;

    // Load settings + registry (read-only, never throws).
    const settings = loadBridgeSettings();
    const registry = loadRegistry();

    // Build the in-memory tool metadata map from the registry.
    const toolMetadata = new Map<string, import("./types.ts").ToolMetadata[]>();
    for (const server of registry.servers.values()) {
      const metadata: import("./types.ts").ToolMetadata[] = [];
      for (const [key, def] of server.tools) {
        metadata.push({
          name: def.name,
          originalName: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          uiResourceUri: def.ui?.resourceUri ?? undefined,
          uiStreamMode: def.ui?.streamMode ?? undefined,
        });
      }
      toolMetadata.set(server.name, metadata);
    }

    // Wire up the server manager + lifecycle.
    const manager = new McpServerManager(process.cwd());
    manager.setDefaultRequestTimeoutMs(settings.requestTimeoutMs || undefined);
    const lifecycle = new McpLifecycleManager(manager);
    lifecycle.setGlobalIdleTimeout(settings.idleTimeout ?? 10);
    lifecycle.startHealthChecks();

    // Wire up the UI integration (MCP UI / Glimpse).
    const consentManager = new ConsentManager("once-per-server");
    const uiResourceHandler = new UiResourceHandler(manager);
    let uiServer: UiServerHandle | null = null;
    try {
      uiServer = startUiServer({ manager, consentManager });
    } catch (error) {
      logger.warn(
        `UI server did not start (UI integration disabled): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const nextState: McpBridgeState = {
      manager,
      lifecycle,
      toolMetadata,
      registry,
      settings,
      failureTracker: new Map(),
      uiResourceHandler,
      consentManager,
      uiServer,
      completedUiSessions: [],
      openBrowser: async (url: string) => {
        const open = (await import("open")).default;
        await open(url);
      },
      ui: ctx.ui,
    };

    state = nextState;
    initPromise = Promise.resolve(nextState);

    // Inject the compact registry index into the session context.
    try {
      const result = buildContextBlock(registry, settings);
      if (ctx.injectSystemContext) {
        ctx.injectSystemContext(result.block);
        injectedBlock = result.block;
      }
      if (result.truncated) {
        logger.warn("context injection was truncated to fit the budget");
      }
      logger.info(
        `session_start: ${registry.servers.size} servers, ${[...registry.servers.values()].reduce((n, s) => n + s.tools.size, 0)} tools`,
      );
    } catch (error) {
      logger.error("context injection failed", error instanceof Error ? error : undefined);
    }
  });

  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const current = state;
    state = null;
    initPromise = null;
    injectedBlock = null;
    try {
      await shutdownState(current, "session_shutdown");
    } catch (error) {
      logger.error("session shutdown cleanup failed", error instanceof Error ? error : undefined);
    }
  });

  // Re-flag returned MCP tool failures so Pi registers them as errors.
  pi.on("tool_result", event => toolErrorOverride(event.details));

  // --- Register CallMcpTool (REQ-W-001..008) -----------------------------
  (pi.registerTool as (tool: unknown) => unknown)({
    name: "CallMcpTool",
    label: "MCP: Call tool",
    description:
      "Call an MCP tool by server identifier and tool name with arbitrary JSON arguments. " +
      "IMPORTANT: Always read the tool's schema (registry/<server>/tools/<toolName>.json) " +
      "BEFORE calling to ensure correct parameters. The `arguments` object must match the " +
      "tool's inputSchema.",
    promptSnippet: "Call any MCP tool by server + toolName + arguments",
    parameters: Type.Object({
      server: Type.String({ description: "Identifier of the MCP server hosting the tool." }),
      toolName: Type.String({ description: "Name of the MCP tool to invoke (registry key, slug, or original MCP name)." }),
      arguments: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description: "Arguments to pass to the MCP tool, as described in the tool descriptor.",
        }),
      ),
    }),
    async execute(_toolCallId, params: { server: string; toolName: string; arguments?: Record<string, unknown> }, signal) {
      if (!state) {
        return {
          content: [{ type: "text" as const, text: "pi-mcp-bridge not initialized." }],
          details: { mode: "call", error: "not_initialized" },
        };
      }
      return executeCallMcpTool(state, params, signal);
    },
  });

  // --- Register FetchMcpResource (REQ-W-009..014) -----------------------
  (pi.registerTool as (tool: unknown) => unknown)({
    name: "FetchMcpResource",
    label: "MCP: Fetch resource",
    description:
      "Read a specific resource from an MCP server, identified by server name and resource URI. " +
      "Optionally set downloadPath (relative to the workspace) to save the resource to disk; " +
      "when set, the resource is written to disk and is NOT returned to the model.",
    promptSnippet: "Read any MCP resource by server + uri (+ optional downloadPath)",
    parameters: Type.Object({
      server: Type.String({ description: "The MCP server identifier" }),
      uri: Type.String({ description: "The resource URI to read" }),
      downloadPath: Type.Optional(
        Type.String({
          description:
            "Optional relative path in the workspace to save the resource to. When set, the resource is written to disk and is not returned to the model.",
        }),
      ),
    }),
    async execute(
      _toolCallId,
      params: { server: string; uri: string; downloadPath?: string },
      signal,
    ) {
      if (!state) {
        return {
          content: [{ type: "text" as const, text: "pi-mcp-bridge not initialized." }],
          details: { mode: "fetch", error: "not_initialized" },
        };
      }
      return executeFetchMcpResource(state, params, signal);
    },
  });

  // --- /mcp-bridge reload command (REQ-C-005) ---------------------------
  pi.registerCommand("mcp-bridge", {
    description: "Manage the pi-mcp-bridge registry",
    handler: async (args, ctx) => {
      const parts = (args?.trim()?.split(/\s+/) ?? []) as string[];
      const subcommand = parts[0] ?? "";

      switch (subcommand) {
        case "reload": {
          if (!state) {
            if (ctx.hasUI) ctx.ui.notify("pi-mcp-bridge not initialized", "error");
            return;
          }
          const previousCount = state.registry.servers.size;
          const registry = loadRegistry();
          state.registry = registry;
          const newCount = registry.servers.size;
          const result = buildContextBlock(registry, state.settings);
          if (ctx.injectSystemContext) {
            ctx.injectSystemContext(result.block);
            injectedBlock = result.block;
          }
          if (ctx.hasUI) {
            const total = [...registry.servers.values()].reduce((n, s) => n + s.tools.size, 0);
            ctx.ui.notify(
              `MCP registry reloaded: ${newCount} servers, ${total} tools${newCount !== previousCount ? ` (was ${previousCount})` : ""}`,
              "info",
            );
          }
          return;
        }
        case "status":
        case "":
        default: {
          if (!state) {
            if (ctx.hasUI) ctx.ui.notify("pi-mcp-bridge not initialized", "error");
            return;
          }
          const total = [...state.registry.servers.values()].reduce((n, s) => n + s.tools.size, 0);
          if (ctx.hasUI) {
            ctx.ui.notify(
              `pi-mcp-bridge: ${state.registry.servers.size} servers, ${total} tools`,
              "info",
            );
          } else {
            console.log(`pi-mcp-bridge: ${state.registry.servers.size} servers, ${total} tools`);
          }
          return;
        }
      }
    },
  });

  // Suppress unused-variable warnings for the injected-block tracker.
  void INJECTION_HEADER;
  void injectedBlock;
}
