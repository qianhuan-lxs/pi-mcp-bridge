// __tests__/resource-tools.test.ts
import { describe, it, expect } from "vitest";
import { resourceNameToToolName, slugifyToolName } from "../resource-tools.ts";

describe("slugifyToolName", () => {
  it("lowercases and replaces unsafe chars with hyphens (preserves underscores and dots)", () => {
    expect(slugifyToolName("read_file")).toBe("read_file");
    expect(slugifyToolName("ReadFile")).toBe("readfile");
    expect(slugifyToolName("search repo")).toBe("search-repo");
    expect(slugifyToolName("a  b")).toBe("a-b");
  });

  it("trims leading/trailing hyphens (but not underscores)", () => {
    expect(slugifyToolName("--leading")).toBe("leading");
    expect(slugifyToolName("trailing--")).toBe("trailing");
    expect(slugifyToolName("---")).toBe("");
    expect(slugifyToolName("__leading")).toBe("__leading");
  });

  it("preserves dots and hyphens", () => {
    expect(slugifyToolName("foo.bar-baz")).toBe("foo.bar-baz");
  });
});

describe("resourceNameToToolName", () => {
  it("replaces non-alphanumeric with underscores and lowercases", () => {
    expect(resourceNameToToolName("file://Users/me/x.txt")).toBe("file_users_me_x_txt");
    expect(resourceNameToToolName("ui://server/tool")).toBe("ui_server_tool");
  });

  it("collapses repeated separators", () => {
    expect(resourceNameToToolName("a//b")).toBe("a_b");
  });

  it("prefixes empty or digit-leading names with `resource`", () => {
    expect(resourceNameToToolName("")).toBe("resource");
    expect(resourceNameToToolName("123abc")).toBe("resource_123abc");
  });
});
