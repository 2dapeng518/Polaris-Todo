import { endOfDay, format, isAfter, isBefore, isToday, startOfDay } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { formatParsedDue } from '@shared/quickAddParse'
import { DEFAULT_LOCALE, translate, type Locale } from '@shared/i18n'

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
export function formatDue(value: string | null, locale: Locale = DEFAULT_LOCALE): string {
  return formatParsedDue(value, true, new Date(), locale)
}

export function formatHeaderDate(locale: Locale = DEFAULT_LOCALE): string {
  return locale === 'en'
    ? format(new Date(), 'MMM d · EEEE', { locale: enUS })
    : format(new Date(), 'M月d日 · EEEE', { locale: zhCN })
}

function formatStamp(value: string, locale: Locale): string {
  const date = new Date(value)
  if (isToday(date)) {
    return `${translate(locale, 'dates.today')} ${format(date, 'HH:mm')}`
  }
  const sameYear = date.getFullYear() === new Date().getFullYear()
  if (locale === 'en') {
    return format(date, sameYear ? 'MMM d, HH:mm' : 'MMM d, yyyy HH:mm', { locale: enUS })
  }
  return format(date, `${sameYear ? '' : 'yyyy年'}M月d日 HH:mm`, { locale: zhCN })
}

// 回收站的删除时间：formatDue 会给过去的瞬间加「已逾期」前缀，语义不合，
// 所以按同样的风格只保留日期事实（今天精确到分钟，跨年补年份）。
export function formatDeletedAt(value: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatStamp(value, locale)
}

// 完成时刻：与删除时间同风格——只陈述日期事实（今天精确到分钟，跨年补年份），
// 不加「已逾期」前缀。迁移 4 前完成的任务 completedAt 为 null，由调用方如实显示「未记录」，绝不猜补。
export function formatCompletedAt(value: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatStamp(value, locale)
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