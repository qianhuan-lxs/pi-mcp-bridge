// __tests__/status-bar.test.ts
//
// Tests for the footer status line + themed list table renderers.

import { describe, it, expect } from "vitest";
import {
  formatStatusLine,
  renderListTable,
  renderStatusLine,
  totalToolCount,
} from "../status-bar.ts";
import type { McpBridgeState } from "../state.ts";
import type { ListEntry } from "../registry-commands.ts";

// A passthrough theme: wraps text in [] so tests can assert on styling
// without depending on real ANSI codes.
function makeTheme() {
  return {
    fg: (name: string, text: string) => `[${name}:${text}]`,
    bold: (text: string) => `*${text}*`,
  };
}

function makeRegistry(servers: { name: string; tools: string[] }[]) {
  const serversMap = new Map(
    servers.map(s => [
      s.name,
      {
        name: s.name,
        meta: {
          name: s.name,
          transport: { kind: "stdio" as const, command: "x", args: [] },
          auth: { kind: "none" as const },
        },
        tools: new Map(s.tools.map(t => [t, { name: t, description: "", inputSchema: {} }])),
        directory: `/tmp/${s.name}`,
      },
    ]),
  );
  return { root: "/tmp", servers: serversMap, index: null };
}

function makeState(servers: { name: string; tools: string[] }[]): McpBridgeState {
  return {
    manager: {} as never,
    lifecycle: {} as never,
    toolMetadata: new Map(),
    registry: makeRegistry(servers) as never,
    settings: {} as never,
    failureTracker: new Map(),
    uiResourceHandler: {} as never,
    consentManager: {} as never,
    uiServer: null,
    completedUiSessions: [],
    openBrowser: async () => {},
  };
}

describe("status-bar", () => {
  it("counts tools across all servers", () => {
    expect(totalToolCount(makeState([]))).toBe(0);
    expect(totalToolCount(makeState([{ name: "a", tools: ["t1"] }]))).toBe(1);
    expect(
      totalToolCount(makeState([
        { name: "a", tools: ["t1", "t2"] },
        { name: "b", tools: ["t3"] },
      ])),
    ).toBe(3);
  });

  it("formatStatusLine pluralizes correctly", () => {
    const theme = makeTheme();
    const one = formatStatusLine(makeState([{ name: "a", tools: ["t1"] }]), theme);
    expect(one).toContain("1 server");
    expect(one).not.toContain("1 servers");
    expect(one).toContain("1 tool");
    const two = formatStatusLine(
      makeState([{ name: "a", tools: ["t1", "t2"] }, { name: "b", tools: ["t3"] }]),
      theme,
    );
    expect(two).toContain("2 servers");
    expect(two).toContain("3 tools");
  });

  it("renderListTable shows an empty-registry hint", () => {
    const out = renderListTable([], makeTheme());
    expect(out).toContain("no servers in registry");
    expect(out).toContain("/mcp-bridge add");
  });

  it("renderListTable renders a header + per-server rows", () => {
    const entries: ListEntry[] = [
      {
        name: "context7",
        description: "docs lookup",
        toolCount: 2,
        tools: ["resolve-library-id", "get-docs"],
        transportKind: "stdio",
        syncedFrom: "live-server",
      },
    ];
    const out = renderListTable(entries, makeTheme());
    expect(out).toContain("dim:server");
    expect(out).toContain("[accent:*context7*]");
    expect(out).toContain("[success:2");
    expect(out).toContain("resolve-library-id");
    expect(out).toContain("get-docs");
    // syncedFrom "live-server" → success color
    expect(out).toContain("[success:live-server");
  });

  it("renderStatusLine highlights the counts", () => {
    const out = renderStatusLine(
      makeState([{ name: "a", tools: ["t1", "t2"] }]),
      makeTheme(),
    );
    expect(out).toContain("[accent:*1*]");
    expect(out).toContain("[accent:*2*]");
    expect(out).toContain("servers");
    expect(out).toContain("tools");
  });
});
