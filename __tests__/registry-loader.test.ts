// __tests__/registry-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry, parseServerMeta, parseToolDefinition } from "../registry/registry-loader.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-mcp-bridge-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeServer(name: string, meta: object, tools: Record<string, object> = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  const toolsDir = join(dir, "tools");
  if (Object.keys(tools).length > 0) {
    mkdirSync(toolsDir, { recursive: true });
    for (const [filename, def] of Object.entries(tools)) {
      writeFileSync(join(toolsDir, `${filename}.json`), JSON.stringify(def));
    }
  }
}

describe("parseServerMeta", () => {
  it("accepts a valid stdio server with bearer auth", () => {
    const meta = parseServerMeta(
      JSON.stringify({
        name: "fs",
        transport: { kind: "stdio", command: "npx", args: ["-y", "fs-server"] },
        auth: { kind: "bearer", bearerTokenEnv: "FS_TOKEN" },
      }),
      "fs",
    );
    expect(meta.name).toBe("fs");
    expect(meta.transport.kind).toBe("stdio");
    expect(meta.auth.kind).toBe("bearer");
  });

  it("accepts a valid http server with no auth", () => {
    const meta = parseServerMeta(
      JSON.stringify({
        name: "api",
        transport: { kind: "http", url: "http://localhost:3000/mcp" },
        auth: { kind: "none" },
      }),
      "api",
    );
    expect(meta.transport.kind).toBe("http");
    expect(meta.auth.kind).toBe("none");
  });

  it("rejects missing name", () => {
    expect(() =>
      parseServerMeta(
        JSON.stringify({
          transport: { kind: "stdio", command: "x" },
          auth: { kind: "none" },
        }),
        "fs",
      ),
    ).toThrow(/name/);
  });

  it("rejects invalid transport kind", () => {
    expect(() =>
      parseServerMeta(
        JSON.stringify({
          name: "fs",
          transport: { kind: "websocket" },
          auth: { kind: "none" },
        }),
        "fs",
      ),
    ).toThrow(/transport\.kind/);
  });

  it("rejects stdio without command", () => {
    expect(() =>
      parseServerMeta(
        JSON.stringify({ name: "fs", transport: { kind: "stdio" }, auth: { kind: "none" } }),
        "fs",
      ),
    ).toThrow(/command/);
  });

  it("rejects http without url", () => {
    expect(() =>
      parseServerMeta(
        JSON.stringify({ name: "fs", transport: { kind: "http" }, auth: { kind: "none" } }),
        "fs",
      ),
    ).toThrow(/url/);
  });

  it("rejects invalid auth kind", () => {
    expect(() =>
      parseServerMeta(
        JSON.stringify({
          name: "fs",
          transport: { kind: "stdio", command: "x" },
          auth: { kind: "basic" },
        }),
        "fs",
      ),
    ).toThrow(/auth\.kind/);
  });

  it("rejects non-JSON input", () => {
    expect(() => parseServerMeta("not json{", "fs")).toThrow(/valid JSON/);
  });
});

describe("parseToolDefinition", () => {
  it("accepts a valid tool definition", () => {
    const def = parseToolDefinition(
      JSON.stringify({
        name: "read_file",
        description: "Read a file.",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      }),
      "read-file",
    );
    expect(def.name).toBe("read_file");
    expect(def.description).toBe("Read a file.");
  });

  it("rejects missing name", () => {
    expect(() =>
      parseToolDefinition(JSON.stringify({ description: "x", inputSchema: {} }), "k"),
    ).toThrow(/name/);
  });

  it("rejects missing description", () => {
    expect(() =>
      parseToolDefinition(JSON.stringify({ name: "x", inputSchema: {} }), "k"),
    ).toThrow(/description/);
  });

  it("rejects missing inputSchema", () => {
    expect(() =>
      parseToolDefinition(JSON.stringify({ name: "x", description: "y" }), "k"),
    ).toThrow(/inputSchema/);
  });
});

describe("loadRegistry", () => {
  it("returns an empty registry when the root does not exist", () => {
    const reg = loadRegistry(join(root, "does-not-exist"));
    expect(reg.servers.size).toBe(0);
    expect(reg.index).toBeNull();
  });

  it("loads a server with its tools", () => {
    writeServer(
      "fs",
      {
        name: "fs",
        transport: { kind: "stdio", command: "npx", args: ["-y", "fs"] },
        auth: { kind: "none" },
      },
      {
        "read-file": {
          name: "read_file",
          description: "Read a file.",
          inputSchema: { type: "object" },
        },
        "list-files": {
          name: "list_files",
          description: "List files.",
          inputSchema: { type: "object" },
        },
      },
    );
    const reg = loadRegistry(root);
    expect(reg.servers.size).toBe(1);
    const fs = reg.servers.get("fs");
    expect(fs).toBeDefined();
    expect(fs!.tools.size).toBe(2);
    expect(fs!.tools.get("read-file")!.name).toBe("read_file");
  });

  it("skips a server whose directory name does not match meta.name", () => {
    writeServer("wrong-dir", {
      name: "different-name",
      transport: { kind: "stdio", command: "x" },
      auth: { kind: "none" },
    });
    const reg = loadRegistry(root);
    expect(reg.servers.size).toBe(0);
  });

  it("skips a server with invalid meta.json but loads others", () => {
    writeServer("good", {
      name: "good",
      transport: { kind: "stdio", command: "x" },
      auth: { kind: "none" },
    });
    const badDir = join(root, "bad");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "meta.json"), "{ not valid json");
    const reg = loadRegistry(root);
    expect(reg.servers.size).toBe(1);
    expect(reg.servers.has("good")).toBe(true);
  });

  it("builds a transient index when index.json is missing", () => {
    writeServer("fs", {
      name: "fs",
      transport: { kind: "stdio", command: "x" },
      auth: { kind: "none" },
    });
    const reg = loadRegistry(root);
    expect(reg.index).not.toBeNull();
    expect(reg.index!.servers).toHaveLength(1);
    expect(reg.index!.servers[0].name).toBe("fs");
  });
});
