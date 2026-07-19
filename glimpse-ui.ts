// glimpse-ui.ts - Glimpse native window integration (macOS).
//
// Ported verbatim from pi-mcp-adapter. If the `glimpseui` package is
// installed (or `GLIMPSE_BINARY` is set), MCP UI resources open in a
// native WKWebView window instead of a browser tab. Set
// `MCP_UI_VIEWER=browser` to force the browser, or
// `MCP_UI_VIEWER=glimpse` to require native rendering.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { platform } from "node:os";
import { createRequire } from "node:module";

let glimpseAvailable: boolean | null = null;
let resolvedBinaryPath: string | null = null;

export function isGlimpseAvailable(): boolean {
  if (glimpseAvailable !== null) return glimpseAvailable;

  if (platform() !== "darwin") {
    glimpseAvailable = false;
    return false;
  }

  resolvedBinaryPath = getGlimpseBinaryPath();
  glimpseAvailable = resolvedBinaryPath !== null;
  return glimpseAvailable;
}

function getGlimpseBinaryPath(): string | null {
  if (process.env.GLIMPSE_BINARY && existsSync(process.env.GLIMPSE_BINARY)) {
    return process.env.GLIMPSE_BINARY;
  }

  // Local node_modules
  try {
    const require = createRequire(import.meta.url);
    const glimpseuiPath = require.resolve("glimpseui");
    const binaryPath = join(dirname(glimpseuiPath), "glimpse");
    if (existsSync(binaryPath)) return binaryPath;
  } catch {
    // not installed locally
  }

  // Global npm install
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
    const binaryPath = join(globalRoot, "glimpseui", "src", "glimpse");
    if (existsSync(binaryPath)) return binaryPath;
  } catch {
    // npm not on PATH
  }

  return null;
}

export async function openGlimpseWindow(
  html: string,
  options: {
    title: string;
    width?: number;
    height?: number;
    onClosed: () => void;
  },
) {
  const modulePath = resolvedBinaryPath
    ? join(dirname(resolvedBinaryPath), "glimpse.mjs")
    : "glimpseui";
  const glimpse = await import(modulePath);

  let active = true;
  const win = glimpse.open(html, {
    width: options.width ?? 900,
    height: options.height ?? 700,
    title: options.title,
  });

  win.on("closed", () => {
    if (!active) return;
    active = false;
    options.onClosed();
  });

  return {
    close: () => {
      if (!active) return;
      active = false;
      win.close();
    },
  };
}
