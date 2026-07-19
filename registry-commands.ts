// registry-commands.ts - Shared registry management logic.
//
// Used by the /mcp-bridge slash command (primary path) and the optional
// cli.ts wrapper so the two stay in sync.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getRegistryRoot } from "./agent-dir.ts";
import { loadRegistry } from "./registry/registry-loader.ts";
import { syncServer, validateRegistry, rebuildIndex } from "./registry/registry-writer.ts";
import type { ServerMeta } from "./registry/registry-types.ts";

export interface SyncOptions {
  force?: boolean;
  env?: Record<string, string>;
}

export interface SyncResult {
  ok: boolean;
  serverName: string;
  toolsWritten?: number;
  toolsRemoved?: number;
  resourcesIndexed?: number;
  error?: string;
  skipped?: string;
}

/**
 * Sync a live MCP server into the registry.
 * If the server doesn't exist yet, create a meta.json stub from the
 * provided command/args/env before connecting. stdio only in Phase 1.
 */
export async function doSync(
  serverName: string,
  command: string | undefined,
  commandArgs: string[],
  options: SyncOptions = {},
): Promise<SyncResult> {
  const root = getRegistryRoot();
  const serverDir = join(root, serverName);
  const metaPath = join(serverDir, "meta.json");
  mkdirSync(join(serverDir, "tools"), { recursive: true });

  if (!existsSync(metaPath)) {
    if (!command) {
      return {
        ok: false,
        serverName,
        error: `no meta.json for "${serverName}" and no command provided. Use \`/mcp-bridge add ${serverName} -- <command>\` or \`/mcp-bridge add ${serverName} --url <url>\` first.`,
      };
    }
    const meta: ServerMeta = {
      $schema: "https://pi-mcp-bridge.dev/schemas/meta.v1.json",
      name: serverName,
      transport: { kind: "stdio", command, args: commandArgs, env: options.env },
      auth: { kind: "none" },
      lifecycle: { mode: "lazy", idleTimeoutMinutes: 10 },
      capabilities: { tools: true, resources: true },
      exposeResources: true,
      excludeTools: [],
      syncedFrom: "manual",
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  const registry = loadRegistry();
  const server = registry.servers.get(serverName);
  if (!server) {
    return { ok: false, serverName, error: `could not load meta.json for "${serverName}"` };
  }

  const meta = server.meta;

  // Build the right transport for the configured kind.
  // - stdio: spawn the command.
  // - http: probe StreamableHTTP first (modern MCP), fall back to SSE
  //   (legacy) — same logic as McpServerManager.
  let transport;
  if (meta.transport.kind === "stdio") {
    transport = new StdioClientTransport({
      command: meta.transport.command,
      args: meta.transport.args ?? [],
      env: meta.transport.env,
    });
  } else if (meta.transport.kind === "http") {
    const url = new URL(meta.transport.url);
    const headers = meta.transport.headers ?? {};
    const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;
    const streamable = new StreamableHTTPClientTransport(url, { requestInit });
    try {
      const probe = new Client({ name: "pi-mcp-bridge-sync-probe", version: "1.0.0" });
      await probe.connect(streamable);
      await probe.close().catch(() => {});
      await streamable.close().catch(() => {});
      transport = new StreamableHTTPClientTransport(url, { requestInit });
    } catch {
      await streamable.close().catch(() => {});
      transport = new SSEClientTransport(url, { requestInit });
    }
  } else {
    return { ok: false, serverName, error: `unsupported transport kind for sync` };
  }

  const client = new Client({ name: `pi-mcp-bridge-sync-${meta.name}`, version: "1.0.0" });

  try {
    await client.connect(transport);
    const result = await syncServer(serverName, client, { force: options.force });
    if (result.skipped) {
      return { ok: true, serverName, skipped: result.skipped };
    }
    return {
      ok: true,
      serverName,
      toolsWritten: result.toolsWritten,
      toolsRemoved: result.toolsRemoved,
      resourcesIndexed: result.resourcesIndexed,
    };
  } catch (error) {
    return { ok: false, serverName, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

export interface ValidateResult {
  ok: boolean;
  issues: Array<{ server: string; file: string; message: string }>;
}

export function doValidate(): ValidateResult {
  const issues = validateRegistry();
  return { ok: issues.length === 0, issues };
}

export interface AddOptions {
  command?: string;
  args?: string[];
  url?: string;
  description?: string;
  env?: Record<string, string>;
}

export interface AddResult {
  ok: boolean;
  serverName: string;
  metaPath?: string;
  error?: string;
}

export function doAdd(name: string, options: AddOptions): AddResult {
  if (!options.command && !options.url) {
    return { ok: false, serverName: name, error: "add requires a command (stdio) or url (http)" };
  }
  const root = getRegistryRoot();
  const serverDir = join(root, name);
  mkdirSync(join(serverDir, "tools"), { recursive: true });
  const metaPath = join(serverDir, "meta.json");
  if (existsSync(metaPath)) {
    return { ok: false, serverName: name, error: `meta.json already exists at ${metaPath}` };
  }

  const meta: ServerMeta = options.command
    ? {
        $schema: "https://pi-mcp-bridge.dev/schemas/meta.v1.json",
        name,
        description: options.description,
        transport: { kind: "stdio", command: options.command, args: options.args ?? [], env: options.env },
        auth: { kind: "none" },
        lifecycle: { mode: "lazy", idleTimeoutMinutes: 10 },
        capabilities: { tools: true, resources: true },
        exposeResources: true,
        excludeTools: [],
        syncedFrom: "manual",
      }
    : {
        $schema: "https://pi-mcp-bridge.dev/schemas/meta.v1.json",
        name,
        description: options.description,
        transport: { kind: "http", url: options.url! },
        auth: { kind: "none" },
        lifecycle: { mode: "lazy", idleTimeoutMinutes: 10 },
        capabilities: { tools: true, resources: true },
        exposeResources: true,
        excludeTools: [],
        syncedFrom: "manual",
      };

  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  const registry = loadRegistry();
  rebuildIndex(registry);
  return { ok: true, serverName: name, metaPath };
}

export interface ListEntry {
  name: string;
  description?: string;
  toolCount: number;
  tools: string[];
}

export function doList(): ListEntry[] {
  const registry = loadRegistry();
  const entries: ListEntry[] = [];
  for (const server of registry.servers.values()) {
    entries.push({
      name: server.name,
      description: server.meta.description,
      toolCount: server.tools.size,
      tools: [...server.tools.keys()],
    });
  }
  return entries;
}
