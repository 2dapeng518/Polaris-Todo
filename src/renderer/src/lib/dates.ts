import { endOfDay, format, isAfter, isBefore, isToday, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { formatParsedDue } from '@shared/quickAddParse'

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

// One formatter for the whole app: quick-add chips, task rows, detail, palette,
// reminder and the submit receipt all read the same truth table.
export function formatDue(value: string | null): string {
  return formatParsedDue(value, true, new Date())
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