import type { MessageKey } from './i18n'

// 本地 MCP 服务的客户端配置模板：设置页按客户端生成一份可直接粘贴的配置。
// 端点固定为本机回环，鉴权统一走 Authorization: Bearer <token>；令牌由调用方
// 决定传明文（复制到剪贴板）还是掩码（上屏展示），模板本身不关心。
//
// 各客户端形状（2026-11 官方文档核对）：
// - Claude Code / Cursor：mcpServers + type: "http" + url + headers。Claude Code
//   的 type 是必需项（只有 url 会被当成 stdio 配置跳过）；Cursor 的 IDE 忽略
//   type、CLI 只认 "http" / "sse"，带 "http" 两边都能用。
// - VS Code：走当前 Copilot harness 的 mcpServers（与旧 .vscode/mcp.json 的
//   servers 格式不同——后者属于 2027-02 将移除的 Local harness），tools 显式
//   声明 ["*"] 暴露全部工具。
// - Codex CLI：TOML 而非 JSON，[mcp_servers.polaris] + url + http_headers。
export type McpClientId = 'claude' | 'cursor' | 'vscode' | 'codex'

export type McpClientTemplate = {
  id: McpClientId
  /** 客户端名（品牌名中英一致，仍走词典，保证界面文案只有一个来源）。 */
  labelKey: MessageKey
  /** 配置该放哪儿的单行提示（文件路径 + 作用域）。 */
  pathKey: MessageKey
  /** 用给定令牌生成完整配置文本；token 可以是明文，也可以是掩码。 */
  build: (endpoint: string, token: string) => string
}

function httpServer(endpoint: string, token: string) {
  return {
    type: 'http',
    url: endpoint,
    headers: { Authorization: `Bearer ${token}` }
  }
}

function jsonConfig(endpoint: string, token: string, tools?: string[]): string {
  const server = { ...httpServer(endpoint, token), ...(tools ? { tools } : {}) }
  return JSON.stringify({ mcpServers: { polaris: server } }, null, 2)
}

/** 配置块里的固定短掩码：sk- + 头 4 + 5 个星号 + 尾 4（用户 2026-11-27 指定）。
    只用于屏幕展示；复制路径使用完整令牌。无 sk- 前缀的旧 token 不补前缀。 */
export function maskMcpTokenForDisplay(token: string): string {
  const prefix = token.startsWith('sk-') ? 'sk-' : ''
  return `${prefix}${token.slice(prefix.length, prefix.length + 4)}*****${token.slice(-4)}`
}

export const MCP_CLIENT_TEMPLATES: McpClientTemplate[] = [
  {
    id: 'claude',
    labelKey: 'settings.mcpClientClaude',
    pathKey: 'settings.mcpClientClaudePath',
    build: (endpoint, token) => jsonConfig(endpoint, token)
  },
  {
    id: 'cursor',
    labelKey: 'settings.mcpClientCursor',
    pathKey: 'settings.mcpClientCursorPath',
    build: (endpoint, token) => jsonConfig(endpoint, token)
  },
  {
    id: 'vscode',
    labelKey: 'settings.mcpClientVscode',
    pathKey: 'settings.mcpClientVscodePath',
    build: (endpoint, token) => jsonConfig(endpoint, token, ['*'])
  },
  {
    id: 'codex',
    labelKey: 'settings.mcpClientCodex',
    pathKey: 'settings.mcpClientCodexPath',
    // 端点与令牌都是受控值（固定回环 URL + hex 令牌），无需再做 TOML 转义。
    build: (endpoint, token) =>
      `[mcp_servers.polaris]\nurl = "${endpoint}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`
  }
]