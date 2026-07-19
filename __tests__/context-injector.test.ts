// __tests__/context-injector.test.ts
import { describe, it, expect } from "vitest";
import { buildContextBlock } from "../context-injector.ts";
import type { Registry } from "../registry/registry-types.ts";

function makeRegistry(servers: Array<{ name: string; tools?: Array<{ name: string; description?: string }> }>): Registry {
  const reg: Registry = { root: "/tmp/test", servers: new Map(), index: null };
  for (const s of servers) {
    const tools = new Map();
    for (const t of s.tools ?? []) {
      tools.set(t.name, {
        name: t.name,
        description: t.description ?? `Tool ${t.name}`,
        inputSchema: { type: "object" },
      });
    }
    reg.servers.set(s.name, {
      name: s.name,
      meta: {
        name: s.name,
        transport: { kind: "stdio", command: "x" },
        auth: { kind: "none" },
      },
      tools,
      directory: `/tmp/test/${s.name}`,
    });
  }
  return reg;
}

describe("buildContextBlock", () => {
  it("emits a helpful message for an empty registry", () => {
    const reg: Registry = { root: "/tmp", servers: new Map(), index: null };
    const result = buildContextBlock(reg);
    expect(result.block).toContain("0 servers configured");
    expect(result.truncated).toBe(false);
  });

  it("lists servers and tools", () => {
    const reg = makeRegistry([
      { name: "fs", tools: [{ name: "read_file", description: "Read a file." }] },
    ]);
    const result = buildContextBlock(reg);
    expect(result.block).toContain("fs");
    expect(result.block).toContain("read_file");
    expect(result.block).toContain("Read a file.");
    expect(result.truncated).toBe(false);
  });

  it("truncates when the budget is too small", () => {
    const reg = makeRegistry([
      {
        name: "bigserver",
        tools: Array.from({ length: 50 }, (_, i) => ({
          name: `tool_${i}`,
          description: `A tool with a fairly long description number ${i}.`.repeat(3),
        })),
      },
    ]);
    const result = buildContextBlock(reg, { contextBudgetTokens: 10 });
    expect(result.truncated).toBe(true);
    expect(result.block).toContain("truncated");
  });

  it("respects a larger budget without truncation", () => {
    const reg = makeRegistry([
      { name: "fs", tools: [{ name: "read_file", description: "Read a file." }] },
    ]);
    const result = buildContextBlock(reg, { contextBudgetTokens: 4000 });
    expect(result.truncated).toBe(false);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});
