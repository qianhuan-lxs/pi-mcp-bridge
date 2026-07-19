// __tests__/mcp-servers-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadMcpServersConfig,
  entryToServerMeta,
  reconcileRegistryFromConfig,
  upsertMcpServersConfigEntry,
  removeMcpServersConfigEntry,
  getMcpServersConfigPaths,
  type McpServersConfigFile,
} from "../mcp-servers-config.ts";

let agentDir: string;
let projectDir: string;
let registryRoot: string;

function writeGlobal(file: McpServersConfigFile) {
  const path = join(agentDir, "mcp-servers.json");
  writeFileSync(path, JSON.stringify(file, null, 2), "utf-8");
}

function writeProject(file: McpServersConfigFile) {
  const piDir = join(projectDir, ".pi");
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, "mcp-servers.json"), JSON.stringify(file, null, 2), "utf-8");
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

describe("getMcpServersConfigPaths", () => {
  it("resolves global under agent dir and project under .pi/", () => {
    const paths = getMcpServersConfigPaths(projectDir);
    expect(paths.global).toBe(join(agentDir, "mcp-servers.json"));
    expect(paths.project).toBe(join(projectDir, ".pi", "mcp-servers.json"));
  });
});

describe("loadMcpServersConfig", () => {
  it("merges project over global by server name", () => {
    writeGlobal({
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "global-pkg"],
          enabled: true,
        },
        memory: {
          type: "local",
          command: ["npx", "-y", "memory"],
        },
      },
    });
    writeProject({
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "project-pkg"],
          enabled: true,
        },
      },
    });

    const loaded = loadMcpServersConfig(projectDir);
    expect(loaded.sources).toHaveLength(2);
    expect(loaded.entries.get("context7")).toMatchObject({
      type: "local",
      command: ["npx", "-y", "project-pkg"],
    });
    expect(loaded.entries.get("memory")).toMatchObject({
      type: "local",
      command: ["npx", "-y", "memory"],
    });
  });

  it("skips enabled: false entries", () => {
    writeGlobal({
      mcp: {
        on: { type: "local", command: ["echo"], enabled: true },
        off: { type: "local", command: ["echo"], enabled: false },
      },
    });
    const loaded = loadMcpServersConfig(projectDir);
    expect(loaded.entries.has("on")).toBe(true);
    expect(loaded.entries.has("off")).toBe(false);
  });
});

describe("entryToServerMeta", () => {
  it("maps local entry to stdio transport", () => {
    const meta = entryToServerMeta("fs", {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      environment: { FOO: "bar" },
      cwd: "/work",
      timeout: 5000,
      description: "files",
    });
    expect(meta.transport).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { FOO: "bar" },
      cwd: "/work",
    });
    expect(meta.description).toBe("files");
    expect(meta.lifecycle?.requestTimeoutMs).toBe(5000);
    expect(meta.auth).toEqual({ kind: "none" });
  });

  it("maps remote entry to http transport and oauth auth", () => {
    const meta = entryToServerMeta("docs", {
      type: "remote",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
      oauth: { clientId: "cid", scope: "tools" },
    });
    expect(meta.transport).toEqual({
      kind: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
    expect(meta.auth).toEqual({
      kind: "oauth",
      clientId: "cid",
      clientSecret: undefined,
      scope: "tools",
      redirectUri: undefined,
    });
  });
});

describe("reconcileRegistryFromConfig", () => {
  it("adds new servers, updates transport changes, reports orphans", () => {
    // Orphan already on disk.
    const orphanDir = join(registryRoot, "orphan");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(
      join(orphanDir, "meta.json"),
      JSON.stringify({
        name: "orphan",
        transport: { kind: "stdio", command: "echo" },
        auth: { kind: "none" },
      }),
      "utf-8",
    );

    writeGlobal({
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "context7"],
          enabled: true,
        },
      },
    });

    const first = reconcileRegistryFromConfig(projectDir);
    expect(first.added).toEqual(["context7"]);
    expect(first.updated).toEqual([]);
    expect(first.orphans).toContain("orphan");
    expect(existsSync(join(registryRoot, "context7", "meta.json"))).toBe(true);

    // Change transport → updated.
    writeGlobal({
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "context7-v2"],
          enabled: true,
        },
        orphan: {
          type: "local",
          command: ["echo"],
          enabled: true,
        },
      },
    });
    const second = reconcileRegistryFromConfig(projectDir);
    // orphan already had meta.json — not "added"; transport matches so not "updated".
    expect(second.added).toEqual([]);
    expect(second.updated).toContain("context7");
    expect(second.orphans).toEqual([]);

    const meta = JSON.parse(readFileSync(join(registryRoot, "context7", "meta.json"), "utf-8"));
    expect(meta.transport.args).toEqual(["-y", "context7-v2"]);
  });

  it("does not treat disabled servers as orphans", () => {
    writeGlobal({
      mcp: {
        disabled: { type: "local", command: ["echo"], enabled: false },
      },
    });
    const dir = join(registryRoot, "disabled");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        name: "disabled",
        transport: { kind: "stdio", command: "echo" },
        auth: { kind: "none" },
      }),
      "utf-8",
    );

    const result = reconcileRegistryFromConfig(projectDir);
    expect(result.added).toEqual([]);
    expect(result.orphans).not.toContain("disabled");
  });
});

describe("upsertMcpServersConfigEntry", () => {
  it("writes OpenCode shape under mcp", () => {
    const path = upsertMcpServersConfigEntry(
      "context7",
      {
        type: "local",
        command: ["npx", "-y", "@upstash/context7-mcp"],
        enabled: true,
      },
      "global",
      projectDir,
    );
    expect(path).toBe(join(agentDir, "mcp-servers.json"));
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw.mcp.context7).toEqual({
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp"],
      enabled: true,
    });
    expect(raw.mcpServers).toBeUndefined();
  });
});

describe("removeMcpServersConfigEntry", () => {
  it("deletes the named entry from global config", () => {
    writeGlobal({
      mcp: {
        keep: { type: "local", command: ["keep"] },
        drop: { type: "local", command: ["drop"] },
      },
    });
    const rewritten = removeMcpServersConfigEntry("drop", projectDir);
    expect(rewritten).toEqual([join(agentDir, "mcp-servers.json")]);
    const raw = JSON.parse(readFileSync(join(agentDir, "mcp-servers.json"), "utf-8"));
    expect(raw.mcp.keep).toBeDefined();
    expect(raw.mcp.drop).toBeUndefined();
  });
});
