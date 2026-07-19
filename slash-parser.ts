// slash-parser.ts - Parse /mcp-bridge subcommand arguments.
//
// Format:
//   /mcp-bridge sync <server> [--env K=V | --env K]... [--force] -- <command> [args...]
//   /mcp-bridge add <server> [--env K=V]... -- <command> [args...]
//   /mcp-bridge add <server> --url <url> [--description <d>]
//   /mcp-bridge validate
//   /mcp-bridge list
//   /mcp-bridge status
//   /mcp-bridge reload

export interface ParsedSyncArgs {
  serverName: string;
  command: string;
  commandArgs: string[];
  env: Record<string, string>;
  force: boolean;
}

export interface ParsedAddArgs {
  serverName: string;
  command?: string;
  commandArgs: string[];
  url?: string;
  env: Record<string, string>;
  description?: string;
}

function splitOnDoubleDash(tokens: string[]): { left: string[]; right: string[] } {
  const idx = tokens.indexOf("--");
  if (idx < 0) return { left: tokens, right: [] };
  return { left: tokens.slice(0, idx), right: tokens.slice(idx + 1) };
}

function parseEnvValue(pair: string): [string, string] {
  const eq = pair.indexOf("=");
  if (eq < 0) return [pair, `\${env.${pair}}`];
  return [pair.slice(0, eq), pair.slice(eq + 1)];
}

export function parseSyncArgs(args: string): ParsedSyncArgs | { error: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const { left, right } = splitOnDoubleDash(tokens);

  const serverName = left[0];
  if (!serverName) {
    return { error: "Usage: /mcp-bridge sync <server> [--env K=V]... [--force] -- <command> [args...]" };
  }

  const env: Record<string, string> = {};
  let force = false;
  for (let i = 1; i < left.length; i++) {
    const t = left[i];
    if (t === "--force") {
      force = true;
    } else if (t === "--env") {
      const next = left[++i];
      if (!next) return { error: "--env requires a K=V argument" };
      const [k, v] = parseEnvValue(next);
      env[k] = v;
    } else if (t.startsWith("--env=")) {
      const [k, v] = parseEnvValue(t.slice("--env=".length));
      env[k] = v;
    } else {
      return { error: `Unknown option: ${t}` };
    }
  }

  if (right.length === 0) {
    return { error: "sync requires a command after `--` (e.g. `/mcp-bridge sync context7 -- npx -y @upstash/context7-mcp`)" };
  }

  return { serverName, command: right[0], commandArgs: right.slice(1), env, force };
}

export function parseAddArgs(args: string): ParsedAddArgs | { error: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const { left, right } = splitOnDoubleDash(tokens);

  const serverName = left[0];
  if (!serverName) {
    return { error: "Usage: /mcp-bridge add <server> [--env K=V]... -- <command> [args...]  OR  /mcp-bridge add <server> --url <url>" };
  }

  const env: Record<string, string> = {};
  let url: string | undefined;
  let description: string | undefined;
  for (let i = 1; i < left.length; i++) {
    const t = left[i];
    if (t === "--env") {
      const next = left[++i];
      if (!next) return { error: "--env requires a K=V argument" };
      const [k, v] = parseEnvValue(next);
      env[k] = v;
    } else if (t.startsWith("--env=")) {
      const [k, v] = parseEnvValue(t.slice("--env=".length));
      env[k] = v;
    } else if (t === "--url") {
      url = left[++i];
      if (!url) return { error: "--url requires a value" };
    } else if (t.startsWith("--url=")) {
      url = t.slice("--url=".length);
    } else if (t === "--description") {
      description = left.slice(i + 1).join(" ");
      if (!description) return { error: "--description requires a value" };
      i = left.length;
    } else if (t.startsWith("--description=")) {
      description = t.slice("--description=".length);
    } else {
      return { error: `Unknown option: ${t}` };
    }
  }

  if (!url && right.length === 0) {
    return { error: "add requires either --url <url> or a command after `--`" };
  }

  return {
    serverName,
    command: right[0],
    commandArgs: right.slice(1),
    url,
    env,
    description,
  };
}
