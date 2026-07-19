// server-manager.ts - MCP client connection manager.
//
// Ported from pi-mcp-adapter with sampling/elicitation/URL-elicitation
// handlers removed (those are deferred to phase-2/3/4 OpenSpec changes).
// Keeps: lazy connect with dedup, idle tracking, npx resolution, bearer
// auth, StreamableHTTP-with-SSE-fallback, paginated tool/resource listing.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpTool, McpResource, ServerEntry as ServerDefinition, Transport } from "./types.ts";
import { resolveNpxBinary } from "./npx-resolver.ts";
import { logger } from "./logger.ts";
import { interpolateEnvRecord, resolveBearerToken, resolveConfigPath } from "./utils.ts";
import { abortable, throwIfAborted } from "./abort.ts";

interface ServerConnection {
  client: Client;
  transport: Transport;
  definition: ServerDefinition;
  tools: McpTool[];
  resources: McpResource[];
  lastUsedAt: number;
  inFlight: number;
  status: "connected" | "closed" | "needs-auth";
}

export class McpServerManager {
  private connections = new Map<string, ServerConnection>();
  private connectPromises = new Map<string, Promise<ServerConnection>>();
  private defaultRequestTimeoutMs: number | undefined;

  /** Default cwd for stdio servers without an explicit config `cwd`. */
  constructor(private readonly defaultCwd?: string) {}

  setDefaultRequestTimeoutMs(timeoutMs: number | undefined): void {
    this.defaultRequestTimeoutMs = normalizeRequestTimeoutMs(timeoutMs);
  }

  getRequestOptions(name: string, signal?: AbortSignal): RequestOptions | undefined {
    const connection = this.connections.get(name);
    return this.buildRequestOptions(connection?.definition, signal);
  }

  private getResolvedRequestTimeoutMs(definition?: ServerDefinition): number | undefined {
    if (definition?.requestTimeoutMs !== undefined) {
      return normalizeRequestTimeoutMs(definition.requestTimeoutMs);
    }
    return this.defaultRequestTimeoutMs;
  }

  private buildRequestOptions(
    definition?: ServerDefinition,
    signal?: AbortSignal,
  ): RequestOptions | undefined {
    const timeout = this.getResolvedRequestTimeoutMs(definition);
    if (!signal && timeout === undefined) return undefined;
    return {
      ...(signal ? { signal } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }

  async connect(
    name: string,
    definition: ServerDefinition,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    throwIfAborted(signal);
    // Dedupe concurrent connection attempts
    if (this.connectPromises.has(name)) {
      return abortable(this.connectPromises.get(name)!, signal);
    }

    // Reuse existing connection if healthy and transport still matches.
    const existing = this.connections.get(name);
    if (existing?.status === "connected") {
      if (transportFingerprint(existing.definition) === transportFingerprint(definition)) {
        existing.lastUsedAt = Date.now();
        return existing;
      }
      // Transport changed (e.g. mcp-servers.json edit + reload) — drop stale conn.
      await this.close(name);
    }

    const promise = this.createConnection(name, definition, signal);
    this.connectPromises.set(name, promise);

    try {
      const connection = await promise;
      this.connections.set(name, connection);
      return connection;
    } finally {
      this.connectPromises.delete(name);
    }
  }

  private async createConnection(
    name: string,
    definition: ServerDefinition,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    throwIfAborted(signal);
    const client = this.createClient(name);

    let transport: Transport;

    if (definition.command) {
      let command = definition.command;
      let args = definition.args ?? [];

      if (command === "npx" || command === "npm") {
        const resolved = await resolveNpxBinary(command, args);
        if (resolved) {
          command = resolved.isJs ? "node" : resolved.binPath;
          args = resolved.isJs ? [resolved.binPath, ...resolved.extraArgs] : resolved.extraArgs;
          logger.debug(`${name} resolved to ${resolved.binPath} (skipping npm parent)`);
        }
      }

      transport = new StdioClientTransport({
        command,
        args,
        env: resolveEnv(definition.env),
        cwd: resolveConfigPath(definition.cwd) ?? this.defaultCwd,
        stderr: definition.debug ? "inherit" : "ignore",
      });
    } else if (definition.url) {
      // HTTP transport with fallback
      transport = await this.createHttpTransport(definition, name, signal);
    } else {
      throw new Error(`Server ${name} has no command or url`);
    }

    const requestOptions = this.buildRequestOptions(definition, signal);

    try {
      await client.connect(transport, requestOptions);

      // Discover tools and resources
      const [tools, resources] = await Promise.all([
        this.fetchAllTools(client, requestOptions),
        this.fetchAllResources(client, requestOptions),
      ]);

      return {
        client,
        transport,
        definition,
        tools,
        resources,
        lastUsedAt: Date.now(),
        inFlight: 0,
        status: "connected",
      };
    } catch (error) {
      // Check for UnauthorizedError - server requires OAuth (Phase 2+).
      // Phase 1 only supports bearer/none; surface as needs-auth so the
      // caller can produce a helpful error.
      if (error instanceof UnauthorizedError) {
        await client.close().catch(() => {});
        await transport.close().catch(() => {});
        return {
          client,
          transport,
          definition,
          tools: [],
          resources: [],
          lastUsedAt: Date.now(),
          inFlight: 0,
          status: "needs-auth",
        };
      }

      // Clean up both client and transport on any error
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw error;
    }
  }

  private createClient(serverName: string): Client {
    return new Client({ name: `pi-mcp-bridge-${serverName}`, version: "1.0.0" });
  }

  private async createHttpTransport(
    definition: ServerDefinition,
    serverName: string,
    signal?: AbortSignal,
  ): Promise<Transport> {
    throwIfAborted(signal);
    const url = new URL(definition.url!);

    // Build headers first (including any bearer token)
    const headers = resolveHeaders(definition.headers) ?? {};

    if (definition.auth === "bearer") {
      const token = resolveBearerToken(definition);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;

    // Try StreamableHTTP first (modern MCP servers)
    const streamableTransport = new StreamableHTTPClientTransport(url, { requestInit });

    try {
      // Probe with a throwaway client to verify the transport works.
      const testClient = new Client({ name: "pi-mcp-bridge-probe", version: "0.1.0" });
      await testClient.connect(streamableTransport, this.buildRequestOptions(definition, signal));
      await testClient.close().catch(() => {});
      await streamableTransport.close().catch(() => {});

      // StreamableHTTP works - create fresh transport for actual use
      return new StreamableHTTPClientTransport(url, { requestInit });
    } catch (error) {
      await streamableTransport.close().catch(() => {});

      // Host cancellation is not transport capability evidence.
      if (signal?.aborted) {
        throwIfAborted(signal);
      }

      // UnauthorizedError → server needs auth, don't fall back to SSE.
      if (error instanceof UnauthorizedError) {
        throw error;
      }

      // SSE is the legacy transport
      return new SSEClientTransport(url, { requestInit });
    }
  }

  private async fetchAllTools(client: Client, requestOptions?: RequestOptions): Promise<McpTool[]> {
    const allTools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined, requestOptions);
      allTools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    return allTools;
  }

  private async fetchAllResources(
    client: Client,
    requestOptions?: RequestOptions,
  ): Promise<McpResource[]> {
    try {
      const allResources: McpResource[] = [];
      let cursor: string | undefined;
      do {
        const result = await client.listResources(cursor ? { cursor } : undefined, requestOptions);
        allResources.push(...(result.resources ?? []));
        cursor = result.nextCursor;
      } while (cursor);
      return allResources;
    } catch {
      if (requestOptions?.signal?.aborted) {
        throwIfAborted(requestOptions.signal);
      }
      // Server may not support resources
      return [];
    }
  }

  async readResource(name: string, uri: string, signal?: AbortSignal): Promise<ReadResourceResult> {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }

    try {
      this.touch(name);
      this.incrementInFlight(name);
      return await connection.client.readResource(
        { uri },
        this.getRequestOptions(name, signal),
      );
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }

  /** Forward a `tools/call` request to a connected server. */
  async callTool(
    name: string,
    request: { name: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }
    try {
      this.touch(name);
      this.incrementInFlight(name);
      return await abortable(
        connection.client.callTool(request, undefined, this.getRequestOptions(name, signal)),
        signal,
      );
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }

  async close(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) return;

    // Delete from map BEFORE async cleanup to prevent a race where a
    // concurrent connect() creates a new connection that our deferred
    // delete() would then remove, orphaning the new server process.
    connection.status = "closed";
    this.connections.delete(name);
    await connection.client.close().catch(() => {});
    await connection.transport.close().catch(() => {});
  }

  async closeAll(): Promise<void> {
    const names = [...this.connections.keys()];
    await Promise.all(names.map(name => this.close(name)));
  }

  getConnection(name: string): ServerConnection | undefined {
    return this.connections.get(name);
  }

  getAllConnections(): Map<string, ServerConnection> {
    return new Map(this.connections);
  }

  touch(name: string): void {
    const connection = this.connections.get(name);
    if (connection) {
      connection.lastUsedAt = Date.now();
    }
  }

  incrementInFlight(name: string): void {
    const connection = this.connections.get(name);
    if (connection) {
      connection.inFlight = (connection.inFlight ?? 0) + 1;
    }
  }

  decrementInFlight(name: string): void {
    const connection = this.connections.get(name);
    if (connection && connection.inFlight) {
      connection.inFlight--;
    }
  }

  isIdle(name: string, timeoutMs: number): boolean {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") return false;
    if (connection.inFlight > 0) return false;
    return Date.now() - connection.lastUsedAt > timeoutMs;
  }
}

/** Resolve environment variables with interpolation (also used by `doSync`). */
export function resolveEnv(env?: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      resolved[key] = value;
    }
  }
  if (!env) return resolved;
  const overrides = interpolateEnvRecord(env);
  return overrides ? { ...resolved, ...overrides } : resolved;
}

/** Fingerprint a server definition's transport for stale-connection detection. */
export function transportFingerprint(definition: ServerDefinition): string {
  if (definition.command) {
    return JSON.stringify({
      k: "stdio",
      c: definition.command,
      a: definition.args ?? [],
      e: definition.env ?? {},
      cwd: definition.cwd ?? "",
    });
  }
  return JSON.stringify({
    k: "http",
    u: definition.url ?? "",
    h: definition.headers ?? {},
  });
}

/** Resolve headers with environment variable interpolation. */
function resolveHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  return interpolateEnvRecord(headers);
}

function normalizeRequestTimeoutMs(timeoutMs: number | undefined): number | undefined {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : undefined;
}
