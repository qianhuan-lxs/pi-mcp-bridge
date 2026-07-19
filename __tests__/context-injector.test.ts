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

  it("includes full inputSchemas when the registry fits the budget", () => {
    const reg = makeRegistry([
      {
        name: "fs",
        tools: [
          {
            name: "read_file",
            description: "Read a file.",
            // The test helper sets inputSchema to { type: "object" } by default;
            // override it here with a richer schema to assert it's rendered.
          },
        ],
      },
    ]);
    // Override the default { type: "object" } with a real-shaped schema.
    const tool = reg.servers.get("fs")!.tools.get("read_file")!;
    tool.inputSchema = {
      type: "object",
      properties: { path: { type: "string", description: "Path to read." } },
      required: ["path"],
    };
    const result = buildContextBlock(reg, { contextBudgetTokens: 4000 });
    expect(result.schemasIncluded).toBe(true);
    expect(result.block).toContain("args:");
    // Compact JSON of the schema must appear inline.
    expect(result.block).toContain('"path"');
    expect(result.block).toContain('"required"');
    // The "read the schema file" footer must NOT appear when schemas are included.
    expect(result.block).not.toContain("tools/<tool>.json");
    expect(result.block).toContain("Full input schemas are included above");
  });

  it("falls back to descriptions-only when schemas would exceed the budget", () => {
    const reg = makeRegistry([
      {
        name: "bigserver",
        tools: Array.from({ length: 50 }, (_, i) => ({
          name: `tool_${i}`,
          description: `Tool number ${i}.`,
        })),
      },
    ]);
    // Give each tool a fat schema so renderWithSchemas overflows, but
    // renderFull(descriptions) still fits a moderate budget.
    for (const t of reg.servers.get("bigserver")!.tools.values()) {
      t.inputSchema = {
        type: "object",
        properties: {
          a: { type: "string", description: "x".repeat(20) },
          b: { type: "string", description: "y".repeat(20) },
          c: { type: "number" },
        },
      };
    }
    const result = buildContextBlock(reg, { contextBudgetTokens: 200 });
    expect(result.schemasIncluded).toBe(false);
    // The absolute-root "read the file" footer must appear.
    expect(result.block).toContain(reg.root);
    expect(result.block).toContain("tools/<tool>.json");
  });

  it("uses the absolute registry.root in the footer path", () => {
    const reg = makeRegistry([
      { name: "fs", tools: [{ name: "read_file", description: "Read a file." }] },
    ]);
    // Force fallback to descriptions-only by giving a schema too big for a tiny budget
    // but small enough that renderFull fits.
    const tool = reg.servers.get("fs")!.tools.get("read_file")!;
    tool.inputSchema = { type: "object", properties: { x: { type: "string", description: "z".repeat(200) } } };
    const result = buildContextBlock(reg, { contextBudgetTokens: 30 });
    expect(result.block).toContain(reg.root);
  });

  it("treats registries with > 30 tools as large (skips renderWithSchemas)", () => {
    // 31 tools → over the default limit of 30 → schemas NOT included,
    // even though the schemas would easily fit the token budget.
    const tools = Array.from({ length: 31 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}.`,
    }));
    const reg = makeRegistry([{ name: "bigserver", tools }]);
    const result = buildContextBlock(reg, { contextBudgetTokens: 100000 });
    expect(result.schemasIncluded).toBe(false);
    expect(result.block).toContain("tools/<tool>.json"); // fallback footer
    expect(result.block).not.toContain("Full input schemas are included above");
  });

  it("includes schemas for registries with exactly 30 tools (boundary)", () => {
    const tools = Array.from({ length: 30 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}.`,
    }));
    const reg = makeRegistry([{ name: "server", tools }]);
    const result = buildContextBlock(reg, { contextBudgetTokens: 100000 });
    expect(result.schemasIncluded).toBe(true);
    expect(result.block).toContain("Full input schemas are included above");
  });

  it("respects a custom schemaInjectionToolLimit", () => {
    // 5 tools but limit set to 3 → treated as large.
    const tools = Array.from({ length: 5 }, (_, i) => ({
      name: `t${i}`,
      description: `T${i}.`,
    }));
    const reg = makeRegistry([{ name: "s", tools }]);
    const result = buildContextBlock(reg, {
      contextBudgetTokens: 100000,
      schemaInjectionToolLimit: 3,
    });
    expect(result.schemasIncluded).toBe(false);
  });

  it("schemaInjectionToolLimit=0 disables schema injection entirely", () => {
    const reg = makeRegistry([
      { name: "fs", tools: [{ name: "read_file", description: "Read a file." }] },
    ]);
    const result = buildContextBlock(reg, {
      contextBudgetTokens: 100000,
      schemaInjectionToolLimit: 0,
    });
    expect(result.schemasIncluded).toBe(false);
  });
});
