// CSV 搬家导入：纯函数，无 DOM / Node 依赖，主进程与冒烟断言共用。
// 表头驱动 + 别名表：Csv 项目导出（TYPE/CONTENT/INDENT…）与主流待办应用/mainstream to-do app
// 备份导出（任务名称/截止日期…）按表头签名识别。同类产品导出格式没有稳定契约，
// 别名表容忍列名漂移；认不出的表头明确报错，绝不猜。
// 刻意不迁移：重复规则、提醒、附件、评论（语义无法可靠对应，文档明示）。
//
// 错误是机器可识别的 code+params（本模块不做翻译）：展示边界（db 层）经
// csvErrorMessage(locale, error) 按当前界面语言翻译，英文界面看到英文报错。

import { translate, type Locale, type MessageKey } from './i18n'

export type CsvFormat = 'standard' | 'legacy'

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

// 错误码 → i18n 键：新增错误必须同时补 zh母本与 en 词典（Messages 类型约束）。
export type CsvImportErrorCode =
  | 'empty'
  | 'unknownFormat'
  | 'noTasks'
  | 'unclosedQuote'
  | 'invalidDate'
  | 'notesTooLong'

export type CsvImportError = {
  code: CsvImportErrorCode
  params?: Record<string, string | number>
}

const CSV_ERROR_KEYS: Record<CsvImportErrorCode, MessageKey> = {
  empty: 'csv.empty',
  unknownFormat: 'csv.unknownFormat',
  noTasks: 'csv.noTasks',
  unclosedQuote: 'csv.unclosedQuote',
  invalidDate: 'csv.invalidDate',
  notesTooLong: 'csv.notesTooLong'
}

/** 展示边界用：把 code+params 翻成当前语言的文案。 */
export function csvErrorMessage(locale: Locale, error: CsvImportError): string {
  return translate(locale, CSV_ERROR_KEYS[error.code], error.params)
}

// 词法/日期层用异常携带 code+params，parseCsvImport 统一接住转成结果对象。
export class CsvImportFailure extends Error {
  readonly code: CsvImportErrorCode
  readonly params?: Record<string, string | number>

  constructor(code: CsvImportErrorCode, params?: Record<string, string | number>) {
    super(`CSV import failed: ${code}`)
    this.code = code
    this.params = params
  }
}

export type CsvParseResult = {
  ok: boolean
  format?: CsvFormat
  tasks: CsvTask[]
  skipped: number
  error?: CsvImportError
}

// 备注上限对齐 IPC 正门（ipc.ts updateTaskSchema 的 notes.max(20000)）。
const NOTES_MAX = 20000

type CsvRow = { cells: string[]; line: number }

// 标准 CSV 词法：引号内逗号/换行原样保留，"" 是转义引号，CRLF 与 LF 都认，BOM 剥掉。
// 行号是物理行（表头为第 1 行），供错误定位；未闭合引号明确报错——
// 静默吞掉剩余全部内容会把半份数据当成完整导入。
function tokenizeCsvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let rowLine = 1
  let quoteLine = 1
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
        // 引号内换行原样保留，但物理行号照常前进。
        if (ch === '\n') {
          line += 1
        } else if (ch === '\r') {
          if (src[i + 1] === '\n') i++
          line += 1
        }
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
      quoteLine = line
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      line += 1
      row.push(field)
      field = ''
      rows.push({ cells: row, line: rowLine })
      row = []
      rowLine = line
    } else {
      field += ch
    }
  }
  if (inQuotes) {
    throw new CsvImportFailure('unclosedQuote', { row: quoteLine })
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push({ cells: row, line: rowLine })
  }
  return rows.filter((entry) => entry.cells.some((cell) => cell.trim() !== ''))
}

export function tokenizeCsv(text: string): string[][] {
  return tokenizeCsvRows(text).map((entry) => entry.cells)
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

// Csv 优先级 1-4（4 最高）→ Polaris 0-3；主流待办应用用高/中/低/无或数字。
function mapPriority(raw: string, format: CsvFormat): number {
  const value = raw.trim().toLowerCase()
  if (format === 'standard') {
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
// 月/日溢出（13 月 40 日、2 月 30 日）抛 CsvImportFailure：new Date 会滚成
// 次年/下月，静默滚动等于篡改用户数据；回读校验照 quickAddParse 的既有模式。
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
    const year = Number(y)
    const month = Number(mo)
    const day = Number(d)
    const date = new Date(
      year,
      month - 1,
      day,
      h !== undefined ? Number(h) : 23,
      mi !== undefined ? Number(mi) : 59,
      s !== undefined ? Number(s) : 0
    )
    // 只回读年/月/日（与 quickAddParse 一致）：时分秒在 DST 缺口会被墙钟
    // 映射合法挪动，回读它们会误拒真实存在的本地时间。
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new CsvImportFailure('invalidDate', { value })
    }
    return date.toISOString()
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
  let rows: CsvRow[]
  try {
    rows = tokenizeCsvRows(text)
  } catch (error) {
    if (error instanceof CsvImportFailure) {
      return { ok: false, tasks: [], skipped: 0, error: { code: error.code, params: error.params } }
    }
    throw error
  }
  if (rows.length < 2) {
    return { ok: false, tasks: [], skipped: 0, error: { code: 'empty' } }
  }
  const headers = rows[0].cells.map(normalizeHeader)
  const has = (names: string[]) => names.every((name) => headers.includes(name))

  let format: CsvFormat
  if (has(['type', 'content', 'indent'])) format = 'standard'
  else if (headers.includes('任务名称') || headers.includes('task name')) format = 'legacy'
  else {
    return { ok: false, tasks: [], skipped: 0, error: { code: 'unknownFormat' } }
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
  // Csv 用 INDENT 表达子任务层级：indent>0 的行挂到最近一个 indent 更小的任务下。
  let lastParent: CsvTask | null = null
  let lastIndent = 0

  for (const { cells: row, line } of rows.slice(1)) {
    if (format === 'standard') {
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
    const indent = format === 'standard' ? Number(cell(row, col.indent)) || 0 : 0
    if (format === 'standard' && indent > 0 && lastParent && indent > lastIndent) {
      lastParent.subtasks.push(title)
      continue
    }
    // 备注超长整体拒绝（对齐 IPC zod 的 notes.max(20000)），带物理行号。
    const notes = cell(row, col.notes).trim()
    if (notes.length > NOTES_MAX) {
      return {
        ok: false,
        format,
        tasks: [],
        skipped,
        error: { code: 'notesTooLong', params: { row: line, limit: NOTES_MAX } }
      }
    }
    // 日期溢出整体拒绝而非滚成次年；行号在展示边界拼进错误文案。
    let dueAt: string | null
    try {
      dueAt = parseCsvDue(cell(row, col.due))
    } catch (error) {
      if (error instanceof CsvImportFailure) {
        return {
          ok: false,
          format,
          tasks: [],
          skipped,
          error: { code: error.code, params: { ...error.params, row: line } }
        }
      }
      throw error
    }
    const status = cell(row, col.status).trim().toLowerCase()
    const task: CsvTask = {
      title,
      notes,
      priority: mapPriority(cell(row, col.priority), format),
      dueAt,
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
    return { ok: false, format, tasks: [], skipped, error: { code: 'noTasks' } }
  }
  return { ok: true, format, tasks, skipped }
}