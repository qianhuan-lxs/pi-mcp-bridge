/**
 * Custom error types for pi-mcp-bridge operations.
 * Provides structured errors with context and recovery hints.
 */

export interface McpBridgeErrorContext {
  server?: string;
  tool?: string;
  uri?: string;
  session?: string;
  [key: string]: unknown;
}

/** Base error class for pi-mcp-bridge errors. */
export class McpBridgeError extends Error {
  readonly code: string;
  readonly context: McpBridgeErrorContext;
  readonly recoveryHint?: string;
  readonly cause?: Error;

  constructor(
    message: string,
    options: {
      code: string;
      context?: McpBridgeErrorContext;
      recoveryHint?: string;
      cause?: Error;
    },
  ) {
    super(message);
    this.name = "McpBridgeError";
    this.code = options.code;
    this.context = options.context ?? {};
    this.recoveryHint = options.recoveryHint;
    this.cause = options.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoveryHint: this.recoveryHint,
      stack: this.stack,
    };
  }
}

/** Error fetching a UI resource from the MCP server. */
export class ResourceFetchError extends McpBridgeError {
  constructor(
    uri: string,
    reason: string,
    options?: { server?: string; cause?: Error },
  ) {
    super(`Failed to fetch UI resource "${uri}": ${reason}`, {
      code: "RESOURCE_FETCH_ERROR",
      context: { uri, server: options?.server },
      recoveryHint: "Check that the MCP server is connected and the resource URI is valid.",
      cause: options?.cause,
    });
    this.name = "ResourceFetchError";
  }
}

/** Error parsing or validating UI resource content. */
export class ResourceParseError extends McpBridgeError {
  constructor(
    uri: string,
    reason: string,
    options?: { server?: string; mimeType?: string },
  ) {
    super(`Invalid UI resource "${uri}": ${reason}`, {
      code: "RESOURCE_PARSE_ERROR",
      context: { uri, server: options?.server, mimeType: options?.mimeType },
      recoveryHint: "Ensure the resource returns valid HTML with the correct MIME type.",
    });
    this.name = "ResourceParseError";
  }
}

/** Error connecting to the AppBridge. */
export class BridgeConnectionError extends McpBridgeError {
  constructor(reason: string, options?: { session?: string; cause?: Error }) {
    super(`AppBridge connection failed: ${reason}`, {
      code: "BRIDGE_CONNECTION_ERROR",
      context: { session: options?.session },
      recoveryHint: "Check browser console for detailed errors. The iframe may have failed to load.",
      cause: options?.cause,
    });
    this.name = "BridgeConnectionError";
  }
}

/** Error related to user consent for tool calls. */
export class ConsentError extends McpBridgeError {
  readonly denied: boolean;

  constructor(
    server: string,
    options: { denied?: boolean; requiresApproval?: boolean },
  ) {
    const message = options.denied
      ? `Tool calls for "${server}" were denied for this session`
      : `Tool call approval required for "${server}"`;

    super(message, {
      code: options.denied ? "CONSENT_DENIED" : "CONSENT_REQUIRED",
      context: { server },
      recoveryHint: options.denied
        ? "The user denied tool access. Start a new session to try again."
        : "Prompt the user for consent before calling tools.",
    });
    this.name = "ConsentError";
    this.denied = options.denied ?? false;
  }
}

/** Error with UI server session management. */
export class SessionError extends McpBridgeError {
  constructor(reason: string, options?: { session?: string; cause?: Error }) {
    super(`Session error: ${reason}`, {
      code: "SESSION_ERROR",
      context: { session: options?.session },
      recoveryHint: "The session may have expired or been closed. Try opening the UI again.",
      cause: options?.cause,
    });
    this.name = "SessionError";
  }
}

/** Error starting or operating the UI server. */
export class ServerError extends McpBridgeError {
  constructor(reason: string, options?: { port?: number; cause?: Error }) {
    super(`UI server error: ${reason}`, {
      code: "SERVER_ERROR",
      context: { port: options?.port },
      recoveryHint: "Check if the port is available. Another process may be using it.",
      cause: options?.cause,
    });
    this.name = "ServerError";
  }
}

/** Error communicating with the MCP server. */
export class McpServerError extends McpBridgeError {
  constructor(
    server: string,
    reason: string,
    options?: { tool?: string; cause?: Error },
  ) {
    super(`MCP server "${server}" error: ${reason}`, {
      code: "MCP_SERVER_ERROR",
      context: { server, tool: options?.tool },
      recoveryHint: "Check that the MCP server is running and responsive.",
      cause: options?.cause,
    });
    this.name = "McpServerError";
  }
}

/** Wrap an unknown error into an McpBridgeError. */
export function wrapError(error: unknown, context?: McpBridgeErrorContext): McpBridgeError {
  if (error instanceof McpBridgeError) {
    return new McpBridgeError(error.message, {
      code: error.code,
      context: { ...error.context, ...context },
      recoveryHint: error.recoveryHint,
      cause: error.cause,
    });
  }

  const cause = error instanceof Error ? error : undefined;
  const message = error instanceof Error ? error.message : String(error);

  return new McpBridgeError(message, {
    code: "UNKNOWN_ERROR",
    context,
    cause,
  });
}

/** Check if an error is a specific pi-mcp-bridge error type. */
export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof McpBridgeError && error.code === code;
}
