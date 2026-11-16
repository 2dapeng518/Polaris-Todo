import { format, isBefore, isToday, isTomorrow, startOfDay } from 'date-fns'
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

export type Span = { start: number; end: number }

export type TokenKind =
  | 'relative'
  | 'relcomp'
  | 'weekday'
  | 'monthday'
  | 'iso'
  | 'clockCn'
  | 'clock24'
  | 'period'
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

const PUNCT = '，,。.;；、：:？?'
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
  凌晨: 5, 早上: 7, 早晨: 7, 上午: 9, 中午: 12, 下午: 15, 傍晚: 18, 晚上: 20
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
  new RegExp(`(?:周|星期|礼拜)[${WD}]\\s*(?:到|至|~|—|-)\\s*(?:周|星期|礼拜)?[${WD}]`, 'g'),
  new RegExp(`${NUM3}\\s*[点时]\\s*(?:到|至|~|—|-)\\s*${NUM3}\\s*[点时]`, 'g'),
  /[0-9]{1,2}:[0-9]{2}\s*(?:到|至|~|—|-)\s*[0-9]{1,2}:[0-9]{2}/g
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
  priority: /(^|[^!-~])!([高中低]|[123])(?![\p{L}\p{N}])/gu
}

const LOOSE_CLOCK = new RegExp(`((?:${PERIODS})[ \\t]*)?${NUM3}\\s*[点时]`, 'g')
const SUFFIX_HEAD = new RegExp(`^(?:半|钟|一刻|三刻|${NUM3}\\s*分)`)
/** 优先级的显示短名：解析语法仍只认中文与数字，这里只负责怎么说。 */
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
  projectId?: string
  name?: string
  dup?: boolean
  priority?: number
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
  locale: Locale = DEFAULT_LOCALE
): string {
  if (!value) return translate(locale, 'quickAdd.dueNone')
  const date = new Date(value)
  const dateLocale = locale === 'en' ? enUS : zhCN
  const today = translate(locale, 'dates.today')
  const tomorrow = translate(locale, 'dates.tomorrow')
  if (isToday(date)) return timeExplicit ? `${today} ${format(date, 'HH:mm')}` : today
  if (isTomorrow(date)) return timeExplicit ? `${tomorrow} ${format(date, 'HH:mm')}` : tomorrow
  const sameYear = date.getFullYear() === now.getFullYear()
  const stem =
    locale === 'en'
      ? format(date, sameYear ? 'MMM d' : 'MMM d, yyyy', { locale: dateLocale })
      : format(date, `${sameYear ? '' : 'yyyy年'}M月d日`, { locale: dateLocale })
  const tail = timeExplicit ? format(date, ' HH:mm') : ' ' + format(date, 'EEE', { locale: dateLocale })
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
    const value: Record<string, number> = { 高: 3, 中: 2, 低: 1, '1': 1, '2': 2, '3': 3 }
    markers.push({ kind: 'priority', start: at0, end: at0 + 2, priority: value[match[2]] })
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

  const compoundsHit = overlapIndex(compounds)

  const guard = (kind: TokenKind, start: number, end: number): boolean => {
    const left = masked[start - 1]
    const right = masked.slice(end)
    if (right.startsWith('的') || /^(?:那|这)/.test(right)) return false
    if (compoundsHit({ start, end })) return false
    if (kind === 'monthday' || kind === 'iso' || kind === 'clock24' || kind === 'clockCn') {
      if (left !== undefined && /[0-9]/.test(left)) return false
      if ((left === '.' || left === '。') && /[0-9]/.test(masked[start - 2] ?? '')) return false
    }
    if (kind === 'iso' && (left === '-' || left === '.')) return false
    if (kind === 'clockCn' || kind === 'clock24') {
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
  for (const match of masked.matchAll(RE.clockCn)) {
    const start = match.index
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
  const clockTok = anchored.find((t) => t.kind === 'clockCn' || t.kind === 'clock24')
  const periodTok = anchored.find((t) => t.kind === 'period')
  const projTok = anchored.find((t) => t.kind === 'project')
  const prioTok = anchored.find((t) => t.kind === 'priority')
  const usedTime = clockTok ?? (periodTok && !poisoned.length ? periodTok : null)
  const chosen = [dateTok, usedTime, projTok, prioTok]
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
  let timeExplicit = false
  let assumed = false
  let past = false

  if (dateTok || clockTok || periodTok) {
    const base = dateTok
      ? dateTok.date
        ? new Date(dateTok.date)
        : addDays(startOfDay(now), dateTok.off ?? 0)
      : startOfDay(now)
    let result: Date

    if (clockTok) {
      const weak = !clockTok.period && dateTok?.kind === 'relcomp' ? dateTok.weak : null
      let hour = clockTok.h ?? 0
      let offset = clockTok.dayOff ?? 0
      if (weak) {
        const applied = applyPeriod(weak, clockTok.bare ? hour - 12 : hour)
        if (applied) {
          hour = applied[0]
          offset = applied[1]
        }
      }
      result = at(addDays(base, offset), hour, clockTok.min ?? 0)
      if (
        clockTok.bare &&
        !weak &&
        result.getFullYear() === now.getFullYear() &&
        result.getMonth() === now.getMonth() &&
        result.getDate() === now.getDate()
      ) {
        const morning = at(base, hour - 12, clockTok.min ?? 0)
        if (morning > now) result = morning
      }
      timeExplicit = true
      assumed = Boolean(clockTok.assumed) && !weak
      // With an explicit date we never roll forward: '今天下午3点' said at 16:00
      // really is overdue, and the chip says so.
      if (!dateTok && result <= now) result = addDays(result, 1)
    } else {
      const periodName = periodTok?.period ?? (dateTok?.kind === 'relcomp' ? dateTok.weak : null)
      if (periodName && !anyClockPoison) {
        const hour = periodTok ? PERIOD_DEFAULT[periodName] : WEAK_DEFAULT[periodName]
        result = at(base, hour, 0)
        timeExplicit = true
        assumed = true
        if (result <= now) {
          if (dateTok) {
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
    if (dateTok?.assumed) assumed = true
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
  const dueTokens = tokens.filter((t) => DATE_KINDS.includes(t.kind) || t.kind === 'clockCn' || t.kind === 'clock24' || t.kind === 'period')
  if (dueAt && dueTokens.length) {
    const label = formatParsedDue(dueAt, timeExplicit, now, locale)
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