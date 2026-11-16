import { RRule } from 'rrule'
import { DEFAULT_LOCALE, translate, type Locale, type MessageKey } from './i18n'

export type RecurrencePreset = {
  label: string
  rule: string | null
}

export const RECURRENCE_PRESETS: RecurrencePreset[] = [
  { label: '不重复', rule: null },
  { label: '每天', rule: 'FREQ=DAILY' },
  { label: '工作日', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: '每周', rule: 'FREQ=WEEKLY' },
  { label: '每月', rule: 'FREQ=MONTHLY' },
  { label: '每年', rule: 'FREQ=YEARLY' }
]

const PRESET_LABEL_KEYS: Record<string, MessageKey> = {
  '': 'recurrence.none',
  'FREQ=DAILY': 'recurrence.daily',
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR': 'recurrence.weekdays',
  'FREQ=WEEKLY': 'recurrence.weekly',
  'FREQ=MONTHLY': 'recurrence.monthly',
  'FREQ=YEARLY': 'recurrence.yearly'
}

/** 显示标签按当前语言取；规则字符串本身永远是唯一真源。 */
export function recurrenceLabel(
  rule: string | null,
  locale: Locale = DEFAULT_LOCALE
): string {
  const key = PRESET_LABEL_KEYS[rule ?? '']
  return translate(locale, key ?? 'recurrence.custom')
}

/** 预设之外的规则一律算自定义；不要拿翻译后的文案反推。 */
export function isCustomRecurrence(rule: string | null): boolean {
  return rule !== null && !RECURRENCE_PRESETS.some((preset) => preset.rule === rule)
}

export function isValidRecurrenceRule(rule: string): boolean {
  if (/(^|;)COUNT=/i.test(rule) || /(^|;)UNTIL=/i.test(rule)) return false

  try {
    const options = RRule.parseString(rule)
    return Boolean(options.freq)
  } catch {
    return false
  }
}

// rrule treats a Date's UTC fields as a floating wall clock. Polaris stores UTC
// instants but repeats by local wall time (18:00 stays 18:00, Monday stays Monday).
function toWallTime(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds()
    )
  )
}

function fromWallTime(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  )
}

export function nextMonthlyClamped(due: Date, now: Date): Date | null {
  const day = due.getDate()
  const hours = due.getHours()
  const minutes = due.getMinutes()
  const seconds = due.getSeconds()
  const milliseconds = due.getMilliseconds()

  const anchor = now.getTime() > due.getTime() ? now : due
  let year = anchor.getFullYear()
  let month = anchor.getMonth()
  if (anchor === due) month += 1

  for (let i = 0; i < 60; i += 1) {
    if (month > 11) {
      month = 0
      year += 1
    }

    const lastDay = new Date(year, month + 1, 0).getDate()
    const candidate = new Date(
      year,
      month,
      Math.min(day, lastDay),
      hours,
      minutes,
      seconds,
      milliseconds
    )

    if (candidate.getTime() > due.getTime() && candidate.getTime() > now.getTime()) {
      return candidate
    }

    month += 1
  }

  return null
}

export function nextOccurrence(
  dueAt: string | null,
  ruleString: string | null
): Date | null {
  if (!dueAt || !ruleString) return null

  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null

  const now = new Date()

  // The "每月" preset clamps to the last day of short months instead of
  // skipping February, April, June, September and November for a 29-31 due date.
  if (ruleString === 'FREQ=MONTHLY') {
    return nextMonthlyClamped(due, now)
  }

  try {
    const options = RRule.parseString(ruleString)
    const wallStart = toWallTime(due)
    options.dtstart = wallStart
    const rule = new RRule(options)

    let nextWall = rule.after(wallStart, false)
    let attempts = 0

    while (nextWall && attempts < 1000) {
      const next = fromWallTime(nextWall)
      if (next.getTime() > now.getTime()) return next

      const following = rule.after(nextWall, false)
      if (!following || following.getTime() <= nextWall.getTime()) return null

      nextWall = following
      attempts += 1
    }

    return null
  } catch {
    return null
  }
}

// 自定义重复编辑器的结构化表示：频率 + 间隔 + （周频率的）星期集合。
export type CustomRecurrence = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  weekdays: string[]
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

// 把简单 RRULE 解析成结构化形式供编辑器回显；含 BYMONTHDAY/BYSETPOS 等复杂子句
// 或 COUNT/UNTIL 的规则返回 null（编辑器不支持，仍按「自定义」只读展示）。
export function parseCustomRecurrence(rule: string | null): CustomRecurrence | null {
  if (!rule) return null
  const freqMatch = /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.exec(rule)
  if (!freqMatch) return null
  if (/(?:^|;)(BYMONTHDAY|BYMONTH|BYSETPOS|BYYEARDAY|BYWEEKNO|COUNT|UNTIL)=/i.test(rule)) return null

  const intervalMatch = /(?:^|;)INTERVAL=(\d+)(?:;|$)/.exec(rule)
  const interval = intervalMatch ? Math.min(99, Math.max(1, parseInt(intervalMatch[1], 10))) : 1
  const bydayMatch = /(?:^|;)BYDAY=([A-Z,]+)(?:;|$)/.exec(rule)
  const weekdays = bydayMatch
    ? bydayMatch[1].split(',').filter((day) => WEEKDAY_CODES.includes(day))
    : []

  return { freq: freqMatch[1] as CustomRecurrence['freq'], interval, weekdays }
}

// 由结构化形式构建 RRULE：间隔为 1 时省略 INTERVAL（与预设同形），周频率选了星期才加 BYDAY。
export function buildCustomRecurrence(custom: CustomRecurrence): string {
  let rule = `FREQ=${custom.freq}`
  if (custom.interval > 1) rule += `;INTERVAL=${custom.interval}`
  if (custom.freq === 'WEEKLY' && custom.weekdays.length > 0) {
    const ordered = WEEKDAY_CODES.filter((day) => custom.weekdays.includes(day))
    rule += `;BYDAY=${ordered.join(',')}`
  }
  return rule
}