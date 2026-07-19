// __tests__/reconcile-and-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectAutoSyncTargets, reconcileAndAutoSync } from "../reconcile-and-sync.ts";
import { reconcileRegistryFromConfig, type McpServersConfigFile } from "../mcp-servers-config.ts";
import { loadRegistry } from "../registry/registry-loader.ts";
import type { Registry } from "../registry/registry-types.ts";

let agentDir: string;
let projectDir: string;
let registryRoot: string;

function writeGlobal(file: McpServersConfigFile) {
  writeFileSync(join(agentDir, "mcp-servers.json"), JSON.stringify(file, null, 2), "utf-8");
}

function writeMeta(name: string, command: string, args: string[], tools: number) {
  const dir = join(registryRoot, name);
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        name,
        transport: { kind: "stdio", command, args },
        auth: { kind: "none" },
        lifecycle: { mode: "lazy", idleTimeoutMinutes: 10 },
        capabilities: { tools: true, resources: true },
        syncedFrom: "manual",
      },
      null,
      2,
    ),
    "utf-8",
  );
  for (let i = 0; i < tools; i++) {
    writeFileSync(
      join(dir, "tools", `t${i}.json`),
      JSON.stringify({
        name: `t${i}`,
        description: `Tool t${i}`,
        inputSchema: { type: "object" },
      }),
      "utf-8",
    );
  }
}

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  agentDir = join(tmpdir(), `pi-mcp-bridge-agent-${stamp}`);
  projectDir = join(tmpdir(), `pi-mcp-bridge-proj-${stamp}`);
  registryRoot = join(agentDir, "mcp-registry");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(registryRoot, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_MCP_BRIDGE_REGISTRY = registryRoot;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_MCP_BRIDGE_REGISTRY;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("collectAutoSyncTargets", () => {
  it("includes added, updated, and zero-tool configured servers", () => {
    writeMeta("fs", "npx", ["-y", "fs"], 0);
    writeMeta("mem", "npx", ["-y", "mem"], 2);
    writeGlobal({
      mcp: {
        fs: { type: "local", command: ["npx", "-y", "fs"] },
        mem: { type: "local", command: ["npx", "-y", "mem"] },
        neu: { type: "local", command: ["npx", "-y", "neu"] },
      },
    });
    const rec = reconcileRegistryFromConfig(projectDir);
    const registry = loadRegistry();
    const targets = collectAutoSyncTargets(rec, registry, ["fs", "mem", "neu"]);
    expect(targets).toContain("neu"); // added
    expect(targets).toContain("fs"); // zero tools
    expect(targets).not.toContain("mem"); // has tools + transport unchanged
  });
});

describe("reconcileAndAutoSync", () => {
  it("notifies when no config file is present", async () => {
    const notes: string[] = [];
    const result = await reconcileAndAutoSync({
      cwd: projectDir,
      notify: (msg) => notes.push(msg),
      sync: async () => ({ ok: true, toolsWritten: 0 }),
    });
    expect(result.reconcile.sources).toHaveLength(0);
    expect(notes.some((n) => n.includes("No mcp-servers.json found"))).toBe(true);
  });

  it("syncs zero-tool servers from config", async () => {
    writeMeta("fs", "npx", ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], 0);
    writeGlobal({
      mcp: {
        fs: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
      },
    });
    const synced: string[] = [];
    const result = await reconcileAndAutoSync({
      cwd: projectDir,
      sync: async (name) => {
        synced.push(name);
        return { ok: true, toolsWritten: 1 };
      },
    });
    expect(synced).toContain("fs");
    expect(result.syncTargets).toContain("fs");
  });
});

describe("collectAutoSyncTargets with empty registry helper", () => {
  it("dedupes names", () => {
    const registry: Registry = { root: registryRoot, servers: new Map(), index: null };
    const targets = collectAutoSyncTargets(
      { added: ["a"], updated: ["a", "b"], orphans: [], sources: ["x"] },
      registry,
      [],
    );
    expect(targets.sort()).toEqual(["a", "b"]);
  });
});
