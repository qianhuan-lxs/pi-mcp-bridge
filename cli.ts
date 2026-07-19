#!/usr/bin/env node
// cli.ts - Optional CLI wrapper around /mcp-bridge slash commands.
//
// The PRIMARY way to manage the registry is the /mcp-bridge slash command
// inside Pi (no PATH setup needed). This CLI is kept as a convenience for
// scripting / out-of-band use. It delegates all logic to registry-commands.ts
// so the two paths never diverge.
//
// Run via:  npx tsx ./cli.ts <subcommand> ...
// (No bin is registered in package.json — install via `pi install` and use
// /mcp-bridge inside Pi instead.)

import { parseArgs } from "node:util";
import { getRegistryRoot } from "./agent-dir.ts";
import { doSync, doValidate, doAdd, doList } from "./registry-commands.ts";

const args = parseArgs({
  allowPositionals: true,
  options: {
    force: { type: "boolean", default: false },
    url: { type: "string" },
    description: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const subcommand = args.positionals[0];

function printHelp(): void {
  console.log(`pi-mcp-bridge CLI (optional)

The PRIMARY path is the /mcp-bridge slash command inside Pi. This CLI
is for scripting / out-of-band use. Run via: npx tsx ./cli.ts <cmd>

Usage:
  npx tsx ./cli.ts sync <server> [--force] -- <command> [args...]
  npx tsx ./cli.ts validate
  npx tsx ./cli.ts add <name> -- <command> [args...]
  npx tsx ./cli.ts add <name> --url <url> [--description <d>]
  npx tsx ./cli.ts list
`);
}

async function main(): Promise<void> {
  if (args.values.help || !subcommand) {
    printHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case "sync": {
      const serverName = args.positionals[1];
      if (!serverName) {
        console.error("Usage: sync <server> [--force] -- <command> [args...]");
        process.exit(2);
      }
      const dashIdx = args.positionals.indexOf("--");
      if (dashIdx < 0 || dashIdx >= args.positionals.length - 1) {
        console.error("sync requires a command after `--`");
        process.exit(2);
      }
      const command = args.positionals[dashIdx + 1];
      const commandArgs = args.positionals.slice(dashIdx + 2);
      const result = await doSync(serverName, command, commandArgs, { force: args.values.force });
      if (!result.ok) {
        console.error(`Sync failed: ${result.error}`);
        process.exit(1);
      }
      if (result.skipped) {
        console.log(`Skipped "${result.serverName}": ${result.skipped}`);
        process.exit(0);
      }
      console.log(
        `Synced "${result.serverName}": ${result.toolsWritten} tools, ${result.toolsRemoved} removed, ${result.resourcesIndexed} resources.`,
      );
      return;
    }
    case "validate": {
      const result = doValidate();
      if (result.ok) {
        console.log("Registry is valid.");
        process.exit(0);
      }
      for (const issue of result.issues) {
        console.error(`${issue.server}/${issue.file}: ${issue.message}`);
      }
      process.exit(1);
    }
    case "add": {
      const name = args.positionals[1];
      if (!name) {
        console.error("Usage: add <name> -- <command> | --url <url>");
        process.exit(2);
      }
      const dashIdx = args.positionals.indexOf("--");
      const hasCommand = dashIdx >= 0 && dashIdx < args.positionals.length - 1;
      if (!hasCommand && !args.values.url) {
        console.error("add requires either --url or a command after `--`");
        process.exit(2);
      }
      const command = hasCommand ? args.positionals[dashIdx + 1] : undefined;
      const commandArgs = hasCommand ? args.positionals.slice(dashIdx + 2) : [];
      const result = doAdd(name, {
        command,
        args: commandArgs,
        url: args.values.url,
        description: args.values.description,
      });
      if (!result.ok) {
        console.error(`Add failed: ${result.error}`);
        process.exit(1);
      }
      console.log(`Added "${result.serverName}" → ${result.metaPath}`);
      return;
    }
    case "list": {
      const entries = doList();
      if (entries.length === 0) {
        console.log("(no servers in registry)");
        return;
      }
      for (const e of entries) {
        const desc = e.description ? ` — ${e.description}` : "";
        console.log(`${e.name}${desc} (${e.toolCount} tools)`);
        for (const t of e.tools) console.log(`  - ${t}`);
      }
      return;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(2);
  }
}

void getRegistryRoot; // re-exported for callers that import from cli
main().catch(error => {
  console.error(error);
  process.exit(1);
});
