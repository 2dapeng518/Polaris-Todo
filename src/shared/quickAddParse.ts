import { format, isBefore, isSameDay, startOfDay } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { DEFAULT_LOCALE, translate, type Locale, type MessageKey } from './i18n'

// Quick-add natural-language parsing. Pure: no React, no DOM, no Node.
//
// Every offset in this file is a UTF-16 code unit index into the ORIGINAL input
// string, half-open [start, end) — the same coordinate system as String.slice
// and setSelectionRange. An emoji occupies two units. Switching to code point
// counting would silently misalign both the caret and the title.
//
// Chinese has no word boundaries, so \b and lookbehind are useless here. Safety
// comes from three places instead: explicit character guards, a mask table for
// known false positives, and head/tail anchoring (a date in the middle of a
// sentence is never consumed).
//
// 英文层（Step 2b）有词边界，所以它用 lookbehind 和自己的一套守卫；候选仍进
// 同一个列表、走同一套下游步骤，且与界面语言无关。

export type Span = { start: number; end: number }

export type TokenKind =
  | 'relative'
  | 'relcomp'
  | 'weekday'
  | 'monthday'
  | 'iso'
  | 'clockCn'
  | 'clock24'
  | 'range'
  | 'period'
  | 'offsetEn'
  | 'project'
  | 'priority'

export type ParseToken = {
  kind: TokenKind
  start: number
  end: number
  text: string
  key: string
}

export type ChipId = 'due' | 'project' | 'priority'

export type ParseChip = {
  id: ChipId
  label: string
  ariaLabel: string
  source: string
  tokenKeys: string[]
  spans: Span[]
  past: boolean
  assumed: boolean
}

export type ParseNotice = {
  kind: 'miss' | 'ambiguous'
  name: string
  span: Span
  text: string
}

export type QuickAddParse = {
  raw: string
  title: string
  dueAt: string | null
  /** 计划时间段（区间语法「3点到5点」）：dueAt === startAt，endAt 是结束端。
   *  非区间输入恒为 null。 */
  startAt: string | null
  endAt: string | null
  projectId: string | null
  priority: number
  timeExplicit: boolean
  assumed: boolean
  tokens: ParseToken[]
  chips: ParseChip[]
  notices: ParseNotice[]
  emptyTitle: boolean
  tooLong: boolean
  announcement: string
  signature: string
  /** key -> how many candidates actually survived the guards and masks. This is
   *  what dismissKeys records, so suppression tracks recognition, not text. */
  candidateCounts: ReadonlyMap<string, number>
}

export type ParseContext = {
  now: Date
  projects: ReadonlyArray<{ id: string; name: string }>
  dismissed: ReadonlyMap<string, number>
  /** 只影响显示文案；中文自然语言语法保持不变。 */
  locale?: Locale
}

export const QUICK_ADD_TITLE_MAX = 500

const FULLWIDTH: Record<string, string> = {
  '＃': '#',
  '！': '!',
  '：': ':',
  '　': ' ',
  '０': '0',
  '１': '1',
  '２': '2',
  '３': '3',
  '４': '4',
  '５': '5',
  '６': '6',
  '７': '7',
  '８': '8',
  '９': '9'
}

// 句末感叹号必须参与合并：日期 token 只有吞掉紧随的标点才能触到串尾锚点，
// 否则「Call mom tomorrow!」「交报告 明天！」整段不识别（norm 已把 ！→!）。
const PUNCT = '，,。.;；、：:？?!！'
const ZH = '零〇一二两三四五六七八九十'
const NUM = `(?:[0-9]{1,3}|[${ZH}]{1,4})`
const NUM3 = `(?:[0-9]{1,2}|[${ZH}]{1,3})`
const WD = '一二三四五六日天1-7'

// Explicit lookup tables. Never derive these with indexOf: WD holds eight
// characters for seven weekdays ('天' would shift by one) and ZH holds both
// '零' and '〇' (every digit after them would shift).
const DOW_IDX: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
}
const ZH_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}

const PERIODS = '凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|夜晚'
const BARE_PERIODS = ['凌晨', '早上', '早晨', '上午', '中午', '下午', '傍晚', '晚上']
const PERIOD_DEFAULT: Record<string, number> = {
  凌晨: 5, 早上: 7, 早晨: 7, 上午: 9, 中午: 12, 下午: 15, 傍晚: 18, 晚上: 20,
  // 英文时段词的默认时刻与中文对应时段对齐：morning 取「上午」9 点，
  // afternoon 取「下午」15 点，evening 取「晚上」20 点。
  morning: 9, afternoon: 15, evening: 20
}
const WEAK_DEFAULT: Record<string, number> = { 晚上: 20, 早上: 7 }

const COMPOUNDS = [
  '下午茶', '早上好', '上午好', '中午好', '下午好', '晚上好', '傍晚好',
  '今日头条', '明天会更好', '周六福', '周一围', '明早期', '明晚期', '半价', '半成品'
]

const CUES = /^(?:记得|别忘了|别忘记|不要忘记|提醒我|记一下|安排一下|计划)/
const RIGHT_TIME = /^(?:左右|多|前后|以后|之后|小时|钟头|个小时|差|过|缺)/
const BARE_HOUR_NOUN =
  /^(?:方向|方位|注意|建议|要求|意见|想法|心得|体会|总结|原因|理由|问题|措施|好处|优势|不同|区别|改进|补充|经验|教训|考虑|思路|策略|原则|标准|条件|前提)/
const SUFFIX = `(?:之前|以前|之内|以内|前(?![0-9${ZH}几面方]))?`

const MASKS: RegExp[] = [
  /(?:大前天|前天|昨天|昨日|去年|上个月|上月)/g,
  /(?:上上|上)(?:个)?(?:周|星期|礼拜)(?:[一二三四五六日天1-7])?/g,
  /每(?:个)?(?:(?:周|星期|礼拜)(?:[一二三四五六日天1-7])?|工作日|工作天|天|日|月|年)/g,
  new RegExp(`[0-9一二两三四五六七八九十几半数]{1,3}(?:个)?(?:周|星期|礼拜)[${WD}]`, 'g'),
  new RegExp(
    `(?:周|星期|礼拜)[${WD}](?=[个次天种位名项条份遍轮套场篇本人家台件张只杯瓶盒袋斤米层组批波顿口步元块岁架辆艘支根棵颗粒间座栋幢所部册幅副对双打捆扎串堆排行列群帮伙])`,
    'g'
  ),
  new RegExp(`(?:下下|下|本|这)?(?:个)?(?:周|星期|礼拜)[${WD}]\\s*[点时]`, 'g'),
  new RegExp(`第\\s*${NUM}\\s*[点时条项章段页]`, 'g'),
  /[点时]\s*[0-9]{1,2}(?![0-9])(?!\s*分(?!钟))/g,
  new RegExp(`(?:周|星期|礼拜)[${WD}][一二三四五六日天]`, 'g'),
  /(?:周|星期|礼拜)[日天](?=[程报志期常结元照历刊记])/g,
  new RegExp(`差\\s*${NUM3}\\s*(?:分|刻)\\s*${NUM3}\\s*[点时]`, 'g'),
  new RegExp(`(?:周|星期|礼拜)[${WD}]\\s*(?:到|至|~|—|-)\\s*(?:周|星期|礼拜)?[${WD}]`, 'g')
  // 时钟区间（「3点到5点」「10:00-11:30」）的掩码已解除：日历套件 P2.4 起
  // 区间是真实语法（TokenKind 'range' → startAt/endAt），不再是误报屏蔽。
]

const RE = {
  relative: new RegExp(`(大后天|后天|明天|明日|今天|今日|明儿|今儿)${SUFFIX}`, 'g'),
  relcomp: new RegExp(`(今|明|后)(晚|早|晨)${SUFFIX}`, 'g'),
  weekday: new RegExp(`(下下|下|本|这)?(?:个)?(?:周|星期|礼拜)([${WD}])${SUFFIX}`, 'g'),
  monthday: new RegExp(`(?:([0-9]{4})\\s*年\\s*)?(${NUM3})\\s*月\\s*(${NUM3})\\s*[日号]${SUFFIX}`, 'g'),
  iso: /([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?![0-9:.T-])/g,
  clockCn: new RegExp(
    `((?:${PERIODS})[ \\t]*)?(${NUM3})\\s*[点时](?![间光代候期])(钟|半(?!价|成品|岛|年|天|小时|个)|一刻|三刻|${NUM3}\\s*分(?!钟))?`,
    'g'
  ),
  clock24: new RegExp(`((?:${PERIODS})[ \\t]*)?([0-9]{1,2}):([0-9]{2})(?![0-9:])`, 'g'),
  period: new RegExp(`(${BARE_PERIODS.join('|')})`, 'g'),
  project: /(^|[^!-~])#([^\s#]{1,80})/g,
  priority: /(^|[^!-~])!([高中低]|[123]|high|medium|med|low)(?![\p{L}\p{N}])/giu
}

const LOOSE_CLOCK = new RegExp(`((?:${PERIODS})[ \\t]*)?${NUM3}\\s*[点时]`, 'g')
const SUFFIX_HEAD = new RegExp(`^(?:半|钟|一刻|三刻|${NUM3}\\s*分)`)

// ---------- 时钟区间（「3点到5点」「10:00-11:30」「3pm to 5pm」） ----------
// 区间由两个钟点侧 + 连接词组成。每侧沿用 clockCn / clock24 的同一套词表与
// 校验（时段词可选、半/刻/分后缀、applyPeriod 语义），因此裸「5点」结尾同样
// 走「1-6 点按下午读」的约定：3点到5点 = 15:00–17:00。结束端早于开始端时
// 顺延一天（晚上11点到凌晨1点 → 次日 01:00）。两侧必须同构（都用 [点时]
// 或都用 HH:MM），混写不认、原样留在标题。
const CLOCK_CN_TAIL = `(钟|半(?!价|成品|岛|年|天|小时|个)|一刻|三刻|${NUM3}\\s*分(?!钟))?`
const RE_RANGE_CN = new RegExp(
  `((?:${PERIODS})[ \\t]*)?(${NUM3})\\s*[点时]${CLOCK_CN_TAIL}\\s*(?:到|至|~|—|-)\\s*((?:${PERIODS})[ \\t]*)?(${NUM3})\\s*[点时]${CLOCK_CN_TAIL}`,
  'g'
)
const RE_RANGE_24 = /([0-9]{1,2}):([0-9]{2})\s*(?:到|至|~|—|-)\s*([0-9]{1,2}):([0-9]{2})/g
const EN_RANGE_CONNECT = '[ \\t]*(?:to|–|—|-)[ \\t]*'
// 前导 at 必须属于区间本身：EN_CLOCK_AMPM 也会把「at 3pm」单独收成一个钟点，
// 两者部分重叠时 Step 3 会把「区间 + 散钟点」一起丢掉。让区间从 at 起算，
// 散钟点就被完整包含，按「同起点、长者优先」的既有规则出局。
const RE_RANGE_EN_AMPM = new RegExp(
  `(?<![A-Za-z0-9])(?:at[ \\t]+)?(\\d{1,2})(?::(\\d{2}))?[ \\t]*(am|pm)${EN_RANGE_CONNECT}(\\d{1,2})(?::(\\d{2}))?[ \\t]*(am|pm)?(?![A-Za-z0-9])`,
  'gi'
)
const RE_RANGE_EN_24 = new RegExp(
  `(?<![A-Za-z0-9])(\\d{1,2}):(\\d{2})${EN_RANGE_CONNECT}(\\d{1,2}):(\\d{2})(?![0-9A-Za-z:])`,
  'g'
)

// ---------- English layer ----------
// 英文语法与界面语言无关：输入里出现英文日期词就识别，界面语言只决定 chip
// 文案。坐标系仍沿用 UTF-16 半开区间，emoji 占两个单位。
//
// 英文有词边界，所以这里用 lookbehind 限定 ASCII 字母数字，而不是中文那套
// 字符守卫：'join 2 hours' 里的 in、'tomorrowland' 里的 tomorrow 都不能命中。
const EN_MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12
}
// JS getDay()：周日 0。换算成周一 0 后即可复用中文 weekday 的 delta 公式。
const EN_WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6
}
const EN_WEEKDAY_FULL = new Set([
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
])
const EN_MONTH_ALT =
  'january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec'
const EN_WEEKDAY_ALT =
  'monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun'

const EN_RELATIVE =
  /(?<![A-Za-z])(?:the[ \t]+)?(day after tomorrow|tonight|tomorrow|today|tmr|tmw)(?![A-Za-z'])/gi
const EN_WEEKDAY = new RegExp(
  `(?<![A-Za-z])(?:(next|this|on)[ \\t]+)?(${EN_WEEKDAY_ALT})(?![A-Za-z'])`,
  'gi'
)
const EN_CLOCK_AMPM =
  /(?<![A-Za-z0-9])(?:at[ \t]+)?(\d{1,2})(?::(\d{2}))?[ \t]*(am|pm)(?![A-Za-z])/gi
// 没有 am/pm 的 'at 3' / 'at 3:30'，语义与中文裸数字小时一致（applyPeriod(null, h)）。
const EN_CLOCK_AT =
  /(?<![A-Za-z0-9])at[ \t]+(\d{1,2})(?::(\d{2}))?(?![A-Za-z0-9:])(?![ \t]*(?:am|pm))/gi
const EN_NOON = /(?<![A-Za-z])(noon|midnight)(?![A-Za-z'])/gi
const EN_PERIOD = /(?<![A-Za-z])(morning|afternoon|evening)(?![A-Za-z'])/gi
const EN_OFFSET =
  /(?<![A-Za-z])in[ \t]+(\d{1,3})[ \t]+(hours?|minutes?|mins?|days?|weeks?)(?![A-Za-z])/gi
const EN_MONTH_FIRST = new RegExp(
  `(?<![A-Za-z0-9])(${EN_MONTH_ALT})\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?(?:,?[ \\t]+(\\d{4}))?(?![A-Za-z0-9])`,
  'gi'
)
const EN_DAY_FIRST = new RegExp(
  `(?<![A-Za-z0-9])(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(?:of[ \\t]+)?(${EN_MONTH_ALT})(?:,?[ \\t]+(\\d{4}))?(?![A-Za-z0-9])`,
  'gi'
)
// 美式 月/日。前后都不许再挨着数字或斜杠，避免把 2026/12/25 这类串吃掉一截。
const EN_NUMERIC_MD = /(?<![A-Za-z0-9/])(\d{1,2})\/(\d{1,2})(?![0-9A-Za-z/])/g
// 问候语整体掩掉，否则 'Good morning' 会被当成 9 点，标题只剩 Good。
const EN_COMPOUNDS = /(?<![A-Za-z])good[ \t]+(?:morning|afternoon|evening|night)(?![A-Za-z])/gi

// 缩写既是星期词也是常见词/名字。裸缩写（没有 next/this/on 引导）只在
// 「像日期」时消费：小写且后面不跟小写单词（'sat down'、'mon dieu'），
// 句首大写但后面不跟专有名词（'Sun Microsystems'），且前面不是代词
// （'I sat'、'we sat'）。
const EN_ABBREV_PRONOUN = /^(?:i|we|you|he|she|it|they|me|us|them|a|an|the)$/i
/** 优先级的显示短名：解析语法认中文、数字与 !high/!med/!low，这里只负责怎么说。 */
function priorityText(locale: Locale, priority: number): string {
  const value = priority >= 1 && priority <= 3 ? priority : 0
  return translate(locale, `detail.priorityOption.${value}` as MessageKey)
}

function assumedText(locale: Locale): string {
  return translate(locale, 'quickAdd.assumedSuffix')
}
const DATE_KINDS: TokenKind[] = ['relative', 'relcomp', 'weekday', 'monthday', 'iso']

type Cand = {
  kind: TokenKind
  start: number
  end: number
  off?: number
  weak?: string
  date?: Date
  assumed?: boolean
  h?: number
  dayOff?: number
  min?: number
  period?: string | null
  bare?: boolean
  oneDigit?: boolean
  /** 区间（'range'）专有：结束端（已按 endPeriod 应用 applyPeriod 的结果）。
   *  弱时段（「今晚8点到10点」）在 Step 6 里按开始侧同一规则重推。 */
  endH?: number
  endMin?: number
  endDayOff?: number
  endBare?: boolean
  projectId?: string
  name?: string
  dup?: boolean
  priority?: number
  ms?: number
  coreStart?: number
  coreEnd?: number
}

// Length-preserving normalization: every mapping swaps one UTF-16 unit for one
// unit, so offsets into the normalized string are offsets into the raw string.
// Never trim, never collapse whitespace, never NFKC.
function norm(value: string): string {
  let out = ''
  for (const ch of value) out += FULLWIDTH[ch] ?? ch
  return out
}

function zhNum(value: string): number {
  if (/^[0-9]+$/.test(value)) return Number(value)
  if (value.includes('十')) {
    const [a, b] = value.split('十')
    const tens = a === '' ? 1 : ZH_DIGIT[a]
    const ones = b === undefined || b === '' ? 0 : ZH_DIGIT[b]
    if (tens === undefined || ones === undefined) return NaN
    return tens * 10 + ones
  }
  if (value.length === 1) return ZH_DIGIT[value] ?? NaN
  return NaN
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

function contains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && outer.end >= inner.end
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function at(date: Date, hour: number, minute: number, second = 0): Date {
  const next = new Date(date)
  next.setHours(hour, minute, second, 0)
  return next
}

// Returns [hour, dayOffset] or null for an illegal period/hour combination.
function applyPeriod(period: string | null | undefined, hour: number): [number, number] | null {
  if (!period) {
    if (hour === 24) return [0, 1]
    if (hour === 0) return [0, 0]
    if (hour >= 1 && hour <= 6) return [hour + 12, 0]
    if (hour >= 7 && hour <= 23) return [hour, 0]
    return null
  }
  if (period === '凌晨') {
    if (hour === 12) return [0, 0]
    if (hour >= 0 && hour <= 11) return [hour, 0]
    return null
  }
  if (period === '早上' || period === '早晨') {
    if (hour >= 1 && hour <= 11) return [hour, 0]
    return null
  }
  if (period === '上午') {
    if (hour === 12) return [12, 0]
    if (hour >= 0 && hour <= 11) return [hour, 0]
    return null
  }
  if (period === '中午') {
    if (hour === 11 || hour === 12) return [hour, 0]
    if (hour === 1 || hour === 2) return [hour + 12, 0]
    return null
  }
  if (period === '下午' || period === '傍晚') {
    if (hour === 12) return [12, 0]
    if (hour >= 1 && hour <= 11) return [hour + 12, 0]
    return null
  }
  // 夜里时段（晚上 / 夜里 / 半夜 / 夜晚）：1–6 点属于「接下来的那个凌晨」，
  // 不是当天下午。返回 [24 小时制小时, 天数偏移]，调用方把偏移加到基准日上：
  // 今晚1点 = 次日 01:00；明晚1点（基准日已是明天）再加一天 = 后天 01:00。
  // 12/24 是午夜；0 必须返回 null——弱时段「今晚12点」在无时段阶段已把
  // 12 点解成 [0, 1]，随后以 hour - 12（= 0）再次调用这里，返回 [0, 0]
  // 会把已算好的次日偏移抹掉。
  if (period === '晚上' || period === '夜里' || period === '半夜' || period === '夜晚') {
    if (hour === 12 || hour === 24) return [0, 1]
    if (hour >= 7 && hour <= 11) return [hour + 12, 0]
    if (hour >= 1 && hour <= 6) return [hour, 1]
    return null
  }
  if (hour === 12 || hour === 24) return [0, 1]
  if (hour >= 1 && hour <= 11) return [hour + 12, 0]
  return null
}

/** Interval-overlap query in O(log n). The naive `spans.some(overlaps)` is
 *  quadratic, and quick-add parses on every keystroke — pasting a long run of
 *  repeated date words would freeze the renderer. */
function overlapIndex(spans: readonly Span[]): (target: Span) => boolean {
  if (!spans.length) return () => false
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const maxEnd: number[] = []
  let running = -Infinity
  for (const span of sorted) {
    running = Math.max(running, span.end)
    maxEnd.push(running)
  }
  return (target) => {
    let lo = 0
    let hi = sorted.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid].start < target.end) {
        idx = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return idx >= 0 && maxEnd[idx] > target.start
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** Drop dismissals whose text no longer occurs often enough to still be held.
 *  Identity-preserving: returns the same Map when nothing changes, so callers
 *  can safely use it inside a setState without triggering a render loop. */
export function pruneDismissed(
  parseText: string,
  dismissed: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
  if (!dismissed.size) return dismissed
  const haystack = norm(parseText).toLowerCase()
  let changed = false
  const next = new Map<string, number>()
  for (const [key, count] of dismissed) {
    const text = key.slice(key.indexOf('|') + 1)
    if (countOccurrences(haystack, text) >= count) next.set(key, count)
    else changed = true
  }
  return changed ? next : dismissed
}

/** Record a dismissal as "this text occurred N times when I dismissed it".
 *  Counting rather than a boolean means deleting one occurrence releases the
 *  other ('明天交报告 明天'). Normalization lives here so the component never
 *  has to duplicate it. */
export function dismissKeys(
  keys: readonly string[],
  dismissed: ReadonlyMap<string, number>,
  recognizable: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
  if (!keys.length) return dismissed
  const next = new Map(dismissed)
  for (const key of keys) {
    // Count recognizable candidates, not raw substrings: an occurrence the
    // guards rejected ('周五那份稿') must not inflate the count, or editing the
    // title alone would release the suppression and resurrect a cancelled date.
    next.set(key, recognizable.get(key) ?? 0)
  }
  return next
}

export function formatParsedDue(
  value: string | null,
  timeExplicit: boolean,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
  endAt?: string | null
): string {
  if (!value) return translate(locale, 'quickAdd.dueNone')
  const date = new Date(value)
  const dateLocale = locale === 'en' ? enUS : zhCN
  const today = translate(locale, 'dates.today')
  const tomorrow = translate(locale, 'dates.tomorrow')
  // 区间时间尾（「10:00 – 11:30」）：只在显式时间且带了 endAt 时出现。
  const rangeTail =
    timeExplicit && endAt ? ` – ${format(new Date(endAt), 'HH:mm')}` : ''
  // 「今天 / 明天」必须对着传进来的 now 判，不能用 date-fns 的 isToday /
  // isTomorrow：那两个读的是真实时钟，冒烟注入的时钟一换就和 chip 说的日子
  // 打架（解析说「明天」，显示却给「11月13日」）。
  const dayStart = startOfDay(now)
  if (isSameDay(date, dayStart)) return timeExplicit ? `${today} ${format(date, 'HH:mm')}${rangeTail}` : today
  if (isSameDay(date, addDays(dayStart, 1))) {
    return timeExplicit ? `${tomorrow} ${format(date, 'HH:mm')}${rangeTail}` : tomorrow
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  const stem =
    locale === 'en'
      ? format(date, sameYear ? 'MMM d' : 'MMM d, yyyy', { locale: dateLocale })
      : format(date, `${sameYear ? '' : 'yyyy年'}M月d日`, { locale: dateLocale })
  const tail = timeExplicit
    ? `${format(date, ' HH:mm')}${rangeTail}`
    : ' ' + format(date, 'EEE', { locale: dateLocale })
  if (isBefore(date, startOfDay(now))) {
    return `${translate(locale, 'dates.overdue')} · ${stem}${tail}`
  }
  return `${stem}${tail}`
}

function sourceOf(raw: string, tokens: ParseToken[]): string {
  if (!tokens.length) return ''
  const sorted = [...tokens].sort((a, b) => a.start - b.start)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (/^\s*$/.test(raw.slice(first.end, last.start))) return raw.slice(first.start, last.end)
  return sorted.map((token) => token.text).join(' ')
}

export function parseQuickAdd(raw: string, ctx: ParseContext): QuickAddParse {
  const { now, projects, dismissed, locale = DEFAULT_LOCALE } = ctx
  const normalized = norm(raw)
  const poisoned: Span[] = []
  const cands: Cand[] = []
  const misses: ParseNotice[] = []
  const markers: Cand[] = []

  // Step 1 — markers. #project and !priority are located first so their spans
  // can be blanked out before the date scan; otherwise a trailing '#工作' would
  // stop the tail anchor before it ever reaches the date.
  for (const match of normalized.matchAll(RE.project)) {
    const at0 = match.index + match[1].length
    const run = match[2].replace(new RegExp(`[${PUNCT}]+$`), '')
    if (!run) continue
    const boundaryOk = (offset: number): boolean => {
      const ch = normalized[at0 + 1 + offset]
      return ch === undefined || /\s/.test(ch) || new RegExp(`[${PUNCT}！!#＃]`).test(ch)
    }
    let hit: { id: string; name: string } | null = null
    const longestFirst = [...projects].sort((a, b) => b.name.length - a.name.length)
    for (const project of longestFirst) {
      const slice = normalized.slice(at0 + 1, at0 + 1 + project.name.length)
      // Normalize the stored name too: a project legitimately called '项目１'
      // or 'C＃' must still match when the user types its normalized form.
      if (slice.toLowerCase() === norm(project.name).toLowerCase() && boundaryOk(project.name.length)) {
        hit = project
        break
      }
    }
    if (!hit) {
      hit = projects.find((project) => norm(project.name).toLowerCase() === run.toLowerCase()) ?? null
    }
    if (hit) {
      const end = at0 + 1 + hit.name.length
      const twins = projects.filter((p) => p.name.toLowerCase() === hit!.name.toLowerCase()).length
      markers.push({
        kind: 'project',
        start: at0,
        end,
        projectId: hit.id,
        name: hit.name,
        dup: twins > 1
      })
    } else if (!/^[0-9]+$/.test(run)) {
      misses.push({
        kind: 'miss',
        name: run,
        span: { start: at0, end: at0 + 1 + run.length },
        text: translate(locale, 'quickAdd.miss', { name: run })
      })
    }
  }

  for (const match of normalized.matchAll(RE.priority)) {
    const at0 = match.index + match[1].length
    const rawWord = match[2]
    // 中文与数字按原文查表；英文词（可能大小写混写）统一转小写。
    const word = /^[0-9]$/.test(rawWord) || /^[高中低]$/.test(rawWord) ? rawWord : rawWord.toLowerCase()
    const value: Record<string, number> = {
      高: 3, 中: 2, 低: 1, '1': 1, '2': 2, '3': 3,
      high: 3, medium: 2, med: 2, low: 1
    }
    markers.push({
      kind: 'priority',
      start: at0,
      // 标记长度不再写死为 2：'!high' 是 5 个字符。
      end: at0 + 1 + rawWord.length,
      priority: value[word]
    })
  }

  const liveMarkers = markers.filter((marker) => !marker.dup)
  const ambiguous = markers.find((marker) => marker.dup) ?? null

  // Ambiguous markers are masked too. Otherwise a duplicate project literally
  // named '明天' would be re-scanned as a date and eat its own text.
  let masked = normalized
  for (const marker of markers) {
    masked = masked.slice(0, marker.start) + ' '.repeat(marker.end - marker.start) + masked.slice(marker.end)
  }

  // Step 2 — enumerate candidates behind the mask table and the guards.
  const blocked: Span[] = []
  for (const mask of MASKS) {
    for (const match of masked.matchAll(mask)) {
      blocked.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  for (const miss of misses) blocked.push({ ...miss.span })

  const compounds: Span[] = []
  for (const word of COMPOUNDS) {
    let index = masked.indexOf(word)
    while (index !== -1) {
      compounds.push({ start: index, end: index + word.length })
      index = masked.indexOf(word, index + 1)
    }
  }
  // 英文问候语同样整体掩掉：'Good morning' 是问候，不是 9 点的时段词。
  for (const match of masked.matchAll(EN_COMPOUNDS)) {
    compounds.push({ start: match.index, end: match.index + match[0].length })
  }

  const compoundsHit = overlapIndex(compounds)

  const guard = (kind: TokenKind, start: number, end: number): boolean => {
    const left = masked[start - 1]
    const right = masked.slice(end)
    if (right.startsWith('的') || /^(?:那|这)/.test(right)) return false
    if (compoundsHit({ start, end })) return false
    if (kind === 'monthday' || kind === 'iso' || kind === 'clock24' || kind === 'clockCn' || kind === 'range') {
      if (left !== undefined && /[0-9]/.test(left)) return false
      if ((left === '.' || left === '。') && /[0-9]/.test(masked[start - 2] ?? '')) return false
    }
    if (kind === 'iso' && (left === '-' || left === '.')) return false
    if (kind === 'clockCn' || kind === 'clock24' || kind === 'range') {
      if (left === '第') return false
      if (RIGHT_TIME.test(right)) return false
    }
    if (kind === 'clock24' && left === ':' && /[0-9]/.test(masked[start - 2] ?? '')) return false
    if (kind === 'clock24' && /[0-9:]/.test(right[0] ?? '')) return false
    if (kind === 'relcomp' && right.startsWith('期')) return false
    if (
      kind === 'relative' &&
      /^(?:今日|明日)/.test(masked.slice(start, end)) &&
      /^[报志程常结元照历刊记]/.test(right)
    ) {
      return false
    }
    if (kind === 'period' && new RegExp(`^\\s*${NUM3}\\s*[点时]`).test(right)) return false
    return true
  }

  const push = (kind: TokenKind, start: number, end: number, data: Partial<Cand>): void => {
    if (!guard(kind, start, end)) {
      if (kind === 'clockCn' || kind === 'clock24') poisoned.push({ start, end })
      return
    }
    cands.push({ kind, start, end, ...data })
  }

  for (const match of masked.matchAll(RE.relative)) {
    const offsets: Record<string, number> = {
      '大后天': 3, 后天: 2, 明天: 1, 明日: 1, 明儿: 1, 今天: 0, 今日: 0, 今儿: 0
    }
    push('relative', match.index, match.index + match[0].length, { off: offsets[match[1]] })
  }

  for (const match of masked.matchAll(RE.relcomp)) {
    const offsets: Record<string, number> = { 今: 0, 明: 1, 后: 2 }
    push('relcomp', match.index, match.index + match[0].length, {
      off: offsets[match[1]],
      weak: match[2] === '晚' ? '晚上' : '早上'
    })
  }

  for (const match of masked.matchAll(RE.weekday)) {
    const idx = DOW_IDX[match[2]]
    const dow = (startOfDay(now).getDay() + 6) % 7
    const target = (idx + 6) % 7
    const prefix = match[1]
    let delta: number
    if (prefix === '下') delta = 7 - dow + target
    else if (prefix === '下下') delta = 14 - dow + target
    else if (prefix === '本' || prefix === '这') delta = target - dow
    else delta = (target - dow + 7) % 7
    // 本/这 pointing backwards means yesterday. Refuse the whole span rather
    // than silently aliasing it to the next occurrence.
    if (delta < 0) {
      blocked.push({ start: match.index, end: match.index + match[0].length })
      continue
    }
    push('weekday', match.index, match.index + match[0].length, { off: delta })
  }

  for (const match of masked.matchAll(RE.monthday)) {
    const month = zhNum(match[2])
    const day = zhNum(match[3])
    const start = match.index
    const end = match.index + match[0].length
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) {
      poisoned.push({ start, end })
      continue
    }
    let picked: Date | null = null
    let assumed = false
    if (match[1]) {
      const year = Number(match[1])
      const candidate = new Date(year, month - 1, day)
      if (
        candidate.getFullYear() === year &&
        candidate.getMonth() === month - 1 &&
        candidate.getDate() === day
      ) {
        picked = candidate
      }
    } else {
      for (let k = 0; k < 5; k += 1) {
        const year = now.getFullYear() + k
        const candidate = new Date(year, month - 1, day)
        if (
          candidate.getFullYear() === year &&
          candidate.getMonth() === month - 1 &&
          candidate.getDate() === day &&
          candidate >= startOfDay(now)
        ) {
          picked = candidate
          assumed = k > 0
          break
        }
      }
    }
    if (!picked) {
      poisoned.push({ start, end })
      continue
    }
    push('monthday', start, end, { date: picked, assumed })
  }

  for (const match of masked.matchAll(RE.iso)) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const candidate = new Date(year, month - 1, day)
    const start = match.index
    const end = match.index + match[0].length
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month - 1 ||
      candidate.getDate() !== day
    ) {
      poisoned.push({ start, end })
      continue
    }
    push('iso', start, end, { date: candidate })
  }

  const clockSurvivors: Cand[] = []
  for (const match of masked.matchAll(RE.clockCn)) {    const start = match.index
    const end = match.index + match[0].length
    const period = match[1]?.trim()
    const arabic = /^[0-9]+$/.test(match[2])
    const hour = zhNum(match[2])
    const suffix = match[3]
    let minute = 0
    if (suffix === '半') minute = 30
    else if (suffix === '一刻') minute = 15
    else if (suffix === '三刻') minute = 45
    else if (suffix && suffix !== '钟') minute = zhNum(suffix.replace(/\s*分$/, ''))
    const bad = (): void => {
      poisoned.push({ start, end })
    }
    if (!suffix && SUFFIX_HEAD.test(masked.slice(end))) { bad(); continue }
    if (!arabic && !period && !suffix) { bad(); continue }
    if (!period && !suffix && BARE_HOUR_NOUN.test(masked.slice(end))) { bad(); continue }
    if (!(hour >= 0 && hour <= 24) || !(minute >= 0 && minute <= 59)) { bad(); continue }
    const applied = applyPeriod(period, hour)
    if (!applied) { bad(); continue }
    if (!guard('clockCn', start, end)) { bad(); continue }
    const cand: Cand = {
      kind: 'clockCn',
      start,
      end,
      h: applied[0],
      dayOff: applied[1],
      min: minute,
      period: period ?? null,
      bare: !period && hour >= 1 && hour <= 6,
      assumed: !period
    }
    cands.push(cand)
    clockSurvivors.push(cand)
  }

  for (const match of masked.matchAll(RE.clock24)) {
    const start = match.index
    const end = match.index + match[0].length
    const period = match[1]?.trim()
    const hour = Number(match[2])
    const minute = Number(match[3])
    const bad = (): void => {
      poisoned.push({ start, end })
    }
    if (!(hour >= 0 && hour <= 24) || minute > 59) { bad(); continue }
    const applied = applyPeriod(period, hour)
    if (!applied) { bad(); continue }
    if (!guard('clock24', start, end)) { bad(); continue }
    const cand: Cand = {
      kind: 'clock24',
      start,
      end,
      h: applied[0],
      dayOff: applied[1],
      min: minute,
      period: period ?? null,
      bare: false,
      assumed: false,
      oneDigit: !period && match[2].length === 1
    }
    cands.push(cand)
    clockSurvivors.push(cand)
  }

  for (const match of masked.matchAll(RE.period)) {
    push('period', match.index, match.index + match[0].length, { period: match[1] })
  }

  // ---------- 区间扫描（日历套件 P2.4） ----------
  // 单侧钟点的解析：与 clockCn 循环同一套后缀/校验/applyPeriod 语义，但失败
  // 返回 null 由区间扫描整体 poison。刻意不重构 clockCn 循环本体——那段
  // 流水线顺序是承重墙（步骤注释见上）。
  type ClockSide = {
    h: number
    dayOff: number
    min: number
    period: string | null
    bare: boolean
    assumed: boolean
  }
  const parseClockSide = (
    periodText: string | undefined,
    numText: string,
    suffixText: string | undefined,
    textAfter: string
  ): ClockSide | null => {
    const period = periodText?.trim()
    const arabic = /^[0-9]+$/.test(numText)
    const hour = zhNum(numText)
    let minute = 0
    if (suffixText === '半') minute = 30
    else if (suffixText === '一刻') minute = 15
    else if (suffixText === '三刻') minute = 45
    else if (suffixText && suffixText !== '钟') minute = zhNum(suffixText.replace(/\s*分$/, ''))
    if (suffixText === undefined && SUFFIX_HEAD.test(textAfter)) return null
    if (!arabic && !period && !suffixText) return null
    if (!(hour >= 0 && hour <= 24) || !(minute >= 0 && minute <= 59)) return null
    const applied = applyPeriod(period, hour)
    if (!applied) return null
    return {
      h: applied[0],
      dayOff: applied[1],
      min: minute,
      period: period ?? null,
      bare: !period && hour >= 1 && hour <= 6,
      assumed: !period
    }
  }

  const pushRangeCand = (cand: Cand): void => {
    cands.push(cand)
    clockSurvivors.push(cand)
  }

  // 中文区间（「下午3点到5点半」）。分组：1 起点时段 / 2 起点数 / 3 起点后缀 /
  // 4 终点时段 / 5 终点数 / 6 终点后缀。守卫不过或任一侧非法 → 整段 poison：
  // 两侧的散钟点候选随后被 blockedHit 掉，区间整体回到「留在标题」的旧行为，
  // 绝不半解析。
  for (const match of masked.matchAll(RE_RANGE_CN)) {
    const start = match.index
    const end = start + match[0].length
    const startNumEnd = start + (match[1]?.length ?? 0) + match[2].length
    const startSide = parseClockSide(match[1], match[2], match[3], masked.slice(startNumEnd))
    const endSide = parseClockSide(match[4], match[5], match[6], masked.slice(end))
    if (!startSide || !endSide) {
      poisoned.push({ start, end })
      continue
    }
    if (!guard('range', start, end)) {
      poisoned.push({ start, end })
      continue
    }
    pushRangeCand({
      kind: 'range',
      start,
      end,
      h: startSide.h,
      dayOff: startSide.dayOff,
      min: startSide.min,
      period: startSide.period,
      bare: startSide.bare,
      assumed: startSide.assumed,
      endH: endSide.h,
      endMin: endSide.min,
      endDayOff: endSide.dayOff,
      endBare: endSide.bare
    })
  }

  for (const match of masked.matchAll(RE_RANGE_24)) {
    const start = match.index
    const end = start + match[0].length
    const startHour = Number(match[1])
    const startMin = Number(match[2])
    const endHour = Number(match[3])
    const endMin = Number(match[4])
    if (
      !(startHour >= 0 && startHour <= 24) ||
      startMin > 59 ||
      !(endHour >= 0 && endHour <= 24) ||
      endMin > 59
    ) {
      poisoned.push({ start, end })
      continue
    }
    if (!guard('range', start, end)) {
      poisoned.push({ start, end })
      continue
    }
    pushRangeCand({
      kind: 'range',
      start,
      end,
      h: startHour,
      dayOff: 0,
      min: startMin,
      period: null,
      bare: false,
      assumed: false,
      endH: endHour,
      endMin,
      endDayOff: 0,
      endBare: false
    })
  }

  // Step 2b — 英文候选。与中文共用同一个候选列表和下游步骤（重叠消解、头尾
  // 锚定、标题挖除、取消识别），只有正则和守卫是英文专用的。kind 尽量复用，
  // 于是 Step 6 的时刻分层不需要分叉：英文星期就是 'weekday' 候选，英文
  // 12 小时制时刻就是 'clockCn' 候选。
  const enWordBefore = (index: number): string => {
    let i = index - 1
    while (i >= 0 && !/[A-Za-z]/.test(masked[i])) i -= 1
    const end = i + 1
    while (i >= 0 && /[A-Za-z]/.test(masked[i])) i -= 1
    return masked.slice(i + 1, end)
  }
  const enWordAfter = (index: number): string => {
    let i = index
    // 中间隔着数字就说明后面是 '10am' 这类时刻，不是普通单词。
    while (i < masked.length && !/[A-Za-z0-9]/.test(masked[i])) i += 1
    if (i >= masked.length || /[0-9]/.test(masked[i])) return ''
    const start = i
    while (i < masked.length && /[A-Za-z]/.test(masked[i])) i += 1
    return masked.slice(start, i)
  }
  const pushEn = (kind: TokenKind, start: number, end: number, data: Partial<Cand>): void => {
    if (guard(kind, start, end)) cands.push({ kind, start, end, ...data })
  }
  const enMonthDay = (month: number, day: number, year: number | null, start: number, end: number): void => {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return
    let picked: Date | null = null
    let assumed = false
    if (year !== null) {
      const candidate = new Date(year, month - 1, day)
      if (
        candidate.getFullYear() === year &&
        candidate.getMonth() === month - 1 &&
        candidate.getDate() === day
      ) {
        picked = candidate
      }
    } else {
      // 与中文 monthday 同规则：今年已过就顺延到下一次，找不到就放弃。
      for (let k = 0; k < 5; k += 1) {
        const y = now.getFullYear() + k
        const candidate = new Date(y, month - 1, day)
        if (
          candidate.getFullYear() === y &&
          candidate.getMonth() === month - 1 &&
          candidate.getDate() === day &&
          candidate >= startOfDay(now)
        ) {
          picked = candidate
          assumed = k > 0
          break
        }
      }
    }
    if (!picked) return
    pushEn('monthday', start, end, { date: picked, assumed })
  }

  for (const match of masked.matchAll(EN_RELATIVE)) {
    const word = match[1].toLowerCase()
    const start = match.index
    const end = start + match[0].length
    if (word === 'tonight') {
      // 与中文「今晚」同构：今天 + 弱时段「晚上」，显式时钟会覆盖它。
      pushEn('relcomp', start, end, { off: 0, weak: '晚上' })
    } else {
      const off = word === 'day after tomorrow' ? 2 : word === 'today' ? 0 : 1
      pushEn('relative', start, end, { off })
    }
  }

  for (const match of masked.matchAll(EN_WEEKDAY)) {
    const cue = match[1]?.toLowerCase()
    const word = match[2].toLowerCase()
    const start = match.index
    const end = start + match[0].length
    const wordStart = end - match[2].length
    if (!EN_WEEKDAY_FULL.has(word)) {
      const shown = match[2]
      // 全大写缩写（SUN、SAT）多半是人名/机构名，裸词一律不认。
      if (!cue && /^[A-Z]+$/.test(shown) && shown.length > 1) continue
      if (!cue) {
        const prev = enWordBefore(wordStart)
        const next = enWordAfter(end)
        // 'sat down' / 'mon dieu'：小写缩写后面还跟着普通小写单词，当动词/法语词。
        if (next && /^[a-z]{2,}$/.test(next)) continue
        // 'Sun Microsystems'：句首大写缩写后面紧跟专有名词。
        if (/^[A-Z][a-z]+$/.test(shown) && /^[A-Z]/.test(next)) continue
        // 'I sat' / 'we sat'：代词后面的缩写当动词。
        if (EN_ABBREV_PRONOUN.test(prev)) continue
      }
    }
    const dow = (startOfDay(now).getDay() + 6) % 7
    const target = (EN_WEEKDAYS[word] + 6) % 7
    let delta: number
    if (cue === 'next') delta = 7 - dow + target
    else if (cue === 'this') delta = target - dow
    else delta = (target - dow + 7) % 7
    // 'this friday' 已经过去时与中文「本周五」一致：整段拒绝，不顺延。
    if (delta < 0) {
      blocked.push({ start, end })
      continue
    }
    pushEn('weekday', start, end, { off: delta })
  }

  for (const match of masked.matchAll(EN_CLOCK_AMPM)) {
    const hour12 = Number(match[1])
    const minute = match[2] ? Number(match[2]) : 0
    if (!(hour12 >= 1 && hour12 <= 12) || minute > 59) continue
    const hour = match[3].toLowerCase() === 'am' ? hour12 % 12 : (hour12 % 12) + 12
    pushEn('clockCn', match.index, match.index + match[0].length, {
      h: hour, dayOff: 0, min: minute, period: null, bare: false, assumed: false
    })
  }

  for (const match of masked.matchAll(EN_CLOCK_AT)) {
    const hour = Number(match[1])
    const minute = match[2] ? Number(match[2]) : 0
    const applied = applyPeriod(null, hour)
    if (!applied || minute > 59) continue
    pushEn('clockCn', match.index, match.index + match[0].length, {
      h: applied[0], dayOff: applied[1], min: minute, period: null,
      bare: hour >= 1 && hour <= 6, assumed: true
    })
  }

  // 英文区间（「3pm to 5pm」「10:00-11:30」）。终点没写 am/pm 时继承起点的
  // 半日制（3pm to 5 = 15:00–17:00）。
  for (const match of masked.matchAll(RE_RANGE_EN_AMPM)) {
    const startHour12 = Number(match[1])
    const startMin = match[2] ? Number(match[2]) : 0
    const isPm = match[3].toLowerCase() === 'pm'
    const endHour12 = Number(match[4])
    const endMin = match[5] ? Number(match[5]) : 0
    const endHasMeridiem = Boolean(match[6])
    const endIsPm = endHasMeridiem ? match[6].toLowerCase() === 'pm' : isPm
    if (!(startHour12 >= 1 && startHour12 <= 12) || startMin > 59) continue
    if (!(endHour12 >= 1 && endHour12 <= 12) || endMin > 59) continue
    const hourOf = (h: number, pm: boolean): number => (pm ? (h % 12) + 12 : h % 12)
    pushEn('range', match.index, match.index + match[0].length, {
      h: hourOf(startHour12, isPm),
      dayOff: 0,
      min: startMin,
      period: null,
      bare: false,
      assumed: false,
      endH: hourOf(endHour12, endIsPm),
      endMin,
      endDayOff: 0,
      endBare: false
    })
  }

  for (const match of masked.matchAll(RE_RANGE_EN_24)) {
    const startHour = Number(match[1])
    const startMin = Number(match[2])
    const endHour = Number(match[3])
    const endMin = Number(match[4])
    if (
      !(startHour >= 0 && startHour <= 24) ||
      startMin > 59 ||
      !(endHour >= 0 && endHour <= 24) ||
      endMin > 59
    ) {
      continue
    }
    pushEn('range', match.index, match.index + match[0].length, {
      h: startHour,
      dayOff: 0,
      min: startMin,
      period: null,
      bare: false,
      assumed: false,
      endH: endHour,
      endMin,
      endDayOff: 0,
      endBare: false
    })
  }

  for (const match of masked.matchAll(EN_NOON)) {
    const hour = match[1].toLowerCase() === 'noon' ? 12 : 0
    pushEn('clockCn', match.index, match.index + match[0].length, {
      h: hour, dayOff: 0, min: 0, period: null, bare: false, assumed: false
    })
  }

  for (const match of masked.matchAll(EN_PERIOD)) {
    pushEn('period', match.index, match.index + match[0].length, {
      period: match[1].toLowerCase()
    })
  }

  for (const match of masked.matchAll(EN_OFFSET)) {
    const value = Number(match[1])
    const unit = match[2].toLowerCase()
    if (!(value >= 1 && value <= 999)) continue
    if (unit.startsWith('hour') || unit.startsWith('min')) {
      // hour/minute 是「此刻之后精确 N 小时/分钟」的瞬间语义：固定毫秒偏移
      // 是正确的——DST 切换时 in 2 hours 就该恰好是 7200 秒之后。
      const ms = unit.startsWith('hour') ? value * 3_600_000 : value * 60_000
      pushEn('offsetEn', match.index, match.index + match[0].length, { ms })
    } else {
      // day/week 是「N 天后同一墙钟时刻」的墙钟语义，与中文「后天」一致：
      // 走 addDays 墙钟加天（week = 7 × day）。固定 86_400_000ms 在 DST
      // 切换周会漂一小时（那天实际长 23h 或 25h），两种单位算法刻意不同。
      const days = unit.startsWith('day') ? value : value * 7
      pushEn('offsetEn', match.index, match.index + match[0].length, { off: days })
    }
  }

  for (const match of masked.matchAll(EN_MONTH_FIRST)) {
    enMonthDay(
      EN_MONTHS[match[1].toLowerCase()],
      Number(match[2]),
      match[3] ? Number(match[3]) : null,
      match.index,
      match.index + match[0].length
    )
  }
  for (const match of masked.matchAll(EN_DAY_FIRST)) {
    enMonthDay(
      EN_MONTHS[match[2].toLowerCase()],
      Number(match[1]),
      match[3] ? Number(match[3]) : null,
      match.index,
      match.index + match[0].length
    )
  }
  for (const match of masked.matchAll(EN_NUMERIC_MD)) {
    enMonthDay(
      Number(match[1]),
      Number(match[2]),
      null,
      match.index,
      match.index + match[0].length
    )
  }

  // Step 2.5 — a clock rejected at the regex level leaves no trace, which would
  // let a bare '上午' slip through unopposed. Re-scan loosely and poison every
  // near-miss that no surviving clock covers.
  const clockHit = overlapIndex(clockSurvivors)
  for (const match of masked.matchAll(LOOSE_CLOCK)) {
    const span = { start: match.index, end: match.index + match[0].length }
    if (!clockHit(span)) poisoned.push(span)
  }
  for (const span of poisoned) blocked.push(span)

  // Identity is the semantic token, never the punctuation merged around it:
  // typing a '。' next to a cancelled '#工作' must not resurrect the chip.
  const keyOf = (cand: Cand): string =>
    `${cand.kind}|${norm(raw.slice(cand.coreStart ?? cand.start, cand.coreEnd ?? cand.end)).toLowerCase()}`

  for (const cand of cands) {
    if (dismissed.has(keyOf(cand))) blocked.push({ start: cand.start, end: cand.end })
  }

  // Step 3 — drop blocked candidates, resolve overlaps, then merge punctuation.
  const blockedHit = overlapIndex(blocked)
  let live = cands.filter((cand) => !blockedHit(cand))
  live.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Cand[] = []
  for (const cand of live) {
    const prev = kept[kept.length - 1]
    if (prev && overlaps(prev, cand)) {
      if (contains(prev, cand)) continue
      kept.pop()
      blocked.push({ start: Math.min(prev.start, cand.start), end: Math.max(prev.end, cand.end) })
      continue
    }
    kept.push(cand)
  }
  const blockedHitFinal = overlapIndex(blocked)
  live = kept.filter((cand) => !blockedHitFinal(cand))

  const all = [...live, ...liveMarkers].sort((a, b) => a.start - b.start)
  for (const cand of all) {
    cand.coreStart = cand.start
    cand.coreEnd = cand.end
  }
  const cores = all.map((cand) => ({ start: cand.start, end: cand.end }))
  const claimed = new Set<number>()
  const isPunct = (ch: string | undefined): boolean => ch !== undefined && PUNCT.includes(ch)
  const inOtherCore = (self: number, index: number): boolean =>
    cores.some((core, j) => j !== self && index >= core.start && index < core.end)

  for (let i = 0; i < all.length; i += 1) {
    const cand = all[i]
    let start = cand.start
    let end = cand.end
    while (start > 0 && isPunct(masked[start - 1]) && !claimed.has(start - 1) && !inOtherCore(i, start - 1)) {
      if ((masked[start - 1] === '.' || masked[start - 1] === '。') && /[0-9]/.test(masked[start - 2] ?? '')) break
      start -= 1
      claimed.add(start)
    }
    while (end < masked.length && isPunct(masked[end]) && !claimed.has(end) && !inOtherCore(i, end)) {
      claimed.add(end)
      end += 1
    }
    cand.start = start
    cand.end = end
  }

  // Dismissal is re-checked after the punctuation merge, because merging changes
  // a span and therefore its key: '#工作，' must be dismissable as '#工作，'.
  // Markers are masked regardless, so the tail anchor still sees through a
  // dismissed '#项目' and the date behind it survives.
  const eligible = all.filter((cand) => !dismissed.has(keyOf(cand)))

  // Counted after the merge so the keys match the chips the user actually sees.
  const candidateCounts = new Map<string, number>()
  for (const cand of all) {
    const key = keyOf(cand)
    candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1)
  }

  const byStart = new Map<number, Cand>()
  const byEnd = new Map<number, Cand>()
  for (const cand of eligible) {
    if (!byStart.has(cand.start)) byStart.set(cand.start, cand)
    if (!byEnd.has(cand.end)) byEnd.set(cand.end, cand)
  }

  // Step 4 — head and tail anchoring. Only clusters touching the start or the
  // end of the string are eligible; a date buried mid-sentence is never eaten.
  const accepted = new Set<Cand>(eligible.filter((c) => c.kind === 'project' || c.kind === 'priority'))
  let head = 0
  while (head < masked.length && /\s/.test(masked[head])) head += 1
  const cue = CUES.exec(masked.slice(head))
  if (cue) {
    head += cue[0].length
    while (head < masked.length && /\s/.test(masked[head])) head += 1
  }
  for (;;) {
    const candidate = byStart.get(head)
    const hit = candidate && !accepted.has(candidate) ? candidate : undefined
    if (!hit) break
    accepted.add(hit)
    head = hit.end
    while (head < masked.length && /\s/.test(masked[head])) head += 1
  }

  let tail = masked.length
  while (tail > 0 && /\s/.test(masked[tail - 1])) tail -= 1
  for (;;) {
    const candidate = byEnd.get(tail)
    const hit = candidate && !accepted.has(candidate) && !candidate.oneDigit ? candidate : undefined
    if (!hit) break
    accepted.add(hit)
    tail = hit.start
    while (tail > 0 && /\s/.test(masked[tail - 1])) tail -= 1
  }

  // Step 5 — slot merge, leftmost wins. Only tokens that actually contribute a
  // field are cut out of the title; anchored losers stay as written.
  const anchored = [...accepted].sort((a, b) => a.start - b.start)
  const dateTok = anchored.find((t) => DATE_KINDS.includes(t.kind))
  // 区间算钟点槽的一种（自带起止），比单一 clock 更具体：同一输入里区间优先。
  const clockTok = anchored.find((t) => t.kind === 'clockCn' || t.kind === 'clock24' || t.kind === 'range')
  const periodTok = anchored.find((t) => t.kind === 'period')
  const projTok = anchored.find((t) => t.kind === 'project')
  const prioTok = anchored.find((t) => t.kind === 'priority')
  // 'in 2 hours' 自带精确瞬间，与日期/时段互斥：只有它是唯一的时刻候选时才
  // 独占 due 槽。混合输入里让更明确的日期/时钟胜出，偏移词原样留在标题。
  const offsetTok =
    dateTok || clockTok || periodTok ? undefined : anchored.find((t) => t.kind === 'offsetEn')
  const usedDate = offsetTok ? undefined : dateTok
  const usedClock = offsetTok ? undefined : clockTok
  const usedTime = offsetTok ? undefined : clockTok ?? (periodTok && !poisoned.length ? periodTok : null)
  const chosen = [usedDate, usedTime, offsetTok, projTok, prioTok]
    .filter((t): t is Cand => Boolean(t))
    .sort((a, b) => a.start - b.start)

  const tokens: ParseToken[] = chosen.map((token) => ({
    kind: token.kind,
    start: token.start,
    end: token.end,
    text: raw.slice(token.start, token.end),
    key: keyOf(token)
  }))

  // Step 7 — the title has exactly one generation path: cut the token spans out
  // of raw, collapse whitespace, trim. No post-hoc punctuation cleanup.
  let title = ''
  let cursor = 0
  for (const token of tokens) {
    title += raw.slice(cursor, token.start)
    cursor = token.end
  }
  title += raw.slice(cursor)
  title = tokens.length ? title.replace(/\s+/g, ' ').trim() : raw.trim()

  // Step 6 — layer the time onto the date, with the early-morning reading and
  // the invented-time rollback.
  const anyClockPoison = poisoned.length > 0
  let dueAt: string | null = null
  let startAt: string | null = null
  let endAt: string | null = null
  let timeExplicit = false
  let assumed = false
  let past = false

  if (offsetTok) {
    // 英文 'in N units' 相对当前时刻直接产出结果，不进入日期/时段的分层
    // 逻辑，也不做「已过就顺延一天」的补正。hour/minute 走精确毫秒偏移
    // （瞬间语义）；day/week 走 addDays 墙钟加天（与中文「后天」同一算法，
    // DST 切换周不漂时刻），见 Step 2b 的 EN_OFFSET 注释。
    const result =
      offsetTok.ms !== undefined
        ? new Date(now.getTime() + offsetTok.ms)
        : addDays(now, offsetTok.off ?? 0)
    dueAt = result.toISOString()
    timeExplicit = true
    past = result < now
  } else if (usedDate || usedClock || usedTime) {
    const base = usedDate
      ? usedDate.date
        ? new Date(usedDate.date)
        : addDays(startOfDay(now), usedDate.off ?? 0)
      : startOfDay(now)
    let result: Date

    if (usedClock) {
      const weak = !usedClock.period && usedDate?.kind === 'relcomp' ? usedDate.weak : null
      let hour = usedClock.h ?? 0
      let offset = usedClock.dayOff ?? 0
      if (weak) {
        const applied = applyPeriod(weak, usedClock.bare ? hour - 12 : hour)
        if (applied) {
          hour = applied[0]
          offset = applied[1]
        }
      }
      result = at(addDays(base, offset), hour, usedClock.min ?? 0)
      if (
        usedClock.bare &&
        !weak &&
        result.getFullYear() === now.getFullYear() &&
        result.getMonth() === now.getMonth() &&
        result.getDate() === now.getDate()
      ) {
        const morning = at(base, hour - 12, usedClock.min ?? 0)
        if (morning > now) result = morning
      }
      timeExplicit = true
      assumed = Boolean(usedClock.assumed) && !weak
      // With an explicit date we never roll forward: '今天下午3点' said at 16:00
      // really is overdue, and the chip says so.
      if (!usedDate && result <= now) result = addDays(result, 1)
    } else {
      const periodName = usedTime?.period ?? (usedDate?.kind === 'relcomp' ? usedDate.weak : null)
      if (periodName && !anyClockPoison) {
        const hour = usedTime ? PERIOD_DEFAULT[periodName] : WEAK_DEFAULT[periodName]
        result = at(base, hour, 0)
        timeExplicit = true
        assumed = true
        if (result <= now) {
          if (usedDate) {
            // The hour was invented, so discard it rather than push the task to
            // another day the user never asked for.
            result = at(base, 23, 59, 59)
            timeExplicit = false
            if (result <= now) {
              result = at(addDays(base, 1), hour, 0)
              timeExplicit = true
            }
          } else {
            result = addDays(result, 1)
          }
        }
      } else {
        result = at(base, 23, 59, 59)
        timeExplicit = false
      }
    }

    dueAt = result.toISOString()
    past = result < now
    if (usedDate?.assumed) assumed = true

    // 区间：起点即 due（也是 startAt），终点按开始侧同一规则解析（弱时段在
    // 无显式时段时同样作用到终点）；终点不晚于起点时顺延一天（跨午夜）。
    if (usedClock && usedClock.kind === 'range' && usedClock.endH !== undefined) {
      const weakForEnd = !usedClock.period && usedDate?.kind === 'relcomp' ? usedDate.weak : null
      let endHour = usedClock.endH
      let endOffset = usedClock.endDayOff ?? 0
      if (weakForEnd) {
        const reapplied = applyPeriod(weakForEnd, usedClock.endBare ? endHour - 12 : endHour)
        if (reapplied) {
          endHour = reapplied[0]
          endOffset = reapplied[1]
        }
      }
      const endCandidate = at(addDays(base, endOffset), endHour, usedClock.endMin ?? 0)
      startAt = result.toISOString()
      endAt = (endCandidate <= result ? addDays(endCandidate, 1) : endCandidate).toISOString()
    }
  }

  const emptyTitle = tokens.length > 0 && /^[\s，,。.;；、：:！!？?]*$/.test(title)
  const tooLong = title.length > QUICK_ADD_TITLE_MAX

  const notices: ParseNotice[] = [...misses]
  if (ambiguous) {
    const twins = projects.filter((p) => p.name.toLowerCase() === ambiguous.name!.toLowerCase()).length
    notices.push({
      kind: 'ambiguous',
      name: ambiguous.name ?? '',
      span: { start: ambiguous.start, end: ambiguous.end },
      text: translate(locale, 'quickAdd.ambiguous', {
        count: twins,
        name: ambiguous.name ?? ''
      })
    })
  }

  const chips: ParseChip[] = []
  const dueTokens = tokens.filter(
    (t) =>
      DATE_KINDS.includes(t.kind) ||
      t.kind === 'clockCn' ||
      t.kind === 'clock24' ||
      t.kind === 'range' ||
      t.kind === 'period' ||
      t.kind === 'offsetEn'
  )
  if (dueAt && dueTokens.length) {
    const label = formatParsedDue(dueAt, timeExplicit, now, locale, endAt)
    const source = sourceOf(raw, dueTokens)
    chips.push({
      id: 'due',
      label,
      ariaLabel: translate(locale, 'quickAdd.chipDue', {
        label,
        assumed: assumed ? assumedText(locale) : '',
        source
      }),
      source,
      tokenKeys: dueTokens.map((t) => t.key),
      spans: dueTokens.map((t) => ({ start: t.start, end: t.end })),
      past,
      assumed
    })
  }
  const projTokens = tokens.filter((t) => t.kind === 'project')
  if (projTok && projTokens.length) {
    const source = sourceOf(raw, projTokens)
    chips.push({
      id: 'project',
      label: projTok.name ?? '',
      ariaLabel: translate(locale, 'quickAdd.chipProject', {
        name: projTok.name ?? '',
        source
      }),
      source,
      tokenKeys: projTokens.map((t) => t.key),
      spans: projTokens.map((t) => ({ start: t.start, end: t.end })),
      past: false,
      assumed: false
    })
  }
  const prioTokens = tokens.filter((t) => t.kind === 'priority')
  if (prioTok && prioTokens.length) {
    const label = priorityText(locale, prioTok.priority ?? 0)
    const source = sourceOf(raw, prioTokens)
    chips.push({
      id: 'priority',
      label: translate(locale, 'quickAdd.priorityLabel', { priority: label }),
      ariaLabel: translate(locale, 'quickAdd.chipPriority', { priority: label, source }),
      source,
      tokenKeys: prioTokens.map((t) => t.key),
      spans: prioTokens.map((t) => ({ start: t.start, end: t.end })),
      past: false,
      assumed: false
    })
  }

  const segments: string[] = []
  for (const chip of chips) {
    if (chip.id === 'due') {
      segments.push(
        translate(locale, 'quickAdd.announceDue', {
          label: chip.label,
          assumed: chip.assumed ? assumedText(locale) : ''
        })
      )
    } else if (chip.id === 'project') {
      segments.push(translate(locale, 'quickAdd.announceProject', { name: chip.label }))
    } else {
      segments.push(
        translate(locale, 'quickAdd.announcePriority', {
          priority: priorityText(locale, prioTok?.priority ?? 0)
        })
      )
    }
  }
  let announcement = segments.length
    ? translate(locale, 'quickAdd.announce', {
        segments: segments.join(translate(locale, 'quickAdd.sep'))
      })
    : ''
  const period = translate(locale, 'quickAdd.period')
  for (const notice of notices) announcement += `${notice.text}${period}`

  const signature = [
    dueAt,
    projTok?.projectId ?? null,
    prioTok?.priority ?? 0,
    emptyTitle,
    tooLong,
    notices.map((n) => `${n.kind}:${n.name}`).join(',')
  ].join('|')

  return {
    raw,
    title,
    dueAt,
    startAt,
    endAt,
    projectId: projTok?.projectId ?? null,
    priority: prioTok?.priority ?? 0,
    timeExplicit,
    assumed,
    tokens,
    chips,
    notices,
    emptyTitle,
    tooLong,
    announcement,
    signature,
    candidateCounts
  }
}