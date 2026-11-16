// CSV 搬家导入：纯函数，无 DOM / Node 依赖，主进程与冒烟断言共用。
// 表头驱动 + 别名表：Todoist 项目导出（TYPE/CONTENT/INDENT…）与滴答清单/TickTick
// 备份导出（任务名称/截止日期…）按表头签名识别。竞品导出格式没有稳定契约，
// 别名表容忍列名漂移；认不出的表头明确报错，绝不猜。
// 刻意不迁移：重复规则、提醒、附件、评论（语义无法可靠对应，文档明示）。

export type CsvFormat = 'todoist' | 'dida'

export type CsvTask = {
  title: string
  notes: string
  priority: number
  dueAt: string | null
  completed: boolean
  projectName: string | null
  tags: string[]
  subtasks: string[]
}

export type CsvParseResult = {
  ok: boolean
  format?: CsvFormat
  tasks: CsvTask[]
  skipped: number
  error?: string
}

// 标准 CSV 词法：引号内逗号/换行原样保留，"" 是转义引号，CRLF 与 LF 都认，BOM 剥掉。
export function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

const normalizeHeader = (value: string): string => value.trim().toLowerCase()

// 每个语义字段的已知列名别名（小写归一后匹配）。
const FIELD_ALIASES: Record<string, string[]> = {
  type: ['type'],
  title: ['content', '任务名称', 'task name', '任务标题', '标题'],
  notes: ['description', '任务内容', 'task content', '备注', '描述'],
  priority: ['priority', '优先级'],
  due: ['date', '截止日期', '截止时间', 'due date', '到期时间'],
  project: ['project_name', '清单', '清单名称', 'list name', 'project'],
  tags: ['tags', '标签', 'labels'],
  status: ['完成状态', '状态', 'status'],
  deleted: ['is_deleted'],
  archived: ['is_archived'],
  indent: ['indent']
}

function columnIndex(headers: string[], field: string): number {
  const aliases = FIELD_ALIASES[field] ?? []
  return headers.findIndex((header) => aliases.includes(header))
}

// Todoist 优先级 1-4（4 最高）→ Polaris 0-3；滴答用高/中/低/无或数字。
function mapPriority(raw: string, format: CsvFormat): number {
  const value = raw.trim().toLowerCase()
  if (format === 'todoist') {
    const level = Number(value)
    if (level === 4) return 3
    if (level === 3) return 2
    if (level === 2) return 1
    return 0
  }
  if (value === '高' || value === 'high' || value === '3') return 3
  if (value === '中' || value === 'medium' || value === '2') return 2
  if (value === '低' || value === 'low' || value === '1') return 1
  return 0
}

// 截止解析：带时区偏移/Z 的按真实瞬间；裸日期时间按本地墙钟（与应用一致），
// 只写日期补 23:59（与快速添加的日粒度默认一致）。重复描述（every day / 每天…）
// 无法可靠映射到具体瞬间，返回 null 而不是猜。
export function parseCsvDue(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^every\b/i.test(value) || /^每/.test(value)) return null
  if (/(?:[+-]\d{2}:?\d{2}|Z)$/i.test(value)) {
    const instant = Date.parse(value)
    return Number.isNaN(instant) ? null : new Date(instant).toISOString()
  }
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (match) {
    const [, y, mo, d, h, mi, s] = match
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      h !== undefined ? Number(h) : 23,
      mi !== undefined ? Number(mi) : 59,
      s !== undefined ? Number(s) : 0
    )
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const instant = Date.parse(value)
  return Number.isNaN(instant) ? null : new Date(instant).toISOString()
}

function splitTags(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[,;，；]/)) {
    const name = part.trim()
    if (name) seen.add(name)
  }
  return [...seen]
}

const isTruthy = (raw: string): boolean => /^(true|1|yes|是)$/i.test(raw.trim())

export function parseCsvImport(text: string): CsvParseResult {
  const rows = tokenizeCsv(text)
  if (rows.length < 2) {
    return { ok: false, tasks: [], skipped: 0, error: 'CSV 内容为空或缺少数据行' }
  }
  const headers = rows[0].map(normalizeHeader)
  const has = (names: string[]) => names.every((name) => headers.includes(name))

  let format: CsvFormat
  if (has(['type', 'content', 'indent'])) format = 'todoist'
  else if (headers.includes('任务名称') || headers.includes('task name')) format = 'dida'
  else {
    return {
      ok: false,
      tasks: [],
      skipped: 0,
      error: '无法识别的 CSV 格式：需要 Todoist 项目导出或滴答清单备份导出的表头'
    }
  }

  const col = {
    type: columnIndex(headers, 'type'),
    title: columnIndex(headers, 'title'),
    notes: columnIndex(headers, 'notes'),
    priority: columnIndex(headers, 'priority'),
    due: columnIndex(headers, 'due'),
    project: columnIndex(headers, 'project'),
    tags: columnIndex(headers, 'tags'),
    status: columnIndex(headers, 'status'),
    deleted: columnIndex(headers, 'deleted'),
    archived: columnIndex(headers, 'archived'),
    indent: columnIndex(headers, 'indent')
  }
  const cell = (row: string[], index: number): string =>
    index >= 0 && index < row.length ? row[index] : ''

  const tasks: CsvTask[] = []
  let skipped = 0
  // Todoist 用 INDENT 表达子任务层级：indent>0 的行挂到最近一个 indent 更小的任务下。
  let lastParent: CsvTask | null = null
  let lastIndent = 0

  for (const row of rows.slice(1)) {
    if (format === 'todoist') {
      const type = cell(row, col.type).trim().toLowerCase()
      if (type !== 'task') {
        skipped++
        continue
      }
      if (isTruthy(cell(row, col.deleted)) || isTruthy(cell(row, col.archived))) {
        skipped++
        continue
      }
    }
    const title = cell(row, col.title).trim().slice(0, 500)
    if (!title) {
      skipped++
      continue
    }
    const indent = format === 'todoist' ? Number(cell(row, col.indent)) || 0 : 0
    if (format === 'todoist' && indent > 0 && lastParent && indent > lastIndent) {
      lastParent.subtasks.push(title)
      continue
    }
    const status = cell(row, col.status).trim().toLowerCase()
    const task: CsvTask = {
      title,
      notes: cell(row, col.notes).trim(),
      priority: mapPriority(cell(row, col.priority), format),
      dueAt: parseCsvDue(cell(row, col.due)),
      completed: status.includes('已完成') || status === 'completed' || status === 'done',
      projectName: cell(row, col.project).trim() || null,
      tags: splitTags(cell(row, col.tags)),
      subtasks: []
    }
    tasks.push(task)
    lastParent = task
    lastIndent = indent
  }

  if (tasks.length === 0) {
    return { ok: false, format, tasks: [], skipped, error: 'CSV 里没有可导入的任务' }
  }
  return { ok: true, format, tasks, skipped }
}