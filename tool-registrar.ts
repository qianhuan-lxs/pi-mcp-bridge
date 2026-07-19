// tool-registrar.ts - MCP content → Pi content block transforms.
//
// Ported from pi-mcp-adapter. In the bridge there is no proxy tool and
// no per-tool registration with Pi — only `CallMcpTool` and
// `FetchMcpResource` are registered. This module is used by the wrapper
// tools to map MCP `CallToolResult.content` into Pi `ContentBlock[]`.

import type { McpContent, ContentBlock } from "./types.ts";

/** Transform MCP content types to Pi content blocks. */
export function transformMcpContent(content: McpContent[]): ContentBlock[] {
  return content.map(c => {
    if (c.type === "text") {
      return { type: "text" as const, text: c.text ?? "" };
    }
    if (c.type === "image") {
      return {
        type: "image" as const,
        data: c.data ?? "",
        mimeType: c.mimeType ?? "image/png",
      };
    }
    if (c.type === "resource") {
      const resourceUri = c.resource?.uri ?? "(no URI)";
      const resourceContent = c.resource?.text ?? (c.resource ? JSON.stringify(c.resource) : "(no content)");
      return {
        type: "text" as const,
        text: `[Resource: ${resourceUri}]\n${resourceContent}`,
      };
    }
    if (c.type === "resource_link") {
      const linkName = c.name ?? c.uri ?? "unknown";
      const linkUri = c.uri ?? "(no URI)";
      return {
        type: "text" as const,
        text: `[Resource Link: ${linkName}]\nURI: ${linkUri}`,
      };
    }
    if (c.type === "audio") {
      return {
        type: "text" as const,
        text: `[Audio content: ${c.mimeType ?? "audio/*"}]`,
      };
    }
    return { type: "text" as const, text: JSON.stringify(c) };
  });
}

/** Resolve a tool result's content blocks, falling back to `structuredContent` when content is empty. */
export function resolveMcpResultContent(result: Record<string, unknown>): ContentBlock[] {
  const blocks = transformMcpContent(
    (Array.isArray(result.content) ? result.content : []) as McpContent[],
  );
  if (blocks.length > 0) return blocks;

  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return [{ type: "text" as const, text: stringifyStructuredContent(result.structuredContent) }];
  }

  return [];
}

function stringifyStructuredContent(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
