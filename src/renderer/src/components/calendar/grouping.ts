import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import type { Task } from '@shared/types'
import type { Locale } from '@shared/i18n'
import { dayKey } from '../../lib/dateTime'

// 日程（原列表）的分组模型（日历套件 P1）：全部围绕「本地日」桶。纯函数，
// 只吃任务数组和注入的时钟，不碰 store / DOM。特殊分区名（已过期/无日期…）
// 由调用方按当前语言传入，日期标签走 date-fns 的本地化格式。

// 任务归属日：截止优先（dueAt 仍是锚点），没有截止用计划开始；两者皆无 =
// 无日期任务（旧日历把它们排除在外，日程必须收进来）。
export function calendarDay(task: Task): Date | null {
  const source = task.dueAt ?? task.startAt
  return source ? startOfDay(new Date(source)) : null
}

// 组内排序：按归属时刻升序（无时刻的 00:00 自然排最前），同刻按优先级降序、
// 创建时间新者在前——与 DB 的 listTasks 顺序同一套语义。
function compareTasks(a: Task, b: Task): number {
  const aAt = a.dueAt ?? a.startAt
  const bAt = b.dueAt ?? b.startAt
  const aMs = aAt ? Date.parse(aAt) : Number.MAX_SAFE_INTEGER
  const bMs = bAt ? Date.parse(bAt) : Number.MAX_SAFE_INTEGER
  if (aMs !== bMs) return aMs - bMs
  if (a.priority !== b.priority) return b.priority - a.priority
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

export type CalendarGroup = {
  key: string
  /** null = 无日期 / 已过期这类混合分区；否则为该分组的本地日（零点）。 */
  day: Date | null
  label: string
  tasks: Task[]
}

export type GroupLabels = {
  overdue: string
  noDate: string
  today: string
  tomorrow: string
}

// 分组日标签：今天 / 明天给相对词，其余给「M月d日 周三」/ "Wed, Nov 26"。
export function dayGroupLabel(day: Date, now: Date, locale: Locale, labels: GroupLabels): string {
  if (isSameDay(day, now)) return labels.today
  if (isSameDay(day, addDays(now, 1))) return labels.tomorrow
  return locale === 'en'
    ? format(day, 'EEE, MMM d', { locale: enUS })
    : format(day, 'M月d日 EEE', { locale: zhCN })
}

// 日程分组：已过期（升序，最早的在最上）→ 未来的每个自然日一组 →
// 无日期垫底。已完成任务不进来（调用方单独走已完成折叠区）。
export function buildListGroups(
  tasks: Task[],
  now: Date,
  locale: Locale,
  labels: GroupLabels
): CalendarGroup[] {
  const today = startOfDay(now)
  const overdue: Task[] = []
  const noDate: Task[] = []
  const byDay = new Map<string, { day: Date; tasks: Task[] }>()

  for (const task of tasks) {
    const day = calendarDay(task)
    if (!day) {
      noDate.push(task)
      continue
    }
    if (day.getTime() < today.getTime()) {
      overdue.push(task)
      continue
    }
    const key = dayKey(day)
    const bucket = byDay.get(key)
    if (bucket) bucket.tasks.push(task)
    else byDay.set(key, { day, tasks: [task] })
  }

  const dayGroups: CalendarGroup[] = [...byDay.values()]
    .sort((a, b) => a.day.getTime() - b.day.getTime())
    .map(({ day, tasks: dayTasks }) => ({
      key: dayKey(day),
      day,
      label: dayGroupLabel(day, now, locale, labels),
      tasks: dayTasks.sort(compareTasks)
    }))

  const groups: CalendarGroup[] = []
  if (overdue.length > 0) {
    groups.push({ key: 'overdue', day: null, label: labels.overdue, tasks: overdue.sort(compareTasks) })
  }
  groups.push(...dayGroups)
  if (noDate.length > 0) {
    groups.push({ key: 'no-date', day: null, label: labels.noDate, tasks: noDate.sort(compareTasks) })
  }
  return groups
}

