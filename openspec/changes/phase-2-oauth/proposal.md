# Phase 2 — OAuth 2.1

## Proposal

### Scope

Add OAuth 2.1 authentication for HTTP/SSE MCP servers, so `pi-mcp-bridge` can connect to MCP servers that require user-granted authorization (e.g. GitHub, Google Drive, Notion) without the user hand-rolling a bearer token.

### Motivation

Phase 1 supports `auth.kind: "bearer"` with a literal token or an env-var name. This works for personal-access tokens but not for servers that:

- Issue short-lived tokens (so a static token goes stale).
- Require per-user consent (so one shared token violates least-privilege).
- Use dynamic client registration (so there's no pre-provisioned `clientId`).

OAuth 2.1 (the MCP spec's default auth) covers all three. This phase adds the missing pieces while keeping Phase 1's bearer path as a fast path for tokens the user already has.

### In scope

- `auth.kind: "oauth"` in `meta.json` with `grantType: "authorization_code" | "client_credentials"`.
- Dynamic Client Registration (RFC 7591) when the server's `meta.json` advertises `oauth.registrationUrl`.
- PKCE (S256) for every authorization-code flow.
- Local loopback redirect server (`http://127.0.0.1:<port>/callback`) to receive the auth code.
- Token endpoint exchange, refresh-token rotation, and a persistent token cache (in `metadata-cache`).
- A `pi-mcp-bridge login <server>` CLI command that runs the flow out-of-band and stores the resulting token.
- Re-auth on 401 from the MCP server: detect, refresh, retry once.

### Out of scope

- Sampling and elicitation (Phases 3 and 4).
- Non-loopback redirect bindings (e.g. custom URL schemes) — loopback only for Phase 2.
- Token revocation UI — tokens are stored in `metadata-cache` and can be cleared with `pi-mcp-bridge logout <server>`.

### Impact

- `meta.json` schema: `auth.kind: "oauth"` already reserved in Phase 1; this phase populates the fields.
- `server-manager.ts`: add OAuth handshake on first connect for `oauth` servers.
- `metadata-cache.ts`: add an encrypted token store.
- `cli.ts`: add `login` and `logout` subcommands.
- New module: `oauth-flow.ts` (PKCE, DCR, token exchange, refresh).
- New module: `oauth-callback-server.ts` (loopback redirect receiver).

### Open questions

- Should tokens be encrypted at rest with a key derived from the OS keychain, or stored plaintext in `metadata-cache` like npx resolution cache? Leaning toward OS keychain (macOS Keychain / Linux libsecret / Windows Credential Manager) for the interview story.
- Should we support `client_credentials` for server-to-server MCP, or only `authorization_code` for Phase 2? Leaning toward both, since `client_credentials` is a strict subset.
