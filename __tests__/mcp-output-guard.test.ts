// __tests__/mcp-output-guard.test.ts
import { describe, it, expect } from "vitest";
import {
  guardMcpOutput,
  DEFAULT_MCP_OUTPUT_MAX_BYTES,
  DEFAULT_MCP_OUTPUT_MAX_LINES,
} from "../mcp-output-guard.ts";

describe("guardMcpOutput", () => {
  it("passes through small text outputs untouched", async () => {
    const result = await guardMcpOutput([{ type: "text", text: "hello world" }]);
    expect(result.outputGuard).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { text: string }).text).toBe("hello world");
  });

  it("truncates text outputs that exceed the byte budget and spills to a temp file", async () => {
    const big = "x".repeat(DEFAULT_MCP_OUTPUT_MAX_BYTES + 100);
    const result = await guardMcpOutput([{ type: "text", text: big }]);
    expect(result.outputGuard).toBeDefined();
    expect(result.outputGuard!.truncated).toBe(true);
    expect(result.outputGuard!.originalBytes).toBe(big.length);
    expect(result.outputGuard!.fullOutputPath).toBeTruthy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("truncated");
    expect(text.length).toBeLessThan(big.length);
  });

  it("truncates text outputs that exceed the line budget", async () => {
    const manyLines = Array.from({ length: DEFAULT_MCP_OUTPUT_MAX_LINES + 50 }, () => "line").join("\n");
    const result = await guardMcpOutput([{ type: "text", text: manyLines }]);
    expect(result.outputGuard).toBeDefined();
    expect(result.outputGuard!.originalLines).toBe(DEFAULT_MCP_OUTPUT_MAX_LINES + 50);
  });

  it("passes image blocks through untouched", async () => {
    const image = { type: "image" as const, data: "base64data", mimeType: "image/png" };
    const result = await guardMcpOutput([image, { type: "text", text: "caption" }]);
    expect(result.content.some(b => b.type === "image")).toBe(true);
  });

  it("returns an empty fallback when content is empty", async () => {
    const result = await guardMcpOutput([], { emptyTextFallback: "(no output)" });
    expect((result.content[0] as { text: string }).text).toBe("(no output)");
  });

  it("is a no-op when disabled", async () => {
    const big = "x".repeat(DEFAULT_MCP_OUTPUT_MAX_BYTES + 100);
    const result = await guardMcpOutput([{ type: "text", text: big }], { enabled: false });
    expect(result.outputGuard).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe(big);
  });
});
