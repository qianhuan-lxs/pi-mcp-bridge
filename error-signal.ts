/** Result `details.error` codes that should appear as Pi tool failures. */
const ERROR_CODES = new Set([
  "tool_error",
  "call_failed",
  "connect_failed",
  "server_not_found",
  "tool_not_found",
  "auth_required",
  "consent_required",
  "not_initialized",
]);

/**
 * Decide the `isError` override for a finished tool result in the `tool_result` hook.
 *
 * A failed MCP tool call is *returned* (not thrown). Pi never reads a
 * result-level `isError`, so without this such a call is recorded as a
 * success. Returning `{ isError: true }` (and nothing else) flips the flag;
 * Pi's field-by-field merge keeps the original `content` and `details`
 * intact.
 */
export function toolErrorOverride(details: unknown): { isError: true } | undefined {
  if (details && typeof details === "object" && "error" in details) {
    const code = (details as { error?: unknown }).error;
    if (typeof code === "string" && ERROR_CODES.has(code)) {
      return { isError: true };
    }
  }
  return undefined;
}
