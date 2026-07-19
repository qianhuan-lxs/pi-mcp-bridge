// __tests__/consent-manager.test.ts
import { describe, it, expect } from "vitest";
import { ConsentManager } from "../consent-manager.ts";

describe("ConsentManager", () => {
  it("never requires a prompt in `never` mode", () => {
    const cm = new ConsentManager("never");
    expect(cm.requiresPrompt("any-server")).toBe(false);
    expect(cm.shouldCacheConsent()).toBe(true);
  });

  it("requires a prompt the first time per server in `once-per-server` mode", () => {
    const cm = new ConsentManager("once-per-server");
    expect(cm.requiresPrompt("fs")).toBe(true);
    cm.registerDecision("fs", true);
    expect(cm.requiresPrompt("fs")).toBe(false);
    expect(cm.shouldCacheConsent()).toBe(true);
  });

  it("always requires a prompt in `always` mode and does not cache", () => {
    const cm = new ConsentManager("always");
    cm.registerDecision("fs", true);
    expect(cm.requiresPrompt("fs")).toBe(true);
    expect(cm.shouldCacheConsent()).toBe(false);
  });

  it("denied servers keep requiring a prompt", () => {
    const cm = new ConsentManager("once-per-server");
    cm.registerDecision("fs", false);
    expect(cm.requiresPrompt("fs")).toBe(true);
  });

  it("ensureApproved throws for denied servers", () => {
    const cm = new ConsentManager("once-per-server");
    cm.registerDecision("fs", false);
    expect(() => cm.ensureApproved("fs")).toThrow();
  });

  it("ensureApproved throws for unapproved servers in once-per-server mode", () => {
    const cm = new ConsentManager("once-per-server");
    expect(() => cm.ensureApproved("fs")).toThrow();
  });

  it("ensureApproved is a no-op in never mode", () => {
    const cm = new ConsentManager("never");
    expect(() => cm.ensureApproved("fs")).not.toThrow();
  });

  it("clear(serverName) only clears that server", () => {
    const cm = new ConsentManager("once-per-server");
    cm.registerDecision("a", true);
    cm.registerDecision("b", true);
    cm.clear("a");
    expect(cm.requiresPrompt("a")).toBe(true);
    expect(cm.requiresPrompt("b")).toBe(false);
  });

  it("clear() clears everything", () => {
    const cm = new ConsentManager("once-per-server");
    cm.registerDecision("a", true);
    cm.registerDecision("b", true);
    cm.clear();
    expect(cm.requiresPrompt("a")).toBe(true);
    expect(cm.requiresPrompt("b")).toBe(true);
  });

  it("registerDecision overrides a previous decision", () => {
    const cm = new ConsentManager("once-per-server");
    cm.registerDecision("fs", false);
    cm.registerDecision("fs", true);
    expect(cm.requiresPrompt("fs")).toBe(false);
  });
});
