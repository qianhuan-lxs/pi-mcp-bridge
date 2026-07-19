import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpLifecycleManager } from "../lifecycle.ts";
import type { McpServerManager } from "../server-manager.ts";

describe("McpLifecycleManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes idle lazy servers after timeout when registered", async () => {
    const close = vi.fn(async () => {});
    const manager = {
      getConnection: () => undefined,
      connect: vi.fn(),
      isIdle: vi.fn(() => true),
      close,
      closeAll: vi.fn(async () => {}),
    } as unknown as McpServerManager;

    const lifecycle = new McpLifecycleManager(manager);
    lifecycle.setGlobalIdleTimeout(1); // 1 minute
    lifecycle.registerServer("fs", { command: "npx", args: ["fs"] }, { idleTimeout: 1 });
    lifecycle.startHealthChecks(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(close).toHaveBeenCalledWith("fs");

    await lifecycle.gracefulShutdown();
  });

  it("clearServers drops registrations so idle sweep no-ops", async () => {
    const close = vi.fn(async () => {});
    const manager = {
      getConnection: () => undefined,
      connect: vi.fn(),
      isIdle: vi.fn(() => true),
      close,
      closeAll: vi.fn(async () => {}),
    } as unknown as McpServerManager;

    const lifecycle = new McpLifecycleManager(manager);
    lifecycle.setGlobalIdleTimeout(1);
    lifecycle.registerServer("fs", { command: "npx" });
    lifecycle.clearServers();
    lifecycle.startHealthChecks(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(close).not.toHaveBeenCalled();
    await lifecycle.gracefulShutdown();
  });
});
