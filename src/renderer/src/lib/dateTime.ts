import {
  addDays,
  format,
  getDaysInMonth,
  setHours,
  setMinutes,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import { DEFAULT_LOCALE, translate, type Locale, type MessageKey } from '@shared/i18n'

// Pure date/time helpers for the in-app picker. No React, no DOM.
// Everything here works in LOCAL wall time; only draftToIso crosses to UTC.

export type Draft = { day: Date; hour: number; minute: number }
export type TimePart = 'hour' | 'minute'

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

const EN_WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function weekdayLabels(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return locale === 'en' ? EN_WEEKDAY_LABELS : WEEKDAY_LABELS
}

// 日历套件（月格/多周/时间轴表头）用两字「周日」风格，贴合中文习惯；
// 迷你月历与日期选择器空间小，仍用上面的单字版。
const WEEKDAY_LABELS_SHORT = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const EN_WEEKDAY_LABELS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function weekdayLabelsShort(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return locale === 'en' ? EN_WEEKDAY_LABELS_SHORT : WEEKDAY_LABELS_SHORT
}

// Same vocabulary as shared/quickAddParse.ts, so the picker and the quick-add
// parser never describe the same hour with different words.
export const DAY_PARTS: ReadonlyArray<readonly [number, string]> = [
  [0, '凌晨'],
  [7, '早上'],
  [9, '上午'],
  [12, '中午'],
  [13, '下午'],
  [18, '傍晚'],
  [20, '晚上']
]

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

// Always 42 cells. A fixed six rows means paging months never changes the
// popover height, which would otherwise fight the fixed-position repositioning.
export function monthMatrix(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

export function monthLabel(month: Date, locale: Locale = DEFAULT_LOCALE): string {
  return locale === 'en'
    ? format(month, 'MMMM yyyy', { locale: enUS })
    : format(month, 'yyyy年M月', { locale: zhCN })
}

export function dayKey(day: Date): string {
  return format(day, 'yyyy-MM-dd')
}

export function dayLabel(day: Date, locale: Locale = DEFAULT_LOCALE): string {
  return locale === 'en'
    ? format(day, 'EEEE, MMM d', { locale: enUS })
    : format(day, 'M月d日 EEEE', { locale: zhCN })
}

export function monthFor(value: string | null): Date {
  return startOfMonth(value ? new Date(value) : new Date())
}

export function clampToMonth(month: Date, dayOfMonth: number): Date {
  return new Date(month.getFullYear(), month.getMonth(), Math.min(dayOfMonth, getDaysInMonth(month)))
}

export function draftFrom(value: string | null, fallback: string): Draft {
  const source = new Date(value ?? fallback)
  return { day: startOfDay(source), hour: source.getHours(), minute: source.getMinutes() }
}

export function withTime(day: Date, hour: number, minute: number): Date {
  return setMinutes(setHours(startOfDay(day), hour), minute)
}

export function draftToIso(draft: Draft): string {
  return withTime(draft.day, draft.hour, draft.minute).toISOString()
}

export function partMax(part: TimePart): number {
  return part === 'hour' ? 23 : 59
}

export function clampPart(part: TimePart, value: number): number {
  return Math.min(partMax(part), Math.max(0, Math.trunc(value)))
}

export function wrapPart(part: TimePart, value: number): number {
  const span = partMax(part) + 1
  return ((value % span) + span) % span
}

export function dayPart(hour: number, locale: Locale = DEFAULT_LOCALE): string {
  let from = DAY_PARTS[0][0]
  for (const [threshold] of DAY_PARTS) {
    if (hour >= threshold) from = threshold
  }
  return translate(locale, `picker.part.${from}` as MessageKey)
}

// Full-width digits are normalized, everything non-numeric is dropped, and the
// result is capped at two characters. No maxLength on the input: it would
// interfere with IME composition.
export function normalizeDigits(raw: string): string {
  return raw
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, 2)
}

// A first digit of 3+ (hours) or 6+ (minutes) cannot start a two-digit value, so
// it is already complete; anything else waits for the second digit. Typing and
// blur share this predicate so they can never disagree about what "finished"
// means — that disagreement is what let a stray blur commit '1' as 01:00.
export function isComplete(part: TimePart, digits: string): boolean {
  if (digits.length === 2) return true
  if (digits.length !== 1) return false
  return part === 'hour' ? Number(digits[0]) >= 3 : Number(digits[0]) >= 6
}

// Whole-time nudges stay inside the current day; only the calendar changes days.
export function shiftMinutes(draft: Draft, delta: number): Draft {
  const total = Math.min(1439, Math.max(0, draft.hour * 60 + draft.minute + delta))
  return { day: draft.day, hour: Math.floor(total / 60), minute: total % 60 }
}

const FIVE_MINUTES = 300000

// 一个瞬间 → 它在墙钟上的 Draft。注意这是**有损**的：夏令时回拨那天同一个
// 时分会出现两次，Draft 无法表达「第二次」，读回时只会解析到较早的那次。
function draftAt(instant: Date): Draft {
  return { day: startOfDay(instant), hour: instant.getHours(), minute: instant.getMinutes() }
}

// 「今天」向上取整到下一个 5 分钟刻度，并保证返回的 Draft **读回真实瞬间后**
// 严格晚于 now —— 判据是落库的那个瞬间，不是墙钟面上的数字。
//
// 跨过午夜时，今天通常还剩最后一个整分钟，就夹到 23:59；但在一天的最后一分钟里
// 23:59 本身已经过去，夹回去等于交出一个保存即逾期的时刻，所以那一分钟顺延到
// 明天 00:00。调用方会把日历重新聚焦到返回的那天，跨日是可见的，不是悄悄改。
//
// 为什么必须读回校验：取整算出的是瞬间，拆成墙钟时分再回填却可能落到另一个瞬间。
// 夏令时回拨的重复小时里 withTime 只解析到较早的那次（实测纽约最多早 55 分钟）；
// 午夜回拨的时区更狠，墙钟在同一天内倒退，23:59 会算成 23:00（圣地亚哥早 59.5 分钟）。
// 所以候选不足时就沿真实时间轴继续推进 5 分钟，直到读回值真的在未来。
// Draft 表达不了重复小时的第二次，跳过这段歧义是唯一诚实的做法。
// 288 步 = 24 小时的 5 分钟刻度，远大于任何真实时区的跳变幅度。
export function laterToday(now: Date): Draft {
  const rounded = Math.ceil((now.getTime() + 1) / FIVE_MINUTES) * FIVE_MINUTES
  const bumped = new Date(rounded)
  const sameDay = bumped.getFullYear() === now.getFullYear() &&
    bumped.getMonth() === now.getMonth() &&
    bumped.getDate() === now.getDate()
  const lastMinute = setMinutes(setHours(startOfDay(now), 23), 59)

  let candidate = sameDay || lastMinute.getTime() <= now.getTime()
    ? draftAt(bumped)
    : { day: startOfDay(now), hour: 23, minute: 59 }

  for (let step = 0; step < 288; step++) {
    if (new Date(draftToIso(candidate)).getTime() > now.getTime()) return candidate
    candidate = draftAt(new Date(rounded + (step + 1) * FIVE_MINUTES))
  }
  return candidate
}