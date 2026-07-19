#!/usr/bin/env node
// cli.ts - pi-mcp-bridge CLI: sync, validate, add.
//
// Usage:
//   pi-mcp-bridge sync <server> [--force]      Sync a live server's tools into the registry
//   pi-mcp-bridge validate                     Walk the registry and report issues
//   pi-mcp-bridge add <name> --command "..."   Scaffold a new registry entry
//   pi-mcp-bridge list                         List servers in the registry

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getRegistryRoot } from "./agent-dir.ts";
import { loadRegistry } from "./registry/registry-loader.ts";
import { syncServer, validateRegistry, rebuildIndex } from "./registry/registry-writer.ts";
import type { ServerMeta } from "./registry/registry-types.ts";

const args = parseArgs({
  allowPositionals: true,
  options: {
    force: { type: "boolean", default: false },
    command: { type: "string" },
    url: { type: "string" },
    description: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const subcommand = args.positionals[0];

function printHelp(): void {
  console.log(`pi-mcp-bridge CLI

Usage:
  pi-mcp-bridge sync <server> [--force]      Sync a live server's tools into the registry
  pi-mcp-bridge validate                     Walk the registry and report issues
  pi-mcp-bridge add <name> --command "..."   Scaffold a new registry entry (stdio)
  pi-mcp-bridge add <name> --url "..."       Scaffold a new registry entry (http)
  pi-mcp-bridge list                         List servers in the registry

Options:
  --force            Overwrite meta.json with syncedFrom = "manual"
  --command <cmd>    Command for stdio transport (e.g. "npx -y @mcp/server-filesystem /workspace")
  --url <url>        URL for http transport
  --description <d>  Server description
  -h, --help         Show this help
`);
}

async function main(): Promise<void> {
  if (args.values.help || !subcommand) {
    printHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case "sync":
      return runSync();
    case "validate":
      return runValidate();
    case "add":
      return runAdd();
    case "list":
      return runList();
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(2);
  }
}

async function runSync(): Promise<void> {
  const serverName = args.positionals[1];
  if (!serverName) {
    console.error("Usage: pi-mcp-bridge sync <server> [--force]");
    process.exit(2);
  }

  const registry = loadRegistry();
  const server = registry.servers.get(serverName);
  if (!server) {
    console.error(`Server "${serverName}" not found in registry. Run \`pi-mcp-bridge add ${serverName}\` first.`);
    process.exit(1);
  }

  // Connect to the live server using its meta.json transport config.
  const meta = server.meta;
  const client = new Client({ name: `pi-mcp-bridge-sync-${meta.name}`, version: "1.0.0" });

  let transport;
  if (meta.transport.kind === "stdio") {
    const cmd = meta.transport.command;
    const cmdArgs = meta.transport.args ?? [];
    transport = new StdioClientTransport({ command: cmd, args: cmdArgs, env: meta.transport.env });
  } else {
    console.error("HTTP transport sync is not yet implemented in Phase 1 — use stdio servers.");
    process.exit(2);
  }

  try {
    await client.connect(transport);
    const result = await syncServer(serverName, client, {
      force: args.values.force,
    });
    if (result.skipped) {
      console.log(`Skipped "${serverName}": ${result.skipped}`);
      process.exit(0);
    }
    console.log(
      `Synced "${serverName}": ${result.toolsWritten} tools written, ${result.toolsRemoved} removed, ${result.resourcesIndexed} resources indexed.`,
    );
  } catch (error) {
    console.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

function runValidate(): void {
  const issues = validateRegistry();
  if (issues.length === 0) {
    console.log("Registry is valid.");
    process.exit(0);
  }
  for (const issue of issues) {
    console.error(`${issue.server}/${issue.file}: ${issue.message}`);
  }
  process.exit(1);
}

function runAdd(): void {
  const name = args.positionals[1];
  if (!name) {
    console.error("Usage: pi-mcp-bridge add <name> --command \"...\" [--description \"...\"]");
    process.exit(2);
  }
  if (!args.values.command && !args.values.url) {
    console.error("add requires --command (stdio) or --url (http)");
    process.exit(2);
  }

  const root = getRegistryRoot();
  const serverDir = join(root, name);
  const toolsDir = join(serverDir, "tools");
  mkdirSync(toolsDir, { recursive: true });

  const meta: ServerMeta = args.values.command
    ? {
        $schema: "https://pi-mcp-bridge.dev/schemas/meta.v1.json",
        name,
        description: args.values.description,
        transport: {
          kind: "stdio",
          command: args.values.command,
          args: args.positionals.slice(2),
        },
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
        description: args.values.description,
        transport: { kind: "http", url: args.values.url! },
        auth: { kind: "none" },
        lifecycle: { mode: "lazy", idleTimeoutMinutes: 10 },
        capabilities: { tools: true, resources: true },
        exposeResources: true,
        excludeTools: [],
        syncedFrom: "manual",
      };

  const metaPath = join(serverDir, "meta.json");
  if (existsSync(metaPath)) {
    console.error(`meta.json already exists at ${metaPath}. Remove it first or use a different name.`);
    process.exit(1);
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  console.log(`Created ${metaPath}. Run \`pi-mcp-bridge sync ${name}\` to populate tools/ from a live server.`);

  // Rebuild the index so the new server shows up.
  const registry = loadRegistry();
  rebuildIndex(registry);
}

function runList(): void {
  const registry = loadRegistry();
  if (registry.servers.size === 0) {
    console.log("(no servers in registry)");
    return;
  }
  for (const server of registry.servers.values()) {
    const desc = server.meta.description ? ` — ${server.meta.description}` : "";
    console.log(`${server.name}${desc} (${server.tools.size} tools)`);
    for (const key of server.tools.keys()) {
      console.log(`  - ${key}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
