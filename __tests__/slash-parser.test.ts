// __tests__/slash-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseSyncArgs, parseAddArgs } from "../slash-parser.ts";

describe("parseSyncArgs", () => {
  it("parses server + command after --", () => {
    const r = parseSyncArgs("context7 -- npx -y @upstash/context7-mcp");
    if ("error" in r) throw new Error(r.error);
    expect(r.serverName).toBe("context7");
    expect(r.command).toBe("npx");
    expect(r.commandArgs).toEqual(["-y", "@upstash/context7-mcp"]);
    expect(r.force).toBe(false);
    expect(r.env).toEqual({});
  });

  it("parses --env K=V as a literal value", () => {
    const r = parseSyncArgs("github --env TOKEN=ghp_xxx -- npx -y server-github");
    if ("error" in r) throw new Error(r.error);
    expect(r.env).toEqual({ TOKEN: "ghp_xxx" });
  });

  it("parses --env K (no value) as an env reference", () => {
    const r = parseSyncArgs("github --env GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y server-github");
    if ("error" in r) throw new Error(r.error);
    expect(r.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "${env.GITHUB_PERSONAL_ACCESS_TOKEN}" });
  });

  it("parses --force", () => {
    const r = parseSyncArgs("context7 --force -- npx -y @upstash/context7-mcp");
    if ("error" in r) throw new Error(r.error);
    expect(r.force).toBe(true);
  });

  it("errors without a server name", () => {
    const r = parseSyncArgs("-- npx -y server");
    expect("error" in r).toBe(true);
  });

  it("errors without a command after --", () => {
    const r = parseSyncArgs("context7");
    expect("error" in r).toBe(true);
  });
});

describe("parseAddArgs", () => {
  it("parses stdio add with command after --", () => {
    const r = parseAddArgs("context7 -- npx -y @upstash/context7-mcp");
    if ("error" in r) throw new Error(r.error);
    expect(r.serverName).toBe("context7");
    expect(r.command).toBe("npx");
    expect(r.commandArgs).toEqual(["-y", "@upstash/context7-mcp"]);
    expect(r.url).toBeUndefined();
  });

  it("parses http add with --url", () => {
    const r = parseAddArgs("api --url https://localhost:3000/mcp --description Local API");
    if ("error" in r) throw new Error(r.error);
    expect(r.serverName).toBe("api");
    expect(r.url).toBe("https://localhost:3000/mcp");
    expect(r.description).toBe("Local API");
    expect(r.command).toBeUndefined();
  });

  it("errors without url or command", () => {
    const r = parseAddArgs("context7");
    expect("error" in r).toBe(true);
  });
});
