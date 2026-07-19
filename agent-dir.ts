import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve the Pi agent directory.
 *
 * Honors `$PI_CODING_AGENT_DIR` when set:
 * - `~` → home directory
 * - `~/foo` → resolved under home
 * - absolute path → used as-is
 * - relative path → resolved against cwd
 *
 * Defaults to `~/.pi/agent`.
 */
export function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) {
    return join(homedir(), ".pi", "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  if (configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

/** Join the agent dir with extra path segments. */
export function getAgentPath(...segments: string[]): string {
  return join(getAgentDir(), ...segments);
}

/**
 * Resolve the pi-mcp-bridge registry root.
 *
 * Order:
 * 1. `$PI_MCP_BRIDGE_REGISTRY` (with `~` expansion) if set and non-empty.
 * 2. `<agent dir>/mcp-registry/`.
 */
export function getRegistryRoot(): string {
  const configured = process.env.PI_MCP_BRIDGE_REGISTRY?.trim();
  if (configured) {
    if (configured === "~") return homedir();
    if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
    return resolve(configured);
  }
  return getAgentPath("mcp-registry");
}
