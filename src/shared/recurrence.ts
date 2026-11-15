import { RRule } from 'rrule'

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

export function recurrenceLabel(rule: string | null): string {
  if (!rule) return '不重复'
  return RECURRENCE_PRESETS.find((preset) => preset.rule === rule)?.label ?? '自定义'
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