import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { z } from 'zod'
import type { McpState, Task } from '../shared/types'
import {
  createTask,
  deleteTask,
  getMeta,
  getTask,
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
//
// 网络暴露面防线（无 token，不破坏既有客户端配置）：带 Origin 的请求一律
// 403（浏览器发起的铁证）；Host 必须是回环字面量（挡 DNS rebinding）；
// POST 必须 application/json（挡简单请求 CSRF）。入参经 zod 校验，
// 约束与 ipc.ts 正门一致。信任边界仍是「本机进程」，不假装已鉴权。

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

// 入参校验对齐 IPC 正门（ipc.ts 的 zod 标准）：两条写入路径同一套约束——
// title 非空且 ≤500、notes ≤20000、dueAt 必须 Date.parse 有效、priority 0-3
// 整数、tagIds ≤50 个非空字符串。非法入参拒绝（isError 工具结果），不静默
// 截断/夹取——与 tasks:create / tasks:update 的拒绝语义一致。
const dateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日期无效')

const createTaskArgs = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(20000).optional(),
  dueAt: dateTimeSchema.nullable().optional(),
  projectId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional()
})

const updateTaskArgs = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(20000).optional(),
  dueAt: dateTimeSchema.nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  tagIds: z.array(z.string().min(1)).max(50).optional()
})

const taskIdArgs = z.object({ id: z.string().min(1) })

const completeTaskArgs = z.object({
  id: z.string().min(1),
  completed: z.boolean().optional()
})

function parseArgs<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const result = schema.safeParse(args)
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
        .join('; ')
    )
  }
  return result.data
}

// 按 id 直查（db.getTask 过滤软删行，与旧 listTasks().find 同语义），
// 不再每次全表扫描。
function findTask(id: string): Task {
  const task = getTask(id)
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
    run: (args) => findTask(parseArgs(taskIdArgs, args).id)
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
      const input = parseArgs(createTaskArgs, args)
      const task = createTask({
        title: input.title,
        dueAt: input.dueAt ?? null,
        projectId: input.projectId ?? null,
        priority: input.priority ?? 0
      })
      // updateTask 返回 { task, spawned }：这里只取 Task，保证 create_task
      // 带不带 notes 的返回形状一致（旧实现带 notes 时会漏出内部结构）。
      return input.notes ? updateTask({ id: task.id, notes: input.notes }).task : task
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
      const input = parseArgs(updateTaskArgs, args)
      findTask(input.id)
      // zod object 默认剥掉未知键：与 IPC 一样只接受声明过的字段。
      return updateTask(input)
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
      const input = parseArgs(completeTaskArgs, args)
      findTask(input.id)
      return toggleTask(input.id, input.completed ?? true)
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
      const { id } = parseArgs(taskIdArgs, args)
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

// DNS rebinding 防线：Host 必须是本机回环字面量（端口以实际监听为准）。
// 攻击者把 evil.example 解析到 127.0.0.1 时，浏览器发出的 Host 仍是
// evil.example:3737——在这里被拒，读不到任何任务数据。
const ALLOWED_HOSTS = [
  `127.0.0.1:${MCP_PORT}`,
  `localhost:${MCP_PORT}`,
  `[::1]:${MCP_PORT}`
]

function start(): void {
  if (server) return
  const instance = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      // 浏览器发起的铁证：合法 MCP 客户端（CLI/桌面进程）不发 Origin，
      // 带 Origin 的一律 403——恶意网页的简单请求在这里被挡下。
      if (req.headers.origin !== undefined) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Forbidden')
        return
      }
      const host = (req.headers.host ?? '').toLowerCase()
      if (!ALLOWED_HOSTS.includes(host)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Forbidden')
        return
      }
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
      // POST 必须显式 application/json：text/plain 等「简单请求」不触发
      // CORS 预检，是网页盲写（CSRF）的唯一通道——415 拒绝，且不读 body。
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Unsupported Media Type')
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
    // 出错即关：只置空引用不 close 会泄漏底层句柄（监听中的 server 出错时
    // 仍持有端口/连接）。带回调的 close 吞掉「未在监听」类错误，不会二次
    // 触发 error 事件。
    instance.close(() => {})
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