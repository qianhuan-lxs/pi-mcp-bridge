import { describe, it, expect } from "vitest";
import { toolErrorOverride } from "../error-signal.ts";

describe("toolErrorOverride", () => {
  it("flags connect/server/tool failures as errors", () => {
    for (const code of [
      "tool_error",
      "call_failed",
      "connect_failed",
      "server_not_found",
      "tool_not_found",
      "auth_required",
      "consent_required",
      "not_initialized",
    ]) {
      expect(toolErrorOverride({ error: code })).toEqual({ isError: true });
    }
  });

  it("ignores unknown or missing codes", () => {
    expect(toolErrorOverride({ error: "validation_hint" })).toBeUndefined();
    expect(toolErrorOverride({})).toBeUndefined();
    expect(toolErrorOverride(null)).toBeUndefined();
  });
});
