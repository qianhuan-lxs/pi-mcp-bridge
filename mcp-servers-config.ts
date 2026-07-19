// mcp-servers-config.ts - OpenCode-aligned single-file MCP server config.
//
// Optional user-editable transport config that mirrors OpenCode's `mcp`
// block (ConfigMCPV1). The bridge still uses the filesystem registry for
// tool schemas + CallMcpTool; this file is only the transport source of
// truth when present.
//
//   {
//     "mcp": {
//       "context7": {
//         "type": "local",
//         "command": ["npx", "-y", "@upstash/context7-mcp"],
//         "enabled": true
//       },
//       "docs": {
//         "type": "remote",
//         "url": "https://mcp.example.com/mcp",
//         "enabled": true
//       }
//     }
//   }
//
// Paths:
//   - global:  `<agent dir>/mcp-servers.json`  (~/.pi/agent/mcp-servers.json)
//   - project: `.pi/mcp-servers.json`          (overrides global by name)
//
// On session_start / `/mcp-bridge reload`: reconcile into meta.json,
// warn about orphans (never delete), auto-sync added + updated + zero-tool
// configured servers (see reconcile-and-sync.ts).
// `enabled: false` entries are skipped (OpenCode semantics).

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentPath, getRegistryRoot } from "./agent-dir.ts";
import type { RegistryAuth, ServerMeta } from "./registry/registry-types.ts";
import { logger } from "./logger.ts";

const CONFIG_FILENAME = "mcp-servers.json";

/** OpenCode-style OAuth block on a remote MCP entry. */
export interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  callbackPort?: number;
  redirectUri?: string;
}

/** OpenCode `type: "local"` entry. */
export interface McpLocalEntry {
  type: "local";
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
  description?: string;
}

/** OpenCode `type: "remote"` entry. */
export interface McpRemoteEntry {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig | false;
  enabled?: boolean;
  timeout?: number;
  description?: string;
}

export type McpServerEntryConfig = McpLocalEntry | McpRemoteEntry;

/** The `mcp-servers.json` file shape (OpenCode top-level key `mcp`). */
export interface McpServersConfigFile {
  mcp: Record<string, McpServerEntryConfig>;
}

export interface McpServersConfigPaths {
  global: string;
  project: string;
}

/** Resolve the global + project config file paths. */
export function getMcpServersConfigPaths(cwd: string = process.cwd()): McpServersConfigPaths {
  return {
    global: getAgentPath(CONFIG_FILENAME),
    project: resolve(cwd, ".pi", CONFIG_FILENAME),
  };
}

export interface LoadedMcpServersConfig {
  /** Merged entries (project overrides global per server name). Disabled entries excluded. */
  entries: Map<string, McpServerEntryConfig>;
  /** Which files were actually read (for logging). */
  sources: string[];
}

/**
 * Load and merge global + project `mcp-servers.json`.
 * Missing/unparseable files are skipped silently (the config is optional).
 * Entries with `enabled: false` are omitted from the result.
 */
export function loadMcpServersConfig(cwd: string = process.cwd()): LoadedMcpServersConfig {
  const paths = getMcpServersConfigPaths(cwd);
  const entries = new Map<string, McpServerEntryConfig>();
  const sources: string[] = [];

  for (const p of [paths.global, paths.project]) {
    if (!existsSync(p)) continue;
    let file: McpServersConfigFile;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (!raw || typeof raw !== "object" || !raw.mcp || typeof raw.mcp !== "object") {
        logger.warn(`mcp-servers config at ${p} missing/invalid "mcp" object — skipping`);
        continue;
      }
      file = raw as McpServersConfigFile;
    } catch (error) {
      logger.warn(
        `mcp-servers config at ${p} is not valid JSON — skipping: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const [name, entry] of Object.entries(file.mcp)) {
      if (!entry || typeof entry !== "object") continue;
      if (!isValidEntry(entry)) {
        logger.warn(`mcp-servers config at ${p}: ignoring invalid entry "${name}" (need type local|remote)`);
        continue;
      }
      if (entry.enabled === false) continue;
      entries.set(name, entry);
    }
    sources.push(p);
  }

  return { entries, sources };
}

/** Build a `ServerMeta` from an OpenCode-shaped config entry. */
export function entryToServerMeta(
  name: string,
  entry: McpServerEntryConfig,
  existing?: ServerMeta,
): ServerMeta {
  const transport =
    entry.type === "remote"
      ? { kind: "http" as const, url: entry.url, headers: entry.headers }
      : {
          kind: "stdio" as const,
          command: entry.command[0] ?? "",
          args: entry.command.slice(1),
          env: entry.environment,
          cwd: entry.cwd,
        };

  const auth = mapAuth(entry, existing?.auth);
  const lifecycle = {
    ...(existing?.lifecycle ?? { mode: "lazy" as const, idleTimeoutMinutes: 10 }),
    ...(typeof entry.timeout === "number" && entry.timeout > 0
      ? { requestTimeoutMs: entry.timeout }
      : {}),
  };

  return {
    $schema: "https://pi-mcp-bridge.dev/schemas/meta.v1.json",
    name,
    description: entry.description ?? existing?.description,
    transport,
    auth,
    lifecycle,
    capabilities: existing?.capabilities ?? { tools: true, resources: true },
    exposeResources: existing?.exposeResources ?? true,
    excludeTools: existing?.excludeTools ?? [],
    instructions: existing?.instructions,
    syncedAt: existing?.syncedAt,
    syncedFrom: existing?.syncedFrom ?? "manual",
  };
}

export interface ReconcileResult {
  /** Servers whose meta.json was created (newly added from the config). */
  added: string[];
  /** Servers whose meta.json transport config was updated. */
  updated: string[];
  /** Registry servers NOT present in the config file (warned, not deleted). */
  orphans: string[];
  /** Config file sources that were read. */
  sources: string[];
}

/**
 * Reconcile `mcp-servers.json` into the registry: upsert `meta.json` for
 * each enabled config entry, collect orphans (registry servers not in the
 * config). Does NOT touch `tools/*.json` and does NOT delete orphans.
 */
export function reconcileRegistryFromConfig(cwd: string = process.cwd()): ReconcileResult {
  const { entries, sources } = loadMcpServersConfig(cwd);
  if (entries.size === 0 && sources.length === 0) {
    return { added: [], updated: [], orphans: [], sources };
  }

  const root = getRegistryRoot();
  const added: string[] = [];
  const updated: string[] = [];

  for (const [name, entry] of entries) {
    const serverDir = join(root, name);
    const metaPath = join(serverDir, "meta.json");

    let existing: ServerMeta | undefined;
    if (existsSync(metaPath)) {
      try {
        existing = JSON.parse(readFileSync(metaPath, "utf-8")) as ServerMeta;
      } catch {
        // corrupt meta — treat as missing, overwrite below
      }
    }

    const newMeta = entryToServerMeta(name, entry, existing);

    if (!existing) {
      atomicWriteJson(metaPath, newMeta);
      added.push(name);
      continue;
    }

    if (transportDiffers(existing.transport, newMeta.transport) || authDiffers(existing.auth, newMeta.auth)) {
      atomicWriteJson(metaPath, newMeta);
      updated.push(name);
    }
  }

  // Orphans: registry servers not in the enabled config. Warn, don't delete.
  // Include disabled names from the raw files so disabling doesn't mark as orphan.
  const configuredNames = collectAllConfiguredNames(cwd);
  const orphans: string[] = [];
  try {
    if (existsSync(root)) {
      for (const dirName of readdirSync(root, { withFileTypes: true })) {
        if (!dirName.isDirectory()) continue;
        if (!configuredNames.has(dirName.name)) orphans.push(dirName.name);
      }
    }
  } catch (error) {
    logger.warn(
      `failed to enumerate registry for orphans: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { added, updated, orphans, sources };
}

/** Upsert one entry into a config file (used by `/mcp-bridge add`).
 * Creates the file if absent. Writes OpenCode shape under `mcp`. */
export function upsertMcpServersConfigEntry(
  name: string,
  entry: McpServerEntryConfig,
  scope: "global" | "project" = "global",
  cwd: string = process.cwd(),
): string {
  const paths = getMcpServersConfigPaths(cwd);
  const path = scope === "project" ? paths.project : paths.global;

  let file: McpServersConfigFile = { mcp: {} };
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (raw && typeof raw === "object" && raw.mcp && typeof raw.mcp === "object") {
        file = raw as McpServersConfigFile;
      }
    } catch {
      // corrupt — start fresh
    }
  }
  file.mcp[name] = entry;
  atomicWriteJson(path, file);
  return path;
}

/**
 * Remove one server name from global and/or project `mcp-servers.json`.
 * Missing files or missing keys are no-ops. Returns paths that were rewritten.
 */
export function removeMcpServersConfigEntry(
  name: string,
  cwd: string = process.cwd(),
): string[] {
  const paths = getMcpServersConfigPaths(cwd);
  const rewritten: string[] = [];
  for (const path of [paths.global, paths.project]) {
    if (!existsSync(path)) continue;
    let file: McpServersConfigFile;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (!raw || typeof raw !== "object" || !raw.mcp || typeof raw.mcp !== "object") continue;
      file = raw as McpServersConfigFile;
    } catch {
      continue;
    }
    if (!(name in file.mcp)) continue;
    delete file.mcp[name];
    atomicWriteJson(path, file);
    rewritten.push(path);
  }
  return rewritten;
}

function isValidEntry(entry: unknown): entry is McpServerEntryConfig {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (e.type === "local") {
    return Array.isArray(e.command) && e.command.every(c => typeof c === "string") && e.command.length > 0;
  }
  if (e.type === "remote") {
    return typeof e.url === "string" && e.url.length > 0;
  }
  return false;
}

function mapAuth(entry: McpServerEntryConfig, existing?: RegistryAuth): RegistryAuth {
  if (entry.type === "remote" && entry.oauth && typeof entry.oauth === "object") {
    return {
      kind: "oauth",
      clientId: entry.oauth.clientId,
      clientSecret: entry.oauth.clientSecret,
      scope: entry.oauth.scope,
      redirectUri: entry.oauth.redirectUri,
    };
  }
  return existing ?? { kind: "none" };
}

/** Names present in config files including `enabled: false` (for orphan detection). */
function collectAllConfiguredNames(cwd: string): Set<string> {
  const paths = getMcpServersConfigPaths(cwd);
  const names = new Set<string>();
  for (const p of [paths.global, paths.project]) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (!raw?.mcp || typeof raw.mcp !== "object") continue;
      for (const name of Object.keys(raw.mcp)) names.add(name);
    } catch {
      // ignore
    }
  }
  return names;
}

function transportDiffers(
  a: ServerMeta["transport"],
  b: ServerMeta["transport"],
): boolean {
  if (a.kind !== b.kind) return true;
  if (a.kind === "stdio" && b.kind === "stdio") {
    return (
      a.command !== b.command ||
      JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? []) ||
      JSON.stringify(a.env ?? {}) !== JSON.stringify(b.env ?? {}) ||
      (a.cwd ?? "") !== (b.cwd ?? "")
    );
  }
  if (a.kind === "http" && b.kind === "http") {
    return a.url !== b.url || JSON.stringify(a.headers ?? {}) !== JSON.stringify(b.headers ?? {});
  }
  return false;
}

function authDiffers(a: RegistryAuth, b: RegistryAuth): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, path);
}
