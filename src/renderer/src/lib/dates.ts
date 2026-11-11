import {
  endOfDay,
  format,
  isAfter,
  isBefore,
  isToday,
  isTomorrow,
  startOfDay
} from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function isTodayOrOverdue(value: string | null): boolean {
  if (!value) return false
  const date = new Date(value)
  return isToday(date) || isBefore(date, startOfDay(new Date()))
}

export function isUpcoming(value: string | null): boolean {
  if (!value) return false
  return isAfter(new Date(value), endOfDay(new Date()))
}

export function isOverdue(value: string | null): boolean {
  if (!value) return false
  return isBefore(new Date(value), new Date())
}

export function formatDue(value: string | null): string {
  if (!value) return '无日期'
  const date = new Date(value)
  if (isToday(date)) return `今天 ${format(date, 'HH:mm')}`
  if (isTomorrow(date)) return `明天 ${format(date, 'HH:mm')}`
  if (isBefore(date, startOfDay(new Date()))) {
    return `已逾期 · ${format(date, 'M月d日 HH:mm', { locale: zhCN })}`
  }
  return format(date, 'M月d日 HH:mm', { locale: zhCN })
}

export function formatHeaderDate(): string {
  return format(new Date(), 'M月d日 · EEEE', { locale: zhCN })
}

export function todayAt(hour: number, minute: number): string {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

export function tomorrowAt(hour: number, minute: number): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}