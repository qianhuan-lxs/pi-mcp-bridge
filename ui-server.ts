// ui-server.ts - Local HTTP server hosting MCP UI iframes.
//
// Ported from pi-mcp-adapter (simplified for Phase 1). Each UI session
// gets a unique token; the host HTML page at `/s/<token>` is served from
// `host-html-template.ts`. The iframe inside that page calls back into
// the server's `/proxy/*` endpoints to forward tool calls, messages,
// and context updates to the bridge.
//
// The server also serves the vendored `app-bridge.bundle.js` so the
// iframe can load the MCP SDK + Zod without a CDN.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerManager } from "./server-manager.ts";
import type { ConsentManager } from "./consent-manager.ts";
import type { SendMessageFn } from "./state.ts";
import { logger } from "./logger.ts";

export interface UiServerHandle {
  port: number;
  baseUrl: string;
  close: (reason?: string) => void;
}

interface SessionState {
  token: string;
  serverName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  html: string;
  consentManager: ConsentManager;
  onMessage: (msg: Record<string, unknown>) => void;
  onDone: () => void;
  onCancel: () => void;
}

const APP_BRIDGE_PATH = "/app-bridge.bundle.js";

export function startUiServer(options: {
  manager: McpServerManager;
  consentManager: ConsentManager;
  onMessage?: SendMessageFn;
  port?: number;
}): UiServerHandle {
  const sessions = new Map<string, SessionState>();
  const server = createServer((req, res) => handleRequest(req, res, sessions, options.manager));
  const port = options.port ?? 0;
  server.listen(port, "127.0.0.1");
  const actualPort = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  logger.info(`UI server listening on ${baseUrl}`);

  return {
    port: actualPort,
    baseUrl,
    close: (reason) => {
      logger.info(`UI server closing (${reason ?? "shutdown"})`);
      server.close();
    },
  };
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, SessionState>,
  manager: McpServerManager,
): void {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === APP_BRIDGE_PATH) {
    serveAppBridge(res);
    return;
  }
  if (req.method === "GET" && url.startsWith("/s/")) {
    const token = url.slice("/s/".length);
    const session = sessions.get(token);
    if (!session) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("session not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(session.html);
    return;
  }
  if (req.method === "POST" && url.startsWith("/proxy/")) {
    handleProxy(req, res, sessions, manager, url.slice("/proxy/".length));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

function serveAppBridge(res: ServerResponse): void {
  const path = resolveAppBridgePath();
  if (!path || !existsSync(path)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("app-bridge.bundle.js not found");
    return;
  }
  const body = readFileSync(path);
  res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
  res.end(body);
}

function resolveAppBridgePath(): string {
  // Same directory as this module (the bundled file lives next to the
  // compiled output).
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "app-bridge.bundle.js");
  } catch {
    return join(process.cwd(), "app-bridge.bundle.js");
  }
}

async function handleProxy(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, SessionState>,
  manager: McpServerManager,
  endpoint: string,
): Promise<void> {
  const body = await readJsonBody(req);
  const token = (body as { token?: string })?.token;
  const params = (body as { params?: Record<string, unknown> })?.params ?? {};
  if (!token || !sessions.has(token)) {
    sendJson(res, 400, { ok: false, error: "invalid or missing token" });
    return;
  }
  const session = sessions.get(token)!;

  try {
    switch (endpoint) {
      case "ui/consent": {
        const approved = params.approved === true;
        session.consentManager.registerDecision(session.serverName, approved);
        sendJson(res, 200, { ok: true, result: { approved } });
        return;
      }
      case "ui/message": {
        session.onMessage(params);
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      case "ui/context":
      case "ui/download-file":
      case "ui/open-link":
      case "ui/request-display-mode": {
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      case "ui/done": {
        session.onDone();
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      case "ui/cancel": {
        session.onCancel();
        sendJson(res, 200, { ok: true, result: {} });
        return;
      }
      case "tools/call": {
        const name = (params as { name?: string }).name;
        const args = (params as { arguments?: Record<string, unknown> }).arguments ?? {};
        if (!name) {
          sendJson(res, 400, { ok: false, error: "missing tool name" });
          return;
        }
        try {
          const result = await manager.callTool(session.serverName, {
            name,
            arguments: args,
          });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      default:
        sendJson(res, 404, { ok: false, error: `unknown endpoint: ${endpoint}` });
    }
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
