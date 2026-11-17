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

// interval 为月步进（预设「每月」=1，自定义「每 N 月」=N）：序列月锚定在
// due 所在月 + k*interval，与 rrule 的 dtstart 锚定一致；目标月没有该日号时
// 钳到月末（1/31 → 2/28），绝不整月跳过。
export function nextMonthlyClamped(due: Date, now: Date, interval = 1): Date | null {
  // 非法日期直接拒绝：没有这道守卫，下面的无上限循环在 NaN 输入下不会终止。
  if (Number.isNaN(due.getTime()) || Number.isNaN(now.getTime())) return null
  // 间隔防御：只接受 ≥1 的整数，其余退回 1（调用方来自受限的规则解析）。
  const step = Number.isInteger(interval) && interval >= 1 ? interval : 1

  const day = due.getDate()
  const hours = due.getHours()
  const minutes = due.getMinutes()
  const seconds = due.getSeconds()
  const milliseconds = due.getMilliseconds()

  const anchor = now.getTime() > due.getTime() ? now : due
  // 取第一个不早于锚点月（due/now 较晚者所在月）的序列月：更早的序列月
  // 整月都在 now 之前，必然无解。k 至少为 1——due 当月的钳制候选恰好等于
  // due 本身，永远不满足「严格晚于 due」。
  const monthsFromDue =
    (anchor.getFullYear() - due.getFullYear()) * 12 + (anchor.getMonth() - due.getMonth())
  let k = Math.max(1, Math.ceil(monthsFromDue / step))

  // 答案至多在首个对齐序列月或再下一格：对齐月的钳制日若不晚于 now，
  // 下一格序列月整月晚于锚点月（now 就在锚点月里），必然晚于 now。
  // 循环天然在一两步内终止，无需迭代上限——旧的 60 次上限是防御性冗余。
  for (;;) {
    const total = due.getFullYear() * 12 + due.getMonth() + k * step
    const year = Math.floor(total / 12)
    const month = total % 12

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

    k += 1
  }
}

// now 可注入（默认取当前时刻）：真值表用固定时钟钉死逾期多年的场景。
export function nextOccurrence(
  dueAt: string | null,
  ruleString: string | null,
  now: Date = new Date()
): Date | null {
  if (!dueAt || !ruleString) return null

  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null

  // 月末语义统一（产品已拍板）：只含 FREQ[+INTERVAL] 的 MONTHLY 规则——预设
  // 「每月」与自定义编辑器能产出的全部月频形态——一律走钳制路径，把 29–31 日
  // 钳到短月最后一天而不是整月跳过。用户从「每月」切到「每 2 月」不会再遭遇
  // 不同的月末行为。含 BYMONTHDAY/BYSETPOS 等复杂子句（或子句乱序）的
  // MONTHLY 规则不匹配此形态，仍走下方 rrule 路径：钳制算法表达不了这些
  // 子句，自定义编辑器也不支持它们。DAILY/WEEKLY/YEARLY 保持 rrule 不变。
  const monthly = /^FREQ=MONTHLY(?:;INTERVAL=(\d+))?$/i.exec(ruleString)
  if (monthly) {
    return nextMonthlyClamped(due, now, monthly[1] ? parseInt(monthly[1], 10) : 1)
  }

  try {
    const options = RRule.parseString(ruleString)
    const wallStart = toWallTime(due)
    options.dtstart = wallStart
    const rule = new RRule(options)

    // 锚点取 due 与 now 在墙钟空间的较晚者：下一次实例必须严格晚于 due
    // （完成当前实例不会再生成它自己），也必须晚于 now。rule.after 直接
    // 跳到锚点之后的第一个候选，不再从 due 起逐个迭代逾期区间——
    // 每天重复逾期三年（>1000 天）也不会断链。
    const nowWall = toWallTime(now)
    const anchor = nowWall.getTime() > wallStart.getTime() ? nowWall : wallStart
    let nextWall = rule.after(anchor, false)

    // 墙钟 → 真实瞬间的回读在 DST 回拨时可能落在 now 之前（同一墙钟小时
    // 出现两次，fromWallTime 取较早的一次），此时沿规则再推进一格。
    // 上限只覆盖 DST 歧义（至多一两步），与逾期时长完全无关。
    for (let i = 0; nextWall && i < 3; i += 1) {
      const next = fromWallTime(nextWall)
      if (next.getTime() > now.getTime()) return next
      nextWall = rule.after(nextWall, false)
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