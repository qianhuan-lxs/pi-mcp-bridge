import { describe, it, expect } from "vitest";
import { transportFingerprint } from "../server-manager.ts";

describe("transportFingerprint", () => {
  it("differs when command args change", () => {
    const a = transportFingerprint({ command: "npx", args: ["-y", "a"] });
    const b = transportFingerprint({ command: "npx", args: ["-y", "b"] });
    expect(a).not.toBe(b);
  });

  it("matches identical stdio definitions", () => {
    const a = transportFingerprint({ command: "npx", args: ["x"], env: { A: "1" }, cwd: "/tmp" });
    const b = transportFingerprint({ command: "npx", args: ["x"], env: { A: "1" }, cwd: "/tmp" });
    expect(a).toBe(b);
  });

  it("fingerprints http by url/headers", () => {
    const a = transportFingerprint({ url: "https://a.example/mcp" });
    const b = transportFingerprint({ url: "https://b.example/mcp" });
    expect(a).not.toBe(b);
  });
});
