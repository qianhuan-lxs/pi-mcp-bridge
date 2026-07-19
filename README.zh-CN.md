# pi-mcp-bridge

> 一个 [Pi Agent](https://pi.dev/docs/latest/extensions) 扩展，把任意 [Model Context Protocol](https://modelcontextprotocol.io/)（MCP）服务器桥接进 Pi，**只暴露两个 LLM 可调用的工具** —— `CallMcpTool` 与 `FetchMcpResource` —— 并通过一个**以文件系统为单一事实源的注册表**让上下文窗口保持廉价。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.19-green.svg)](./package.json)
[![Specs: OpenSpec](https://img.shields.io/badge/OpenSpec-phase--1--core-orange)](./openspec/)

**English** · [简体中文](./README.zh-CN.md)

---

## 为什么做这个

Cursor 的 [Dynamic Context Discovery](https://cursor.com/cn/blog/dynamic-context-discovery) 一文提出了一个尖锐的观察：把每个 MCP 工具都直接暴露给 LLM，会让系统提示膨胀、烧光上下文。解法是**只暴露两个通用工具**，让模型按需从一份紧凑、可发现的注册表里读取具体工具的 schema。

`pi-mcp-bridge` 把这个模式带到 Pi Agent：

- **`CallMcpTool`** —— 通过 `server` + `toolName` + `arguments` 调用任意 MCP 工具。
- **`FetchMcpResource`** —— 通过 `server` + `uri` 读取任意 MCP 资源，可选保存到磁盘。
- **Filesystem is everything** —— 每个 MCP 服务器由 `registry/<server>/meta.json` + `registry/<server>/tools/<tool>.json` 描述。模型读取这些文件来学习*如何*调用工具，再用正确参数调用 `CallMcpTool`。
- **Cheap context** —— 在 `session_start` 时，把注册表的一份紧凑 Markdown 索引注入系统提示；完整工具 schema 留在磁盘上，模型需要时再读。
- **Lazy by default** —— MCP 服务器只在工具被调用时才连接，空闲超过可配置阈值后自动断开。
- **No vendor lock-in** —— 注册表是纯 JSON。可以 `git diff`、手改，或用 `pi-mcp-bridge sync` 从一个在线 MCP 服务器生成。

## 架构（60 秒速览）

```
┌──────────────────────────────────────────────────────────────────┐
│  Pi Agent (LLM)                                                  │
│    system prompt  ◀──  注入的上下文块（紧凑索引）                  │
│    tools: [CallMcpTool, FetchMcpResource]                        │
└───────────────┬──────────────────────────────────────────────────┘
                │ CallMcpTool({server, toolName, arguments})
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  pi-mcp-bridge                                                   │
│   1. 解析 (server, toolName) → registry/<server>/tools/*.json     │
│   2. 懒连接到对应 MCP 服务器（空闲超时）                          │
│   3. 转发参数，等待结果                                           │
│   4. 输出守卫：截断 + 溢出到临时文件                               │
│   5. 把 ContentBlocks 返回给 Pi                                   │
└───────────────┬──────────────────────────────────────────────────┘
                │ MCP 协议（stdio / HTTP / SSE）
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  MCP 服务器（filesystem、github、slack……）                        │
└──────────────────────────────────────────────────────────────────┘
```

完整模块图、设计决策与行为契约见 [`docs/architecture.zh-CN.md`](./docs/architecture.zh-CN.md)。

## 快速开始

### 1. 安装

```bash
pi install npm:@qianhuan-lxs/pi-mcp-bridge
```

这会把包装到 `~/.pi/agent/npm/` 下,并通过包里的 `pi.extensions` manifest 自动注册扩展 —— 不用手动改配置。

> **注意:** `pi install` 需要 Pi v0.74+。如果你用的是旧版 Pi,或想手动管理,把 `"@qianhuan-lxs/pi-mcp-bridge"` 加到 `~/.pi/agent/settings.json` 的 `packages` 数组里即可。

### 2. 注册扩展

在 Pi agent 配置（如 `~/.pi/agent.json`）里加入：

```jsonc
{
  "extensions": [
    "pi-mcp-bridge"
  ]
}
```

### 3. 往注册表里添加一个 MCP 服务器

```bash
# 从一个在线 MCP 服务器同步它的工具到注册表
npx pi-mcp-bridge sync filesystem -- npx -y @modelcontextprotocol/server-filesystem /Users/me

# 或者手动添加一个服务器，自己写它的工具描述
npx pi-mcp-bridge add github --env GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx -- npx -y @modelcontextprotocol/server-github
```

会生成：

```
~/.pi/agent/mcp-bridge/registry/
  filesystem/
    meta.json
    tools/
      read_file.json
      list_files.json
      ...
  index.json
```

### 4. 重启 Pi 并提问

```
> 用 filesystem MCP 列出我 home 目录下的文件
```

模型会：

1. 从系统提示里读取注入的注册表索引。
2. 读取 `registry/filesystem/tools/list_files.json` 学习 schema。
3. 调用 `CallMcpTool({server:"filesystem", toolName:"list_files", arguments:{path:"/Users/me"}})`。
4. 收到结果（过大时截断，完整内容溢出到临时文件）。

## 注册表布局

```
registry/
  <server>/
    meta.json          # 服务器配置：command、env、transport、超时
    tools/
      <tool>.json      # 每个工具一个文件：name、description、inputSchema
  index.json           # 聚合索引（由 sync / validate 重建）
```

`meta.json` 示例：

```json
{
  "name": "filesystem",
  "transport": {
    "kind": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"],
    "env": {}
  },
  "auth": { "kind": "none" },
  "lifecycle": { "mode": "lazy", "idleTimeoutMinutes": 10 }
}
```

`tools/read_file.json` 示例：

```json
{
  "name": "read_file",
  "description": "Read a file from the filesystem.",
  "inputSchema": {
    "type": "object",
    "properties": { "path": { "type": "string" } },
    "required": ["path"]
  }
}
```

完整 schema 参考：[`docs/config-format.zh-CN.md`](./docs/config-format.zh-CN.md)。

## 命令行

```bash
npx pi-mcp-bridge <command>

Commands:
  sync <server> -- <command>     连接一个在线 MCP 服务器，把它的
                                 meta.json + tools/*.json 写进注册表。
  validate                       按照JSON Schema 校验注册表，
                                 并重建 index.json。
  add <server> [--env K=V]... -- <command>
                                 添加一个服务器桩（只写 meta.json）；
                                 之后用 `sync` 抓取它的工具描述。
  list                           列出注册表里所有服务器及其工具。
```

## 配置

`~/.pi/agent/mcp-bridge.json`：

```jsonc
{
  "registryRoot": "~/.pi/agent/mcp-bridge/registry",  // 默认值
  "idleTimeout": 10,                                  // 秒，默认 10
  "requestTimeoutMs": 60000,                          // 默认 60s
  "contextBudgetChars": 6000,                          // 注入索引的大小
  "uiViewer": "auto"                                   // "auto" | "browser" | "glimpse"
}
```

## OpenSpec

本项目用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 做规格驱动开发。参见：

- [`openspec/project.md`](./openspec/project.md) —— 项目高层背景与原则。
- [`openspec/specs/`](./openspec/specs/) —— 行为契约（"做什么"）。
- [`openspec/changes/phase-1-core/`](./openspec/changes/phase-1-core/) —— Phase 1 提案、设计与任务清单（"怎么做"和"何时做"）。

### 路线图

| 阶段 | 范围 | 状态 |
|------|------|------|
| 1 — 核心 | 两个工具、文件系统注册表、上下文注入、懒连接、输出守卫、UI 集成 | ✅ 本次发布 |
| 2 — OAuth | OAuth 2.1 流程、动态客户端注册、PKCE | 📋 已提案 |
| 3 — Sampling | 服务器发起的 `sampling/createMessage` | 📋 已提案 |
| 4 — Elicitation | 服务器发起的 `elicitation/create` | 📋 已提案 |

## License

MIT © 2026 [qianhuan-lxs](https://github.com/qianhuan-lxs)
