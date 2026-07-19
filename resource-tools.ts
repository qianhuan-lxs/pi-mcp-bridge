// resource-tools.ts - MCP resource name utilities

/**
 * Convert an arbitrary MCP resource name into a safe tool-name slug.
 *
 * Used when exposing MCP resources as `FetchMcpResource` targets: the
 * registry stores the original URI, but we also derive a short slug for
 * listing in the context index.
 */
export function resourceNameToToolName(name: string): string {
  let result = name
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .toLowerCase();

  if (!result || /^\d/.test(result)) {
    result = "resource" + (result ? "_" + result : "");
  }

  return result;
}

/**
 * Slugify a tool name for use as a filename under `tools/`.
 *
 * The original MCP tool name is preserved inside the JSON file's `name`
 * field; the filename is just a filesystem-safe key. `read_file` and
 * `read-file` both slug to `read-file`.
 */
export function slugifyToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
