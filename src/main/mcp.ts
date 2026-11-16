import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import type { McpState, Task } from '../shared/types'
import {
  createTask,
  deleteTask,
  getMeta,
  listProjects,
  listTags,
  listTasks,
  setMeta,
  toggleTask,
  updateTask
} from './db'

// 本地 MCP 服务的唯一所有者。只绑 127.0.0.1，默认关（opt-in）：暴露任务读写
// 能力必须用户明确同意。meta 记意图，running 记实际监听状态，端口被占用时
// 开关仍是开、error 给出中文原因（同全局热键的 enabled/registered 分离）。
//
// 工具直接调 db 函数：重复继承、软删除、completed_at 盖章与界面完全一致，
// 零逻辑复制，也不引入第二个 SQLite 连接。协议是 MCP Streamable HTTP
// （2025-03-26）的无状态子集：POST /mcp 收 JSON-RPC，通知回 202，
// GET 回 405（不提供 SSE 流）。应用退出服务即停——Polaris 常驻托盘是常态。

export const MCP_PORT = 3737
export const MCP_ENDPOINT = `http://127.0.0.1:${MCP_PORT}/mcp`
const META_KEY = 'mcp_enabled'
const PROTOCOL_VERSION = '2025-03-26'
const MAX_BODY = 1024 * 1024

let server: Server | null = null
let running = false
let lastError: string | null = null

function enabledInMeta(): boolean {
  // 默认关：只有明确写过 '1' 才算用户打开了它。
  return getMeta(META_KEY) === '1'
}

function state(): McpState {
  return {
    enabled: enabledInMeta(),
    running,
    endpoint: MCP_ENDPOINT,
    ...(lastError ? { error: lastError } : {})
  }
}

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type ToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => unknown
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

function findTask(id: string): Task {
  const task = listTasks().find((candidate) => candidate.id === id)
  if (!task) throw new Error(`任务不存在：${id}`)
  return task
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_tasks',
    description: '列出任务。scope: active（默认）/ completed / all；可按 projectId 或 tagId 过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['active', 'completed', 'all'] },
        projectId: { type: 'string' },
        tagId: { type: 'string' }
      }
    },
    run: (args) => {
      const scope = str(args.scope) ?? 'active'
      let tasks = listTasks()
      if (scope === 'active') tasks = tasks.filter((task) => !task.completed)
      if (scope === 'completed') tasks = tasks.filter((task) => task.completed)
      const projectId = str(args.projectId)
      if (projectId) tasks = tasks.filter((task) => task.projectId === projectId)
      const tagId = str(args.tagId)
      if (tagId) tasks = tasks.filter((task) => task.tags.some((tag) => tag.id === tagId))
      return tasks
    }
  },
  {
    name: 'get_task',
    description: '按 id 读取单个任务（含子任务计数与标签）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    run: (args) => findTask(str(args.id) ?? '')
  },
  {
    name: 'create_task',
    description: '新建任务。dueAt 用 ISO 8601；priority 0-3（0 无 1 低 2 中 3 高）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        dueAt: { type: 'string' },
        projectId: { type: 'string' },
        priority: { type: 'number', enum: [0, 1, 2, 3] }
      },
      required: ['title']
    },
    run: (args) => {
      const title = str(args.title)
      if (!title) throw new Error('title 不能为空')
      const task = createTask({
        title: title.slice(0, 500),
        dueAt: str(args.dueAt) ?? null,
        projectId: str(args.projectId) ?? null,
        priority: num(args.priority) ?? 0
      })
      const notes = str(args.notes)
      return notes ? updateTask({ id: task.id, notes }) : task
    }
  },
  {
    name: 'update_task',
    description: '更新任务字段。tagIds 是替换式语义：传完整目标标签集合。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        dueAt: { type: ['string', 'null'] },
        priority: { type: 'number', enum: [0, 1, 2, 3] },
        tagIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['id']
    },
    run: (args) => {
      const id = str(args.id)
      if (!id) throw new Error('id 不能为空')
      findTask(id)
      const patch: Record<string, unknown> = { id }
      const title = str(args.title)
      if (title) patch.title = title.slice(0, 500)
      if (typeof args.notes === 'string') patch.notes = args.notes
      if (args.dueAt === null || typeof args.dueAt === 'string') patch.dueAt = args.dueAt
      const priority = num(args.priority)
      if (priority !== undefined) patch.priority = priority
      if (Array.isArray(args.tagIds)) patch.tagIds = args.tagIds.filter((item): item is string => typeof item === 'string')
      return updateTask(patch as Parameters<typeof updateTask>[0])
    }
  },
  {
    name: 'complete_task',
    description: '完成或取消完成任务。重复任务完成时会自动生成下一次实例（与界面一致）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        completed: { type: 'boolean' }
      },
      required: ['id']
    },
    run: (args) => {
      const id = str(args.id)
      if (!id) throw new Error('id 不能为空')
      findTask(id)
      return toggleTask(id, bool(args.completed) ?? true)
    }
  },
  {
    name: 'delete_task',
    description: '软删除任务（进回收站，30 天内可恢复）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    run: (args) => {
      const id = str(args.id)
      if (!id) throw new Error('id 不能为空')
      findTask(id)
      deleteTask(id)
      return { deleted: id }
    }
  },
  {
    name: 'list_projects',
    description: '列出全部项目。',
    inputSchema: { type: 'object', properties: {} },
    run: () => listProjects()
  },
  {
    name: 'list_tags',
    description: '列出全部标签。',
    inputSchema: { type: 'object', properties: {} },
    run: () => listTags()
  }
]

function rpcResult(id: string | number | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result })
}

function rpcError(id: string | number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

function handleRequest(request: JsonRpcRequest): { status: number; body: string | null } {
  const id = request.id ?? null
  const isNotification = request.id === undefined || request.id === null
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return { status: 200, body: rpcError(id, -32600, 'Invalid Request') }
  }
  const method = request.method
  if (method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }
  if (isNotification) return { status: 202, body: null }

  switch (method) {
    case 'initialize':
      return {
        status: 200,
        body: rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'polaris', version: app.getVersion() }
        })
      }
    case 'ping':
      return { status: 200, body: rpcResult(id, {}) }
    case 'tools/list':
      return {
        status: 200,
        body: rpcResult(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
        })
      }
    case 'tools/call': {
      const params = request.params ?? {}
      const name = str(params.name)
      const tool = TOOLS.find((candidate) => candidate.name === name)
      if (!tool) return { status: 200, body: rpcError(id, -32602, `未知工具：${name ?? ''}`) }
      const args = (params.arguments ?? {}) as Record<string, unknown>
      try {
        const value = tool.run(args)
        return {
          status: 200,
          body: rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(value) }] })
        }
      } catch (error) {
        return {
          status: 200,
          body: rpcResult(id, {
            content: [{ type: 'text', text: String(error instanceof Error ? error.message : error) }],
            isError: true
          })
        }
      }
    }
    default:
      return { status: 200, body: rpcError(id, -32601, `Method not found: ${method}`) }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function start(): void {
  if (server) return
  const instance = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = (req.url ?? '').split('?')[0]
      if (url !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not Found')
        return
      }
      if (req.method === 'GET') {
        // 无状态子集：不提供 SSE 流。
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Method Not Allowed')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Method Not Allowed')
        return
      }
      let request: JsonRpcRequest
      try {
        request = JSON.parse(await readBody(req)) as JsonRpcRequest
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(rpcError(null, -32700, 'Parse error'))
        return
      }
      const { status, body } = handleRequest(request)
      if (body === null) {
        res.writeHead(status)
        res.end()
        return
      }
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(body)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  instance.on('error', (error: NodeJS.ErrnoException) => {
    running = false
    server = null
    lastError =
      error.code === 'EADDRINUSE'
        ? `端口 ${MCP_PORT} 被其他程序占用`
        : `MCP 服务启动失败：${error.message}`
  })
  instance.listen(MCP_PORT, '127.0.0.1', () => {
    running = true
    lastError = null
  })
  server = instance
}

function stop(): void {
  if (server) {
    server.close()
    server = null
  }
  running = false
}

function apply(): McpState {
  if (!enabledInMeta()) {
    stop()
    lastError = null
    return state()
  }
  start()
  return state()
}

/** app.whenReady() 里调用一次；默认关，只有 meta 写过 '1' 才监听。 */
export function initMcp(): McpState {
  return apply()
}

/** 先落库再启停：端口被占用时用户的「开」仍被记住，下次启动或再点一次会重试。 */
export function setMcpEnabled(enabled: boolean): McpState {
  setMeta(META_KEY, enabled ? '1' : '0')
  return apply()
}

export function getMcpState(): McpState {
  return state()
}

/** will-quit 里调用。 */
export function disposeMcp(): void {
  stop()
}