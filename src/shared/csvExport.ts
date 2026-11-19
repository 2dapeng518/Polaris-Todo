// CSV 导出：纯函数，无 DOM / Node 依赖，主进程与冒烟/纯函数断言共用。
// 表头 = Csv 规范列 + 本应用扩展列（PROJECT_NAME/TAGS/STATUS），
// 活任务一键导出供备份/搬家（导入 CSV 功能已移除，导出为单向出口）。
// 刻意不导出：重复规则、提醒、附件、评论（语义无法可靠对应，文档明示）。
// 子任务走 Csv 的 INDENT 层级（父 1 / 子 2）。

export type CsvExportTask = {
  title: string
  notes: string
  priority: number
  dueAt: string | null
  completed: boolean
  projectName: string | null
  tags: string[]
  subtasks: string[]
}

/** 导出表头（顺序即列顺序）：Csv 规范列 + 本应用扩展列。 */
export const CSV_EXPORT_HEADERS = [
  'TYPE',
  'CONTENT',
  'DESCRIPTION',
  'PRIORITY',
  'INDENT',
  'PROJECT_NAME',
  'TAGS',
  'STATUS',
  'DATE',
  'DATE_LANG',
  'TIMEZONE',
  'AUTHOR'
] as const

/** RFC4180 escaping：含逗号/引号/换行的字段整体加引号，内部引号翻倍。 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 截止导出为本地墙钟 YYYY-MM-DDTHH:mm:ss（不带时区偏移，读件按本地墙钟理解）。 */
export function formatCsvDue(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Polaris 0-3 → Csv 1-4（4 最高）。
const toCsvPriority = (priority: number): number =>
  priority === 3 ? 4 : priority === 2 ? 3 : priority === 1 ? 2 : 1

function taskRow(task: CsvExportTask, indent: number, title: string): string {
  const cells = [
    'task',
    title,
    indent === 1 ? task.notes : '',
    String(toCsvPriority(task.priority)),
    String(indent),
    indent === 1 ? (task.projectName ?? '') : '',
    indent === 1 ? task.tags.join(',') : '',
    task.completed ? 'completed' : 'active',
    task.dueAt ? formatCsvDue(task.dueAt) : '',
    'en',
    '',
    ''
  ]
  return cells.map(csvField).join(',')
}

/** 活任务（不含回收站）→ Csv 格式 CSV 文本；子任务紧随父任务 INDENT 2。 */
export function buildCsvExport(tasks: CsvExportTask[]): string {
  const lines = [CSV_EXPORT_HEADERS.join(',')]
  for (const task of tasks) {
    lines.push(taskRow(task, 1, task.title))
    for (const sub of task.subtasks) lines.push(taskRow(task, 2, sub))
  }
  return lines.join('\r\n') + '\r\n'
}

/** 备份三表 → 导出文本的装配（主进程 handler 与 harness 断言共用同一份逻辑）：
 *  只取活任务；项目名/标签名/子任务标题按 id  join；子任务顺序保持 sort_order。 */
export function csvExportFromBackup(backup: {
  projects: Array<{ id: string; name: string }>
  tasks: Array<{
    id: string
    title: string
    notes: string
    priority: number
    dueAt: string | null
    completed: boolean
    deletedAt: string | null
    projectId: string | null
    tags: Array<{ name: string }>
  }>
  subtasks: Array<{ taskId: string; title: string }>
}): string {
  const projectName = new Map(backup.projects.map((p) => [p.id, p.name]))
  const subsByTask = new Map<string, string[]>()
  for (const sub of backup.subtasks) {
    const list = subsByTask.get(sub.taskId) ?? []
    list.push(sub.title)
    subsByTask.set(sub.taskId, list)
  }
  return buildCsvExport(
    backup.tasks
      .filter((t) => t.deletedAt === null)
      .map((t) => ({
        title: t.title,
        notes: t.notes,
        priority: t.priority,
        dueAt: t.dueAt,
        completed: t.completed,
        projectName: t.projectId ? (projectName.get(t.projectId) ?? null) : null,
        tags: t.tags.map((tag) => tag.name),
        subtasks: subsByTask.get(t.id) ?? []
      }))
  )
}
