import { format, formatDistanceToNowStrict, isSameDay } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import type { Task } from '@shared/types'
import type { Locale, MessageKey } from '@shared/i18n'
import type { Translate } from '../../stores/useLocaleStore'
import { formatDue } from '../../lib/dates'
import type { ScheduleKind } from './types'

// 详情面板的纯展示文案助手：只读任务字段与时钟，不碰 store / DOM。

export const PRIORITIES = [0, 1, 2, 3] as const

export function priorityLabel(value: number, t: Translate): string {
  return t(`detail.priority.${value}` as MessageKey)
}

export function relativeTime(value: string | null, locale: Locale): string {
  if (!value) return ''
  try {
    return formatDistanceToNowStrict(new Date(value), {
      locale: locale === 'en' ? enUS : zhCN,
      addSuffix: true
    })
  } catch {
    return ''
  }
}

export function reminderSummary(task: Task, t: Translate, locale: Locale): string {
  if (!task.remindAt) return ''
  if (!task.dueAt) return formatDue(task.remindAt, locale)
  const minutes = Math.round(
    (new Date(task.dueAt).getTime() - new Date(task.remindAt).getTime()) / 60000
  )
  if (minutes === 0) return t('detail.dueAt')
  // Beyond the inheritance window a relative offset is meaningless to read.
  if (minutes > 7 * 24 * 60) return formatDue(task.remindAt, locale)
  if (minutes > 0 && minutes % 60 === 0) return t('detail.advanceHours', { count: minutes / 60 })
  if (minutes > 0) return t('detail.advanceMinutes', { count: minutes })
  return formatDue(task.remindAt, locale)
}

export function popoverLabel(kind: ScheduleKind, t: Translate): string {
  if (kind === 'due') return t('detail.popover.due')
  if (kind === 'time') return t('detail.popover.time')
  if (kind === 'reminder') return t('detail.popover.reminder')
  return t('detail.popover.repeat')
}

// 「时间」行的读数：HH:mm – HH:mm（同日）或带日期的跨天范围；全天只看日期，
// 忽略钟点（钟点原样保留在字段里，取消全天后恢复显示）。
export function timeSummary(task: Task, t: Translate): string {
  if (!task.startAt && !task.endAt) return ''
  if (task.allDay) {
    if (!task.startAt) return t('detail.time.allDay')
    if (task.endAt && !isSameDay(new Date(task.startAt), new Date(task.endAt))) {
      const range = `${format(new Date(task.startAt), 'M/d')} – ${format(new Date(task.endAt), 'M/d')}`
      return t('detail.time.allDayRange', { range })
    }
    return t('detail.time.allDay')
  }
  if (task.startAt && task.endAt) {
    const sameDay = isSameDay(new Date(task.startAt), new Date(task.endAt))
    return sameDay
      ? `${format(new Date(task.startAt), 'HH:mm')} – ${format(new Date(task.endAt), 'HH:mm')}`
      : `${format(new Date(task.startAt), 'M/d HH:mm')} – ${format(new Date(task.endAt), 'M/d HH:mm')}`
  }
  if (task.startAt) return format(new Date(task.startAt), 'HH:mm')
  return `→ ${format(new Date(task.endAt as string), 'HH:mm')}`
}