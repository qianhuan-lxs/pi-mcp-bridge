import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "index.ts",
        "call-mcp-tool.ts",
        "fetch-mcp-resource.ts",
        "context-injector.ts",
        "registry/**/*.ts",
        "server-manager.ts",
        "metadata-cache.ts",
        "tool-metadata.ts",
      ],
    },
  },
});
