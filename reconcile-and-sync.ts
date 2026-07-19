// reconcile-and-sync.ts - Shared mcp-servers.json reconcile + auto-sync.
//
// Used by session_start and `/mcp-bridge reload` so both paths share the
// same policy: upsert metas, then sync added / updated / zero-tool servers.

import {
  getMcpServersConfigPaths,
  loadMcpServersConfig,
  reconcileRegistryFromConfig,
  type ReconcileResult,
} from "./mcp-servers-config.ts";
import { loadRegistry } from "./registry/registry-loader.ts";
import type { Registry, ServerMeta } from "./registry/registry-types.ts";
import { logger } from "./logger.ts";

export type NotifyFn = (msg: string, level?: "info" | "warning" | "error") => void;

export type SyncFn = (name: string) => Promise<{
  ok: boolean;
  error?: string;
  toolsWritten?: number;
  skipped?: string;
}>;

export interface ReconcileAndSyncOpts {
  cwd?: string;
  /** User-facing notify (reload). When omitted, only logger is used. */
  notify?: NotifyFn;
  /** Per-server sync implementation. */
  sync: SyncFn;
}

export interface ReconcileAndSyncResult {
  reconcile: ReconcileResult;
  /** Servers that were selected for auto-sync (deduped). */
  syncTargets: string[];
  /** Names that failed sync. */
  syncFailures: Array<{ name: string; error: string }>;
  /** Registry after reconcile (+ sync writes). */
  registry: Registry;
}

/**
 * Reconcile `mcp-servers.json` into the registry, then auto-sync servers that
 * were added, had transport updated, or are configured but still have 0 tools.
 */
export async function reconcileAndAutoSync(opts: ReconcileAndSyncOpts): Promise<ReconcileAndSyncResult> {
  const cwd = opts.cwd ?? process.cwd();
  const notify = opts.notify;
  const paths = getMcpServersConfigPaths(cwd);

  let reconcile: ReconcileResult;
  try {
    reconcile = reconcileRegistryFromConfig(cwd);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("mcp-servers.json reconcile failed", error instanceof Error ? error : undefined);
    notify?.(`mcp-servers.json reconcile failed: ${msg}`, "error");
    return {
      reconcile: { added: [], updated: [], orphans: [], sources: [] },
      syncTargets: [],
      syncFailures: [],
      registry: loadRegistry(),
    };
  }

  if (reconcile.sources.length === 0) {
    const hint = `No mcp-servers.json found (checked ${paths.global} and ${paths.project}). Registry-only mode.`;
    logger.info(hint);
    notify?.(hint, "info");
  } else {
    const summary =
      `Reconciled mcp-servers.json (${reconcile.sources.length} file(s)): ` +
      `${reconcile.added.length} added, ${reconcile.updated.length} updated` +
      (reconcile.orphans.length > 0 ? `, ${reconcile.orphans.length} orphan(s)` : "") +
      ".";
    logger.info(`${summary} sources=${reconcile.sources.join(", ")}`);
    notify?.(summary, "info");
    for (const orphan of reconcile.orphans) {
      const warn =
        `Registry server "${orphan}" is not in mcp-servers.json — kept (not deleted). ` +
        "Add it to the file or remove its directory manually.";
      logger.warn(warn);
      notify?.(warn, "warning");
    }
  }

  let registry = loadRegistry();
  const { entries } = loadMcpServersConfig(cwd);
  const syncTargets = collectAutoSyncTargets(reconcile, registry, entries.keys());

  if (syncTargets.length > 0) {
    notify?.(
      `Auto-syncing ${syncTargets.length} server(s): ${syncTargets.join(", ")}…`,
      "info",
    );
  }

  const syncFailures: Array<{ name: string; error: string }> = [];
  if (syncTargets.length > 0) {
    const results = await Promise.allSettled(
      syncTargets.map(async (name) => {
        try {
          const r = await opts.sync(name);
          if (!r.ok) {
            const err = r.error ?? "unknown error";
            logger.warn(`auto-sync of "${name}" failed: ${err}`);
            notify?.(`Auto-sync of "${name}" failed: ${err}`, "error");
            syncFailures.push({ name, error: err });
          } else if (r.skipped) {
            logger.info(`auto-sync of "${name}" skipped: ${r.skipped}`);
            notify?.(`Auto-sync of "${name}" skipped: ${r.skipped}`, "warning");
          } else {
            logger.info(`auto-synced "${name}": ${r.toolsWritten ?? 0} tools`);
          }
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          logger.warn(`auto-sync of "${name}" threw: ${err}`);
          notify?.(`Auto-sync of "${name}" failed: ${err}`, "error");
          syncFailures.push({ name, error: err });
        }
      }),
    );
    void results;
    registry = loadRegistry();
  } else if (reconcile.added.length > 0 || reconcile.updated.length > 0) {
    registry = loadRegistry();
  }

  return { reconcile, syncTargets, syncFailures, registry };
}

/** Names that should be auto-synced after reconcile. */
export function collectAutoSyncTargets(
  rec: ReconcileResult,
  registry: Registry,
  configEntryNames: Iterable<string>,
): string[] {
  const names = new Set<string>([...rec.added, ...rec.updated]);
  for (const name of configEntryNames) {
    const server = registry.servers.get(name);
    if (!server) continue;
    if (server.tools.size === 0 && hasUsableTransport(server.meta)) {
      names.add(name);
    }
  }
  return [...names];
}

function hasUsableTransport(meta: ServerMeta): boolean {
  if (meta.transport.kind === "stdio") return Boolean(meta.transport.command);
  if (meta.transport.kind === "http") return Boolean(meta.transport.url);
  return false;
}
