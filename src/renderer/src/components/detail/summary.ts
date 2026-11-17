import { formatDistanceToNowStrict } from 'date-fns'
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
  if (kind === 'reminder') return t('detail.popover.reminder')
  return t('detail.popover.repeat')
}