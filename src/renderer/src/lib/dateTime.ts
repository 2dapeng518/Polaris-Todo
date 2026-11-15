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
import { zhCN } from 'date-fns/locale'

// Pure date/time helpers for the in-app picker. No React, no DOM.
// Everything here works in LOCAL wall time; only draftToIso crosses to UTC.

export type Draft = { day: Date; hour: number; minute: number }
export type TimePart = 'hour' | 'minute'

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

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

export function monthLabel(month: Date): string {
  return format(month, 'yyyy年M月', { locale: zhCN })
}

export function dayKey(day: Date): string {
  return format(day, 'yyyy-MM-dd')
}

export function dayLabel(day: Date): string {
  return format(day, 'M月d日 EEEE', { locale: zhCN })
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

export function dayPart(hour: number): string {
  let label = DAY_PARTS[0][1]
  for (const [from, name] of DAY_PARTS) {
    if (hour >= from) label = name
  }
  return label
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

// 「今天」向上取整到下一个 5 分钟刻度。跨过午夜时，今天通常还剩最后一个整分钟，
// 就夹到 23:59；但在一天的最后一分钟里 23:59 本身已经过去，夹回去等于交出一个
// 保存即逾期的时刻，所以只有那一分钟顺延到明天 00:00 —— 下一个可表示的瞬间。
// 调用方会把日历重新聚焦到返回的那天，跨日是可见的，不是悄悄改。
//
// 已知未覆盖：夏令时回拨的时区里，sameDay 分支把取整后的瞬间拆成墙钟时分回填，
// 而重复小时里同一时分对应两个瞬间，withTime 只会解析到较早的那个，结果仍可能
// 落过去（实测 America/New_York 回拨日最多早 55 分钟）。本函数目前只保证在
// 无 DST 的时区（本应用目标 Asia/Shanghai）不落过去，不要把它当普适不变量引用。
export function laterToday(now: Date): Draft {
  const bumped = new Date(Math.ceil((now.getTime() + 1) / 300000) * 300000)
  const sameDay = bumped.getFullYear() === now.getFullYear() &&
    bumped.getMonth() === now.getMonth() &&
    bumped.getDate() === now.getDate()
  if (sameDay) {
    return { day: startOfDay(now), hour: bumped.getHours(), minute: bumped.getMinutes() }
  }
  const lastMinute = setMinutes(setHours(startOfDay(now), 23), 59)
  return lastMinute.getTime() > now.getTime()
    ? { day: startOfDay(now), hour: 23, minute: 59 }
    : { day: startOfDay(bumped), hour: bumped.getHours(), minute: bumped.getMinutes() }
}