// ICS 导出：纯函数，无 DOM / Node 依赖，主进程与冒烟/纯函数断言共用。
// RFC 5545 日历交换格式（.ics），单向出口（同 CSV 的定位；导入不在本轮范围）。
// 事件而非待办（VEVENT）：Google Calendar 等主流订阅方对 VTODO 展示残缺，
// VEVENT 的互操作性最好。刻意不导出：提醒、重复规则、子任务、回收站任务
// （语义无法可靠对应或属于私有数据，文档明示）。

export type IcsExportTask = {
  id: string
  title: string
  notes: string
  priority: number
  dueAt: string | null
  startAt: string | null
  endAt: string | null
  allDay: boolean
  completed: boolean
  projectName: string | null
  tags: string[]
}

const CRLF = '\r\n'
const HOUR_MS = 3600000

const pad = (n: number): string => String(n).padStart(2, '0')

// RFC 5545 TEXT 转义：反斜杠、分号、逗号、换行（CRLF/CR/LF 统一为 \n 字面量）。
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// 即刻 → UTC 基本格式（20261125T100000Z）。全篇统一 UTC（带 Z），不产
// VTIMEZONE：本地墙钟由消费端按时区换算，交换面最小。
export function icsInstant(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

// 本地日 → DATE 值（20261125）。全天事件没有时区语义，用导出端的本地日。
export function icsDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

// Polaris 0-3 → RFC 5545 PRIORITY（1 最高 … 9 最低，0 = 未定义）。
const toRfcPriority = (priority: number): number =>
  priority === 3 ? 1 : priority === 2 ? 5 : priority === 1 ? 9 : 0

// RFC 5545 规定内容行 SHOULD ≤75 octet：超长按字节折叠，续行前缀 CRLF+空格。
// 中文一行轻松超限，按 UTF-8 字节切（TextEncoder 渲染层与 Node 均可用），
// 绝不切进多字节字符中间。段预算统一 74：续行前缀空格占 1 octet，加前缀后
// 每条物理行仍 ≤75。
const LINE_OCTETS = 74

export function icsFold(name: string, value: string): string {
  const head = `${name}:${value}`
  const encoder = new TextEncoder()
  if (encoder.encode(head).length <= LINE_OCTETS) return head
  const lines: string[] = []
  let rest = head
  while (encoder.encode(rest).length > LINE_OCTETS) {
    let take = 1
    // 贪心找到不超预算的最长前缀（逐字符推进；单字符 ≤4 字节，循环有界）。
    while (
      take < rest.length &&
      encoder.encode(rest.slice(0, take + 1)).length <= LINE_OCTETS
    ) {
      take += 1
    }
    lines.push(rest.slice(0, take))
    rest = rest.slice(take)
  }
  lines.push(rest)
  // 续行以空格开头：RFC 5545 fold = CRLF + 单个空白。
  return lines.join(CRLF + ' ')
}

type EventLines = {
  task: IcsExportTask
  /** 导出时刻（DTSTAMP）：调用方注入，断言可钉死。 */
  stamp: string
}

function vevent({ task, stamp }: EventLines): string[] {
  const lines: string[] = ['BEGIN:VEVENT']
  lines.push(icsFold('UID', `${task.id}@polaris.local`))
  lines.push(icsFold('DTSTAMP', icsInstant(stamp)))
  if (task.allDay) {
    // 全天：VALUE=DATE，本地日；DTEND 排他——结束日 +1 天（11/25–11/27 两天
    // 事件 → DTEND=11/28），无结束取开始日次日（单日）；结束日早于开始日的
    // 异常数据夹回开始日。
    const start = new Date(task.startAt ?? task.dueAt ?? Date.now())
    const endBase = task.endAt ?? task.startAt ?? task.dueAt ?? Date.now()
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    let endDay = new Date(new Date(endBase).getFullYear(), new Date(endBase).getMonth(), new Date(endBase).getDate())
    if (endDay.getTime() < startDay.getTime()) endDay = startDay
    lines.push(icsFold('DTSTART;VALUE=DATE', icsDate(start)))
    lines.push(icsFold('DTEND;VALUE=DATE', icsDate(new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1))))
  } else {
    const startIso = task.startAt ?? task.dueAt
    if (!startIso) return []
    const endMs = task.endAt
      ? new Date(task.endAt).getTime()
      : new Date(startIso).getTime() + HOUR_MS
    const endIso = new Date(Math.max(endMs, new Date(startIso).getTime())).toISOString()
    lines.push(icsFold('DTSTART', icsInstant(startIso)))
    lines.push(icsFold('DTEND', icsInstant(endIso)))
  }
  lines.push(icsFold('SUMMARY', icsEscape(task.title)))
  if (task.notes) lines.push(icsFold('DESCRIPTION', icsEscape(task.notes)))
  if (task.projectName) lines.push(icsFold('LOCATION', icsEscape(task.projectName)))
  if (task.tags.length > 0) {
    lines.push(icsFold('CATEGORIES', icsEscape(task.tags.join(','))))
  }
  lines.push(icsFold('PRIORITY', String(toRfcPriority(task.priority))))
  lines.push(icsFold('STATUS', 'CONFIRMED'))
  if (task.completed) lines.push(icsFold('X-POLARIS-COMPLETED', 'TRUE'))
  lines.push('END:VEVENT')
  return lines
}

/** 活任务（不含回收站）→ RFC 5545 日历文本。必须有 dueAt 或 startAt 才成事件
 *  （无日期任务在日历交换格式里没有意义，留在应用内即可）；CRLF 行尾。 */
export function buildIcsExport(tasks: IcsExportTask[], now: Date): string {
  const stamp = now.toISOString()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Polaris//Polaris Todo//CN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Polaris'
  ]
  for (const task of tasks) {
    lines.push(...vevent({ task, stamp }))
  }
  lines.push('END:VCALENDAR')
  return lines.join(CRLF) + CRLF
}

/** 备份三表 → 导出文本的装配（主进程 handler 与断言共用同一份逻辑）：
 *  过滤回收站与无日期任务；项目名/标签名按 id join。 */
export function icsExportFromBackup(backup: {
  projects: Array<{ id: string; name: string }>
  tasks: Array<{
    id: string
    title: string
    notes: string
    priority: number
    dueAt: string | null
    startAt: string | null
    endAt: string | null
    allDay: boolean
    completed: boolean
    deletedAt: string | null
    projectId: string | null
    tags: Array<{ name: string }>
  }>
}): { text: string; count: number } {
  const projectName = new Map(backup.projects.map((p) => [p.id, p.name]))
  const exportable = backup.tasks
    .filter((t) => t.deletedAt === null && (t.dueAt !== null || t.startAt !== null))
    .map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      dueAt: t.dueAt,
      startAt: t.startAt,
      endAt: t.endAt,
      allDay: t.allDay,
      completed: t.completed,
      projectName: t.projectId ? (projectName.get(t.projectId) ?? null) : null,
      tags: t.tags.map((tag) => tag.name)
    }))
  return { text: buildIcsExport(exportable, new Date()), count: exportable.length }
}
