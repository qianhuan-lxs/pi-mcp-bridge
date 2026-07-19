import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBridgeSettings } from "../config.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = join(tmpdir(), `pi-mcp-bridge-settings-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(agentDir, { recursive: true, force: true });
});

describe("loadBridgeSettings idleTimeout", () => {
  it("accepts 0 to disable idle sweep", () => {
    writeFileSync(join(agentDir, "mcp-bridge.json"), JSON.stringify({ idleTimeout: 0 }), "utf-8");
    const settings = loadBridgeSettings();
    expect(settings.idleTimeout).toBe(0);
  });

  it("keeps positive defaults", () => {
    writeFileSync(join(agentDir, "mcp-bridge.json"), JSON.stringify({ idleTimeout: 15 }), "utf-8");
    expect(loadBridgeSettings().idleTimeout).toBe(15);
  });
});
