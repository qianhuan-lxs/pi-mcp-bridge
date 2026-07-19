import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { doRemove, doAdd } from "../registry-commands.ts";
import { loadRegistry } from "../registry/registry-loader.ts";

let agentDir: string;
let registryRoot: string;

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  agentDir = join(tmpdir(), `pi-mcp-bridge-rm-${stamp}`);
  registryRoot = join(agentDir, "mcp-registry");
  mkdirSync(registryRoot, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_MCP_BRIDGE_REGISTRY = registryRoot;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_MCP_BRIDGE_REGISTRY;
  rmSync(agentDir, { recursive: true, force: true });
});

describe("doRemove", () => {
  it("deletes the server directory and drops it from the registry", () => {
    const added = doAdd("tmp-server", { command: "npx", args: ["-y", "x"] });
    expect(added.ok).toBe(true);
    expect(existsSync(join(registryRoot, "tmp-server", "meta.json"))).toBe(true);

    const result = doRemove("tmp-server");
    expect(result.ok).toBe(true);
    expect(result.removedDir).toBe(join(registryRoot, "tmp-server"));
    expect(existsSync(join(registryRoot, "tmp-server"))).toBe(false);
    expect(loadRegistry().servers.has("tmp-server")).toBe(false);
  });

  it("rejects path-like names", () => {
    expect(doRemove("../escape").ok).toBe(false);
    expect(doRemove("a/b").ok).toBe(false);
  });

  it("succeeds when the registry directory is already missing", () => {
    const result = doRemove("ghost");
    expect(result.ok).toBe(true);
    expect(result.missingRegistry).toBe(true);
  });
});
