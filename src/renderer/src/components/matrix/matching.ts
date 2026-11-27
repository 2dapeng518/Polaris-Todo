import { startOfDay, addDays } from 'date-fns'
import type { Task } from '@shared/types'
import type { Locale } from '@shared/i18n'

// 四象限的归象 / 分组 / 排序纯函数：只吃任务数组、偏好和注入的时钟，
// 不碰 store / DOM（同 calendar/grouping.ts 的先例）。
//
// 归象语义是「级联」：任务按 do → plan → quick → later 的固定顺序找第一个
// 命中自身筛选器的象限，命中即落定，不再参与后续象限；全都未命中则不出现在
// 矩阵里。这让四个象限天然互斥，也让默认配置能精确复刻旧版派生规则
// （重要 = 优先级中/高；紧急 = 今天到期或已逾期；无截止 = 不紧急）。

export type QuadrantId = 'do' | 'plan' | 'quick' | 'later'

export const QUADRANT_IDS: readonly QuadrantId[] = ['do', 'plan', 'quick', 'later']

// 象限序号（罗马数字 Ⅰ-Ⅳ）：象限头与编辑弹窗标题共用。
export const QUADRANT_NUMERALS: Record<QuadrantId, string> = {
  do: 'Ⅰ',
  plan: 'Ⅱ',
  quick: 'Ⅲ',
  later: 'Ⅳ'
}

export type MatrixDateScope =
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'overdue'
  | 'todayOrOverdue'
  | 'noDate'

export type MatrixKindScope = 'all' | 'task' | 'note'

/** 'all' 或 0-3（无/低/中/高）的任意子集（空集 = 一个优先级都不匹配，象限为空）。 */
export type MatrixPriorityScope = 'all' | number[]

export type MatrixFilter = {
  /** null = 所有清单。 */
  projectId: string | null
  date: MatrixDateScope
  priorities: MatrixPriorityScope
  kind: MatrixKindScope
}

export type MatrixGroupMode = 'none' | 'time'
export type MatrixSortMode = 'time' | 'priority' | 'title' | 'created'
export type MatrixSortDir = 'asc' | 'desc'

export type QuadrantPrefs = {
  filter: MatrixFilter
  group: MatrixGroupMode
  sort: MatrixSortMode
  dir: MatrixSortDir
}

export function isMatrixGroupMode(value: unknown): value is MatrixGroupMode {
  return value === 'none' || value === 'time'
}

export function isMatrixSortMode(value: unknown): value is MatrixSortMode {
  return value === 'time' || value === 'priority' || value === 'title' || value === 'created'
}

export function isMatrixSortDir(value: unknown): value is MatrixSortDir {
  return value === 'asc' || value === 'desc'
}

const DEFAULT_DO: MatrixFilter = { projectId: null, date: 'todayOrOverdue', priorities: [3, 2], kind: 'all' }
const DEFAULT_PLAN: MatrixFilter = { projectId: null, date: 'all', priorities: [3, 2], kind: 'all' }
const DEFAULT_QUICK: MatrixFilter = { projectId: null, date: 'todayOrOverdue', priorities: [1, 0], kind: 'all' }
const DEFAULT_LATER: MatrixFilter = { projectId: null, date: 'all', priorities: [1, 0], kind: 'all' }

// 默认配置在级联语义下复刻旧版派生规则：do/quick 先用「今天或逾期」接走
// 紧急任务，plan/later 用「所有日期」接住剩余的同重要性任务。
export function defaultQuadrantPrefs(): Record<QuadrantId, QuadrantPrefs> {
  return {
    do: { filter: { ...DEFAULT_DO }, group: 'none', sort: 'time', dir: 'asc' },
    plan: { filter: { ...DEFAULT_PLAN }, group: 'none', sort: 'time', dir: 'asc' },
    quick: { filter: { ...DEFAULT_QUICK }, group: 'none', sort: 'time', dir: 'asc' },
    later: { filter: { ...DEFAULT_LATER }, group: 'none', sort: 'time', dir: 'asc' }
  }
}

// 日期口径与旧版 isTodayOrOverdue 一致：按「本地日」比较，时刻不参与；
// 逾期 = 本地日早于今天（含昨天 23:59 与更早，也含更早的今天 0 点前瞬间）。
export function dateMatchesScope(dueAt: string | null, scope: MatrixDateScope, now: Date): boolean {
  if (scope === 'all') return true
  if (!dueAt) return scope === 'noDate'
  const day = startOfDay(new Date(dueAt)).getTime()
  const today = startOfDay(now).getTime()
  switch (scope) {
    case 'noDate':
      return false
    case 'today':
      return day === today
    case 'tomorrow':
      return day === startOfDay(addDays(now, 1)).getTime()
    case 'week':
      return day >= today && day <= startOfDay(addDays(now, 6)).getTime()
    case 'overdue':
      return day < today
    case 'todayOrOverdue':
      return day <= today
  }
}

// 「任务类型-笔记」的落地语义（产品决策 2026-11-27）：本应用没有独立笔记
// 实体，notes 只是任务上的备注文本，因此「笔记」= 备注非空的任务，「任务」
// = 备注为空的任务，「所有」= 不区分。
function kindMatches(task: Task, kind: MatrixKindScope): boolean {
  if (kind === 'all') return true
  const hasNotes = task.notes.trim().length > 0
  return kind === 'note' ? hasNotes : !hasNotes
}

export function taskMatchesFilter(task: Task, filter: MatrixFilter, now: Date): boolean {
  // 单象限筛选命中判断：四维全部命中才算命中。清单不等是最廉价的判断，
  // 放最前面短路；日期口径统一走 dateMatchesScope（吃注入时钟）。
  if (filter.projectId !== null && task.projectId !== filter.projectId) return false
  if (!dateMatchesScope(task.dueAt, filter.date, now)) return false
  if (filter.priorities !== 'all' && !filter.priorities.includes(task.priority)) return false
  return kindMatches(task, filter.kind)
}

/** 级联归象：按 do → plan → quick → later 首个命中胜出；全不命中不出场。 */
export function assignQuadrants(
  tasks: Task[],
  prefs: Record<QuadrantId, QuadrantPrefs>,
  now: Date
): Record<QuadrantId, Task[]> {
  const buckets: Record<QuadrantId, Task[]> = { do: [], plan: [], quick: [], later: [] }
  for (const task of tasks) {
    for (const id of QUADRANT_IDS) {
      if (taskMatchesFilter(task, prefs[id].filter, now)) {
        buckets[id].push(task)
        break
      }
    }
  }
  return buckets
}

export type MatrixGroup = {
  key: 'overdue' | 'today' | 'tomorrow' | 'far' | 'no-date'
  label: string
  tasks: Task[]
}

export type MatrixGroupLabels = {
  overdue: string
  today: string
  tomorrow: string
  far: string
  noDate: string
}

// 时间分组桶序固定：已逾期 → 今天 → 明天 → 更远 → 无日期，空桶不出场。
export function groupByTime(tasks: Task[], now: Date, labels: MatrixGroupLabels): MatrixGroup[] {
  const today = startOfDay(now).getTime()
  const tomorrow = startOfDay(addDays(now, 1)).getTime()
  const buckets: Record<MatrixGroup['key'], Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    far: [],
    'no-date': []
  }
  for (const task of tasks) {
    const source = task.dueAt ?? task.startAt
    if (!source) {
      buckets['no-date'].push(task)
      continue
    }
    const day = startOfDay(new Date(source)).getTime()
    if (day < today) buckets.overdue.push(task)
    else if (day === today) buckets.today.push(task)
    else if (day === tomorrow) buckets.tomorrow.push(task)
    else buckets.far.push(task)
  }
  const order: MatrixGroup['key'][] = ['overdue', 'today', 'tomorrow', 'far', 'no-date']
  const keyOf: Record<MatrixGroup['key'], keyof MatrixGroupLabels> = {
    overdue: 'overdue',
    today: 'today',
    tomorrow: 'tomorrow',
    far: 'far',
    'no-date': 'noDate'
  }
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: labels[keyOf[key]], tasks: buckets[key] }))
}

// 排序：time 同 calendar/grouping.ts 的 compareTasks 口径（时刻升序、同刻
// 优先级高在前、再同则新任务在前）；dir 只反转主键方向。
// 无日期任务在 time 排序下恒垫底（「从新到旧」不该把它们顶到最前面——它们
// 没有时刻可反转）；priority 排序以优先级为主键，无日期只在同优先级内垫底。
export function sortTasks(tasks: Task[], sort: MatrixSortMode, dir: MatrixSortDir, locale: Locale): Task[] {
  const sign = dir === 'asc' ? 1 : -1
  const collator = new Intl.Collator(locale === 'en' ? 'en' : 'zh-Hans-CN')
  // 返回 null 表示无日期：调用方统一把它排到末尾。
  const timeOf = (task: Task): number | null => {
    const source = task.dueAt ?? task.startAt
    return source ? Date.parse(source) : null
  }
  const sorted = [...tasks]
  sorted.sort((a, b) => {
    const aMs = timeOf(a)
    const bMs = timeOf(b)
    switch (sort) {
      case 'time': {
        if (aMs === null || bMs === null) {
          if (aMs !== bMs) return aMs === null ? 1 : -1
        } else if (aMs !== bMs) {
          return (aMs - bMs) * sign
        }
        if (a.priority !== b.priority) return b.priority - a.priority
        return Date.parse(b.createdAt) - Date.parse(a.createdAt)
      }
      case 'priority': {
        if (a.priority !== b.priority) return (b.priority - a.priority) * sign
        if (aMs === null || bMs === null) {
          if (aMs !== bMs) return aMs === null ? 1 : -1
          return 0
        }
        return (aMs - bMs) * sign
      }
      case 'title':
        return collator.compare(a.title, b.title) * sign
      case 'created':
        return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * sign
    }
  })
  return sorted
}
