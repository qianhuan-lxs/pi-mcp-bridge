#!/usr/bin/env node
// bin/pi-mcp-bridge.mjs - CLI entry shim.
//
// Runs cli.ts via tsx (a dependency). This lets us ship the CLI as
// TypeScript without a build step, matching how Pi loads extensions.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "cli.ts");
const args = process.argv.slice(2);

// `node --import tsx <file>` registers tsx as a loader and runs the .ts file.
const result = spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
