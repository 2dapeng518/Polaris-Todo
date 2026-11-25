// 真值表断言：quick-add 解析 / 回收站保留期 / 重复规则。
// 期望值全部写字面量，绝不经过被测代码重算——否则是拿实现测实现。
// 只在 harness 构建里存在；shared 纯函数照常 import，不依赖窗口。
// CSV 导入功能已移除；导出守卫在 smoke.ts（csvExportWorks）与 verify-pure 导出表。

import {
  deleteProject,
  deleteTag,
  deleteTask,
  deleteTaskForever,
  listProjects,
  listSubtasks,
  listTags,
  listTasks
} from '../db'
import { dismissKeys, formatParsedDue, parseQuickAdd, pruneDismissed } from '../../shared/quickAddParse'
import { isPurgeable } from '../../shared/retention'
import { isAutoBackupFileName } from '../../shared/backupNames'
import {
  buildCustomRecurrence,
  nextMonthlyClamped,
  nextOccurrence,
  parseCustomRecurrence,
  type CustomRecurrence
} from '../../shared/recurrence'

// Pure-function half of the quick-add checks. Expectations are written as
// literals, never recomputed through the parser — that would be testing the
// implementation against itself.
export function runParseAssertions(): {
  grammar: boolean
  invariants: boolean
  format: boolean
  english: boolean
} {
  const now = new Date(2026, 10, 12, 10, 30, 0)
  const projects = [
    { id: 'p1', name: '工作' },
    { id: 'p2', name: '生活' },
    { id: 'p3', name: '工作项目' },
    { id: 'p4', name: 'Side Project' },
    { id: 'p5', name: 'Polaris' }
  ]
  const ctx = { now, projects, dismissed: new Map<string, number>() }
  const local = (value: string | null): string | null => {
    if (!value) return null
    const d = new Date(value)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // [input, expectedTitle, expectedLocalDue, expectedProjectId]
  const table: Array<[string, string, string | null, string | null]> = [
    ['下周三下午3点交季度报告 #工作', '交季度报告', '2026-11-18 15:00', 'p1'],
    ['明天交周报', '交周报', '2026-11-13 23:59', null],
    ['后天上午10点半开评审会', '开评审会', '2026-11-14 10:30', null],
    ['交报告，明天', '交报告', '2026-11-13 23:59', null],
    ['明天前给我', '给我', '2026-11-13 23:59', null],
    ['今天之内交报告', '交报告', '2026-11-12 23:59', null],
    ['今天的会议材料', '今天的会议材料', null, null],
    ['今晚8点看电影', '看电影', '2026-11-12 20:00', null],
    ['明早7点跑步', '跑步', '2026-11-13 07:00', null],
    ['明早开会', '开会', '2026-11-13 07:00', null],
    ['明晚12点睡', '睡', '2026-11-14 00:00', null],
    ['今晚24点交报告', '交报告', '2026-11-13 00:00', null],
    ['明早期青花瓷鉴定', '明早期青花瓷鉴定', null, null],
    ['周五交周报', '交周报', '2026-11-13 23:59', null],
    ['本周五开会', '开会', '2026-11-13 23:59', null],
    ['本周三开会', '本周三开会', null, null],
    ['下下周一开会', '开会', '2026-11-23 23:59', null],
    ['星期天买菜', '买菜', '2026-11-15 23:59', null],
    ['周天买菜', '买菜', '2026-11-15 23:59', null],
    ['礼拜天买菜', '买菜', '2026-11-15 23:59', null],
    ['下礼拜天体检', '体检', '2026-11-22 23:59', null],
    ['周3体检', '体检', '2026-11-18 23:59', null],
    ['下个星期三评审', '评审', '2026-11-18 23:59', null],
    ['周六福买对戒', '周六福买对戒', null, null],
    ['周一围新剧追一下', '周一围新剧追一下', null, null],
    ['下周日程安排', '下周日程安排', null, null],
    ['今日志导出', '今日志导出', null, null],
    ['记得下周日程安排', '记得下周日程安排', null, null],
    ['本周三场比赛', '本周三场比赛', null, null],
    ['下周三个人来面试', '下周三个人来面试', null, null],
    ['本周三点半开会', '本周三点半开会', null, null],
    ['下周三点开会', '下周三点开会', null, null],
    ['周一到周五值班', '周一到周五值班', null, null],
    ['3点到5点值班', '值班', '2026-11-12 15:00', null],
    ['15:00到17:00 评审', '评审', '2026-11-12 15:00', null],
    ['11月20日交报告', '交报告', '2026-11-20 23:59', null],
    ['十一月二十日聚餐', '聚餐', '2026-11-20 23:59', null],
    ['1月1日复盘', '复盘', '2027-01-01 23:59', null],
    ['2027年1月5日复盘', '复盘', '2027-01-05 23:59', null],
    ['2月29日体检', '体检', '2028-02-29 23:59', null],
    ['2025年10月1日补记', '补记', '2025-10-01 23:59', null],
    ['2月30日开会', '2月30日开会', null, null],
    ['13月1日开会', '13月1日开会', null, null],
    ['2026-11-20 交材料', '交材料', '2026-11-20 23:59', null],
    ['2026-11-20T15:00 发布', '2026-11-20T15:00 发布', null, null],
    ['15号交房租', '15号交房租', null, null],
    ['下午3点开会', '开会', '2026-11-12 15:00', null],
    ['下午三点半取快递', '取快递', '2026-11-12 15:30', null],
    ['十点一刻开会', '开会', '2026-11-13 10:15', null],
    ['3点一刻开会', '开会', '2026-11-12 15:15', null],
    ['两点钟开会', '开会', '2026-11-12 14:00', null],
    ['上午 10点开会', '开会', '2026-11-13 10:00', null],
    ['明天上午12点开会', '开会', '2026-11-13 12:00', null],
    ['早上12点开会', '早上12点开会', null, null],
    ['3点开会', '开会', '2026-11-12 15:00', null],
    ['7点起床', '起床', '2026-11-13 07:00', null],
    ['三点开会', '三点开会', null, null],
    ['改一点样式', '改一点样式', null, null],
    ['3点注意事项', '3点注意事项', null, null],
    ['明天上午13点开会', '上午13点开会', '2026-11-13 23:59', null],
    ['9点60分', '9点60分', null, null],
    ['3点15分钟', '3点15分钟', null, null],
    ['5点半价门票', '5点半价门票', null, null],
    ['10点差5分开会', '10点差5分开会', null, null],
    ['沪指涨1.5点', '沪指涨1.5点', null, null],
    ['上午10点光景', '上午10点光景', null, null],
    ['15:00 站会', '站会', '2026-11-12 15:00', null],
    ['站会：15:00', '站会', '2026-11-12 15:00', null],
    ['站会 9:00', '站会 9:00', null, null],
    ['版本号 1:20', '版本号 1:20', null, null],
    ['晚上买菜', '买菜', '2026-11-12 20:00', null],
    ['买牛奶 明天下午', '买牛奶', '2026-11-13 15:00', null],
    ['下午茶', '下午茶', null, null],
    ['下午的报告', '下午的报告', null, null],
    ['交报告 #工作', '交报告', null, 'p1'],
    ['交报告#工作', '交报告', null, 'p1'],
    ['＃工作 下周三下午3点交季度报告', '交季度报告', '2026-11-18 15:00', 'p1'],
    ['#工作项目 排期', '排期', null, 'p3'],
    ['#Side Project 写文档', '写文档', null, 'p4'],
    ['学习 C# #工作', '学习 C#', null, 'p1'],
    ['买菜😀#工作', '买菜😀', null, 'p1'],
    ['#工作#生活 买东西', '#生活 买东西', null, 'p1'],
    ['C#开发教程', 'C#开发教程', null, null],
    ['issue#123', 'issue#123', null, null],
    ['#123 崩溃', '#123 崩溃', null, null],
    ['#不存在 做事', '#不存在 做事', null, null],
    ['交报告 #工作明天', '交报告 #工作明天', null, null],
    ['写周报 !高 #工作', '写周报', null, 'p1'],
    ['修 bug ！中', '修 bug', null, null],
    ['太棒了!高兴', '太棒了!高兴', null, null],
    ['明天 !9', '!9', '2026-11-13 23:59', null],
    ['一周三次的健身计划', '一周三次的健身计划', null, null],
    ['每周三例会', '每周三例会', null, null],
    ['例会 每周三', '例会 每周三', null, null],
    ['下周三个方案对比', '下周三个方案对比', null, null],
    ['补充第3点', '补充第3点', null, null],
    ['报销 上周三', '报销 上周三', null, null],
    ['3天后交方案', '3天后交方案', null, null],
    ['周末大扫除', '周末大扫除', null, null],
    ['把下周三的报告提前', '把下周三的报告提前', null, null],
    ['梳理本周的任务清单', '梳理本周的任务清单', null, null],
    ['预约周五的牙医', '预约周五的牙医', null, null],
    ['周五那份稿要改', '周五那份稿要改', null, null],
    ['记得下周三交报告', '记得交报告', '2026-11-18 23:59', null],
    ['明天交报告 周五', '交报告 周五', '2026-11-13 23:59', null],
    ['明天 交报告 下午3点', '交报告', '2026-11-13 15:00', null],
    ['晚上 明天3点开会', '晚上 开会', '2026-11-13 15:00', null],
    ['交报告。明天。', '交报告', '2026-11-13 23:59', null],
    ['明天下午3点', '', '2026-11-13 15:00', null],
    ['#工作', '', null, 'p1'],
    ['买牛奶', '买牛奶', null, null],
    ['冒烟测试 1763000000000', '冒烟测试 1763000000000', null, null],
    ['重复提示 1763000000000', '重复提示 1763000000000', null, null],
    ['重复冒烟 1763000000000', '重复冒烟 1763000000000', null, null]
  ]

  let grammar = true
  for (const [input, wantTitle, wantDue, wantProject] of table) {
    const result = parseQuickAdd(input, ctx)
    const gotDue = local(result.dueAt)
    if (
      result.title !== wantTitle ||
      gotDue !== wantDue ||
      result.projectId !== wantProject
    ) {
      grammar = false
      console.error(
        'PARSE_CASE_FAIL',
        JSON.stringify({ input, got: [result.title, gotDue, result.projectId], want: [wantTitle, wantDue, wantProject] })
      )
    }
  }

  // 区间语法（日历套件 P2.4）：「3点到5点」解析为 startAt/endAt，dueAt = 开始端。
  // 本表与 scripts/verify-pure.mjs 的区间表逐字同步——改一处另一处必须跟着改。
  // [input, expectedTitle, expectedLocalStart, expectedLocalEnd, expectedLocalDue]
  const rangeTable: Array<[string, string, string | null, string | null, string | null]> = [
    ['3点到5点值班', '值班', '2026-11-12 15:00', '2026-11-12 17:00', '2026-11-12 15:00'],
    ['15:00到17:00 评审', '评审', '2026-11-12 15:00', '2026-11-12 17:00', '2026-11-12 15:00'],
    ['明天下午3点到5点半开会', '开会', '2026-11-13 15:00', '2026-11-13 17:30', '2026-11-13 15:00'],
    ['今晚8点到10点看电影', '看电影', '2026-11-12 20:00', '2026-11-12 22:00', '2026-11-12 20:00'],
    ['晚上11点到凌晨1点值守', '值守', '2026-11-12 23:00', '2026-11-13 01:00', '2026-11-12 23:00'],
    ['3点半到5点复盘', '复盘', '2026-11-12 15:30', '2026-11-12 17:00', '2026-11-12 15:30'],
    ['明天 9:00-10:30 晨会', '晨会', '2026-11-13 09:00', '2026-11-13 10:30', '2026-11-13 09:00']
  ]
  for (const [input, wantTitle, wantStart, wantEnd, wantDue] of rangeTable) {
    const result = parseQuickAdd(input, ctx)
    const got = [result.title, local(result.startAt), local(result.endAt), local(result.dueAt)]
    if (
      got[0] !== wantTitle || got[1] !== wantStart || got[2] !== wantEnd || got[3] !== wantDue
    ) {
      grammar = false
      console.error(
        'PARSE_RANGE_FAIL',
        JSON.stringify({ input, got, want: [wantTitle, wantStart, wantEnd, wantDue] })
      )
    }
  }

  // 区间误报反例：守卫拒绝/非法输入整段留在标题，不产生任何时间字段。
  const rangeNegatives: Array<[string, string]> = [
    ['第3点到第4点', '第3点到第4点'],
    ['沪指涨1.5点', '沪指涨1.5点'],
    ['上午10点光景', '上午10点光景']
  ]
  for (const [input, wantTitle] of rangeNegatives) {
    const result = parseQuickAdd(input, ctx)
    if (result.title !== wantTitle || result.dueAt !== null || result.startAt !== null || result.endAt !== null) {
      grammar = false
      console.error('PARSE_RANGE_NEGATIVE_FAIL', JSON.stringify({ input, title: result.title, dueAt: result.dueAt }))
    }
  }

  // 英文区间：「3pm to 5pm」（终点无 am/pm 继承起点的半日制）与 24 小时制。
  const enRangeTable: Array<[string, string, string | null, string | null]> = [
    ['sync 3pm to 5pm', 'sync', '2026-11-12 15:00', '2026-11-12 17:00'],
    ['sync 3pm-5pm', 'sync', '2026-11-12 15:00', '2026-11-12 17:00'],
    // 起点 10:00 早于时钟 10:30：无显式日期时按既有规则整体顺延一天。
    ['demo 10am to 12pm', 'demo', '2026-11-13 10:00', '2026-11-13 12:00'],
    ['standup 10:00-11:30', 'standup', '2026-11-13 10:00', '2026-11-13 11:30']
  ]
  for (const [input, wantTitle, wantStart, wantEnd] of enRangeTable) {
    const result = parseQuickAdd(input, ctx)
    if (
      result.title !== wantTitle || local(result.startAt) !== wantStart || local(result.endAt) !== wantEnd
    ) {
      grammar = false
      console.error(
        'PARSE_EN_RANGE_FAIL',
        JSON.stringify({ input, got: [result.title, local(result.startAt), local(result.endAt)], want: [wantTitle, wantStart, wantEnd] })
      )
    }
  }

  // Dismissal must reach markers too, and must survive the punctuation merge.
  const dismissCtx = (keys: string[]): {
    now: Date
    projects: typeof projects
    dismissed: Map<string, number>
  } => ({ now, projects, dismissed: new Map(keys.map((key) => [key, 1])) })

  const projDismissed = parseQuickAdd('交报告 下周三 #工作', dismissCtx(['project|#工作']))
  if (
    projDismissed.projectId !== null ||
    projDismissed.title !== '交报告 #工作' ||
    local(projDismissed.dueAt) !== '2026-11-18 23:59'
  ) {
    grammar = false
    console.error('PARSE_DISMISS_PROJECT_FAIL', JSON.stringify(projDismissed.title))
  }

  const allDismissed = parseQuickAdd(
    '下周三下午3点交季度报告 #工作',
    dismissCtx(['weekday|下周三', 'clockCn|下午3点', 'project|#工作'])
  )
  if (
    allDismissed.dueAt !== null ||
    allDismissed.projectId !== null ||
    allDismissed.title !== '下周三下午3点交季度报告 #工作'
  ) {
    grammar = false
    console.error('PARSE_DISMISS_ALL_FAIL', JSON.stringify(allDismissed.title))
  }

  const punctDismissed = parseQuickAdd('#工作，买菜', dismissCtx(['project|#工作']))
  if (punctDismissed.projectId !== null || punctDismissed.title !== '#工作，买菜') {
    grammar = false
    console.error('PARSE_DISMISS_PUNCT_FAIL', JSON.stringify(punctDismissed.title))
  }

  // Priority must reach the field, not silently default to 0.
  const priorityCases: Array<[string, number]> = [
    ['写周报 !高', 3],
    ['写周报 !中', 2],
    ['写周报 !低', 1],
    ['写周报 !3', 3],
    ['写周报 !1', 1],
    ['写周报', 0],
    ['太棒了!高兴', 0]
  ]
  for (const [input, want] of priorityCases) {
    const got = parseQuickAdd(input, ctx).priority
    if (got !== want) {
      grammar = false
      console.error('PARSE_PRIORITY_FAIL', JSON.stringify({ input, got, want }))
    }
  }

  // A duplicate project whose name is itself a date word must not be eaten.
  const dupProjects = [...projects, { id: 'd1', name: '明天' }, { id: 'd2', name: '明天' }]
  const dupResult = parseQuickAdd('交报告 #明天', {
    now,
    projects: dupProjects,
    dismissed: new Map<string, number>()
  })
  if (
    dupResult.dueAt !== null ||
    dupResult.title !== '交报告 #明天' ||
    dupResult.projectId !== null ||
    dupResult.notices.length !== 1
  ) {
    grammar = false
    console.error('PARSE_DUP_DATE_FAIL', JSON.stringify({ title: dupResult.title, due: dupResult.dueAt }))
  }

  // A stored name containing full-width characters must still match.
  const wideProjects = [
    { id: 'w1', name: '项目１' },
    { id: 'w2', name: '第２组' }
  ]
  const wideCases: Array<[string, string]> = [
    ['排期 #项目1', 'w1'],
    ['排期 #项目１', 'w1'],
    ['开会 #第2组', 'w2']
  ]
  for (const [input, want] of wideCases) {
    const got = parseQuickAdd(input, { now, projects: wideProjects, dismissed: new Map<string, number>() })
    if (got.projectId !== want) {
      grammar = false
      console.error('PARSE_WIDE_NAME_FAIL', JSON.stringify({ input, got: got.projectId, want }))
    }
  }

  // Suppression tracks recognition, not raw text: an occurrence the guards
  // rejected must not inflate the count and later release the dismissal.
  const guarded = parseQuickAdd('明天交报告 明天的会议材料', ctx)
  if ((guarded.candidateCounts.get('relative|明天') ?? 0) !== 1) {
    grammar = false
    console.error('PARSE_CANDIDATE_COUNT_FAIL', JSON.stringify([...guarded.candidateCounts]))
  }
  const held = dismissKeys(['relative|明天'], new Map<string, number>(), guarded.candidateCounts)
  const afterEdit = pruneDismissed('明天交报告 的会议材料', held)
  const stillHeld = parseQuickAdd('明天交报告 的会议材料', { now, projects, dismissed: afterEdit })
  if (!afterEdit.has('relative|明天') || stillHeld.dueAt !== null) {
    grammar = false
    console.error('PARSE_RESURRECT_FAIL', JSON.stringify(stillHeld.dueAt))
  }

  // Two genuinely recognizable occurrences still release when one is deleted.
  const twice = parseQuickAdd('明天交报告 明天', ctx)
  const heldTwice = dismissKeys(['relative|明天'], new Map<string, number>(), twice.candidateCounts)
  if (heldTwice.get('relative|明天') !== 2 || pruneDismissed('交报告 明天', heldTwice).size !== 0) {
    grammar = false
    console.error('PARSE_RELEASE_FAIL', JSON.stringify([...heldTwice]))
  }

  // Deterministic fuzz: the title must always be exactly the raw string minus
  // the token spans, and spans must stay ordered, disjoint and in range.
  const fragments = [
    '明天', '下周三', '下午3点', '15:00', '11月20日', '#工作', '!高', '交报告',
    '买牛奶', '。', '，', ' ', '本周三', '晚上', '3点15', '每周三', '第3点',
    '2月30日', '＃生活', '沪指涨1.5点', '开会', '😀', '上午10点光景'
  ]
  let seed = 20261112
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  let invariants = true
  for (let i = 0; i < 2000; i += 1) {
    let input = ''
    const parts = 1 + rand(6)
    for (let j = 0; j < parts; j += 1) input += fragments[rand(fragments.length)]
    const result = parseQuickAdd(input, ctx)
    let rebuilt = ''
    let cursor = 0
    let prevEnd = -1
    for (const token of result.tokens) {
      if (
        token.start < prevEnd ||
        token.start < 0 ||
        token.end > input.length ||
        token.start >= token.end ||
        token.text !== input.slice(token.start, token.end)
      ) {
        invariants = false
      }
      prevEnd = token.end
      rebuilt += input.slice(cursor, token.start)
      cursor = token.end
    }
    rebuilt += input.slice(cursor)
    const want = result.tokens.length ? rebuilt.replace(/\s+/g, ' ').trim() : input.trim()
    if (result.title !== want || result.tokens.length > 4 || result.chips.length > 3) {
      invariants = false
      console.error('PARSE_INVARIANT_FAIL', JSON.stringify({ input, title: result.title, want }))
    }
  }

  // Dismissal state machine under random edits: a cancelled field must stay
  // cancelled while its text is still there, including when punctuation lands
  // next to it or the title grows.
  let dismissSeed = 777
  const dismissRand = (n: number): number => {
    dismissSeed = (dismissSeed * 1103515245 + 12345) % 2147483648
    return dismissSeed % n
  }
  const dismissBases = ['明天交报告', '下周三下午3点开会', '交报告 #工作', '晚上买菜', '11月20日体检']
  const tails = ['x', ' 备注', '。', '，', ' 明天', '']
  for (let i = 0; i < 300; i += 1) {
    const base = dismissBases[dismissRand(dismissBases.length)]
    const first = parseQuickAdd(base, ctx)
    if (!first.chips.length) continue
    const chip = first.chips[dismissRand(first.chips.length)]
    let held = dismissKeys(chip.tokenKeys, new Map<string, number>(), first.candidateCounts)
    let text = base
    for (let step = 0; step < 4; step += 1) {
      text += tails[dismissRand(tails.length)]
      held = pruneDismissed(text, held)
      const after = parseQuickAdd(text, { now, projects, dismissed: held })
      for (const live of after.chips) {
        if (live.tokenKeys.some((key) => chip.tokenKeys.includes(key))) {
          invariants = false
          console.error('PARSE_DISMISS_FUZZ_FAIL', JSON.stringify({ base, text, chip: live.id }))
        }
      }
    }
  }

  // Parsing runs on every keystroke; a long pasted run of date words must not
  // freeze the renderer.
  const longInput = '明天下午3点 '.repeat(400)
  const started = Date.now()
  parseQuickAdd(longInput, ctx)
  const elapsed = Date.now() - started
  if (elapsed > 500) {
    invariants = false
    console.error('PARSE_PERF_FAIL', JSON.stringify({ chars: longInput.length, elapsed }))
  }

  const formatChecks: Array<[string | null, boolean, string]> = [
    [null, true, '无日期'],
    [null, false, '无日期'],
    ['2026-11-18T07:00:00.000Z', true, '11月18日 15:00'],
    ['2025-10-01T15:59:59.000Z', false, '已逾期 · 2025年10月1日 周三'],
    ['2028-02-29T15:59:59.000Z', false, '2028年2月29日 周二']
  ]
  let formatOk = true
  for (const [value, timeExplicit, want] of formatChecks) {
    const got = formatParsedDue(value, timeExplicit, now)
    if (got !== want) {
      formatOk = false
      console.error('PARSE_FORMAT_FAIL', JSON.stringify({ value, got, want }))
    }
  }
  const kept = pruneDismissed('#Polaris 写文档', new Map([['project|#polaris', 1]]))
  if (!kept.has('project|#polaris')) formatOk = false
  const released = pruneDismissed('交报告', new Map([['relative|明天', 1]]))
  if (released.size !== 0) formatOk = false

  // ---- 英文自然语言解析 ----
  // 固定时钟同上（2026-11-12 周四 10:30）。[input, title, localDue, priority, timeExplicit]
  // 期望全部写成字面量，绝不经被测函数回算。
  const enTable: Array<[string, string, string | null, number, boolean]> = [
    ['Call mom tomorrow 3pm', 'Call mom', '2026-11-13 15:00', 0, true],
    ['tomorrow 3pm', '', '2026-11-13 15:00', 0, true],
    ['tomorrow', '', '2026-11-13 23:59', 0, false],
    ['today', '', '2026-11-12 23:59', 0, false],
    ['day after tomorrow report', 'report', '2026-11-14 23:59', 0, false],
    ['standup tmr', 'standup', '2026-11-13 23:59', 0, false],
    ['tonight', '', '2026-11-12 20:00', 0, true],
    ['tonight 8pm', '', '2026-11-12 20:00', 0, true],
    ['standup friday', 'standup', '2026-11-13 23:59', 0, false],
    ['Monday review', 'review', '2026-11-16 23:59', 0, false],
    ['next friday demo', 'demo', '2026-11-20 23:59', 0, false],
    ['this friday demo', 'demo', '2026-11-13 23:59', 0, false],
    ['this monday demo', 'this monday demo', null, 0, false],
    ['on friday demo', 'demo', '2026-11-13 23:59', 0, false],
    ['gym sat 10am', 'gym', '2026-11-14 10:00', 0, true],
    ['gym sat', 'gym', '2026-11-14 23:59', 0, false],
    ['call 3pm', 'call', '2026-11-12 15:00', 0, true],
    ['call 3:30pm', 'call', '2026-11-12 15:30', 0, true],
    ['call 3 pm', 'call', '2026-11-12 15:00', 0, true],
    ['call at 3', 'call', '2026-11-12 15:00', 0, true],
    ['call at 15', 'call', '2026-11-12 15:00', 0, true],
    ['lunch noon', 'lunch', '2026-11-12 12:00', 0, true],
    ['sleep midnight', 'sleep', '2026-11-13 00:00', 0, true],
    ['run morning', 'run', '2026-11-13 09:00', 0, true],
    ['call afternoon', 'call', '2026-11-12 15:00', 0, true],
    ['dinner evening', 'dinner', '2026-11-12 20:00', 0, true],
    ['pay in 2 hours', 'pay', '2026-11-12 12:30', 0, true],
    ['pay in 30 minutes', 'pay', '2026-11-12 11:00', 0, true],
    ['pay in 3 days', 'pay', '2026-11-15 10:30', 0, true],
    ['pay in 2 weeks', 'pay', '2026-11-26 10:30', 0, true],
    ['party dec 25', 'party', '2026-12-25 23:59', 0, false],
    ['party december 25', 'party', '2026-12-25 23:59', 0, false],
    ['party 25 dec', 'party', '2026-12-25 23:59', 0, false],
    ['party 12/25', 'party', '2026-12-25 23:59', 0, false],
    ['jan 5 report', 'report', '2027-01-05 23:59', 0, false],
    ['report dec 25 2026', 'report', '2026-12-25 23:59', 0, false],
    ['写周报 !high', '写周报', null, 3, false],
    ['fix !med', 'fix', null, 2, false],
    ['fix !medium', 'fix', null, 2, false],
    ['fix !low', 'fix', null, 1, false],
    ['明天 3pm 开会', '开会', '2026-11-13 15:00', 0, true]
  ]
  let english = true
  for (const [input, wantTitle, wantDue, wantPriority, wantExplicit] of enTable) {
    const result = parseQuickAdd(input, ctx)
    const got = [result.title, local(result.dueAt), result.priority, result.timeExplicit]
    if (
      got[0] !== wantTitle ||
      got[1] !== wantDue ||
      got[2] !== wantPriority ||
      got[3] !== wantExplicit
    ) {
      english = false
      console.error(
        'PARSE_EN_FAIL',
        JSON.stringify({ input, got, want: [wantTitle, wantDue, wantPriority, wantExplicit] })
      )
    }
  }

  // 误报反例：整串原样留下、无 due、无优先级、无 token。
  const enNegatives = [
    'May the force be with you',
    'sat down and read',
    'Sun Microsystems report',
    'march forward',
    'April is nice',
    'join 2 hours of calls',
    'call mom on friday please',
    'we sat together',
    'SAT scores',
    'good morning team',
    'good evening all',
    'Mon ami',
    'Sun Tzu'
  ]
  for (const input of enNegatives) {
    const result = parseQuickAdd(input, ctx)
    if (
      result.title !== input ||
      result.dueAt !== null ||
      result.priority !== 0 ||
      result.tokens.length !== 0
    ) {
      english = false
      console.error(
        'PARSE_EN_NEGATIVE_FAIL',
        JSON.stringify({
          input,
          got: [result.title, local(result.dueAt), result.priority, result.tokens.length]
        })
      )
    }
  }

  // 取消 chip 与中文同一套机制：tomorrow 不再消费，只剩 3pm。
  const enDismissed = parseQuickAdd('Call mom tomorrow 3pm', dismissCtx(['relative|tomorrow']))
  if (
    enDismissed.title !== 'Call mom tomorrow' ||
    local(enDismissed.dueAt) !== '2026-11-12 15:00' ||
    enDismissed.chips.length !== 1
  ) {
    english = false
    console.error('PARSE_EN_DISMISS_FAIL', JSON.stringify([enDismissed.title, local(enDismissed.dueAt)]))
  }

  return { grammar, invariants, format: formatOk, english }
}

// 保留期边界用字面量期望钉死：isPurgeable 是自动清理的唯一权威，db 层逐行
// 调用它决定 DELETE。全部用 ISO UTC 瞬间 + epoch 差，不依赖机器时区；边界是
// 「满 30 天即清」（>=）。期望绝不经被测函数自算。
export function runRetentionAssertions(): boolean {
  // [deletedAtIso, nowIso, 期望]
  const table: Array<[string | null, string, boolean]> = [
    [null, '2026-11-12T00:00:00.000Z', false],
    // 刚删除（0 天）
    ['2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', false],
    // 29 天：还差一天
    ['2026-10-14T00:00:00.000Z', '2026-11-12T00:00:00.000Z', false],
    // 30 天差 1ms：不清
    ['2026-10-13T00:00:00.001Z', '2026-11-12T00:00:00.000Z', false],
    // 恰好满 30 天：即清（>= 边界）
    ['2026-10-13T00:00:00.000Z', '2026-11-12T00:00:00.000Z', true],
    // 30 天多 1ms：清
    ['2026-10-12T23:59:59.999Z', '2026-11-12T00:00:00.000Z', true],
    // 早已过期
    ['2025-01-01T00:00:00.000Z', '2026-11-12T00:00:00.000Z', true],
    // 未来时间戳：宁可留着，不误删
    ['2026-11-13T00:00:00.000Z', '2026-11-12T00:00:00.000Z', false],
    // 无法解析：一律 false
    ['not-a-date', '2026-11-12T00:00:00.000Z', false],
    ['', '2026-11-12T00:00:00.000Z', false],
    // 第二组时钟：证明 now 是注入的，跨年边界同样按 epoch 差算
    ['2026-12-03T00:00:00.000Z', '2027-01-01T00:00:00.000Z', false],
    ['2026-12-02T00:00:00.000Z', '2027-01-01T00:00:00.000Z', true]
  ]
  let ok = true
  for (const [deletedAt, now, want] of table) {
    const got = isPurgeable(deletedAt, new Date(now))
    if (got !== want) {
      ok = false
      console.error('RETENTION_CASE_FAIL', JSON.stringify({ deletedAt, now, got, want }))
    }
  }
  return ok
}

// 自动备份文件名校验真值表：合法名只有一种形状（前缀 + 连字符化 ISO 时间戳 + .json）。
// 路径穿越/分隔符/未替换的冒号点/首尾杂物一律拒绝——这是 backups:import/save-as
// 的唯一入口门禁，期望全部字面量。与 scripts/verify-pure.mjs 逐字镜像。
export function runBackupNameAssertions(): boolean {
  const table: Array<[string, boolean]> = [
    ['polaris-auto-2026-11-19T02-00-00-000Z.json', true],
    ['polaris-auto-2026-01-01T00-00-00-000Z.json', true],
    ['', false],
    ['polaris-auto-.json', false],
    ['polaris-auto-2026-11-19T02-00-00-000Z.json.tmp', false],
    ['polaris-auto-2026-11-19T02-00-00-000Z.JSON', false],
    ['polaris-backup-2026-11-19T02-00-00-000Z.json', false],
    ['../polaris-auto-2026-11-19T02-00-00-000Z.json', false],
    ['..\polaris-auto-2026-11-19T02-00-00-000Z.json', false],
    ['sub/polaris-auto-2026-11-19T02-00-00-000Z.json', false],
    ['polaris-auto-..2026-11-19T02-00-00-000Z.json', false],
    // 冒号与点未替换成连字符的原始 ISO：不是盘上会出现的名字，拒。
    ['polaris-auto-2026-11-19T02:00:00.000Z.json', false],
    // 尾部换行：正则整体锚定，$ 不吃残留字符。
    ['polaris-auto-2026-11-19T02-00-00-000Z.json\n', false],
    ['{{SECRET_suhq3wqz}}', false]
  ]
  let ok = true
  for (const [name, want] of table) {
    const got = isAutoBackupFileName(name)
    if (got !== want) {
      ok = false
      console.error('BACKUP_NAME_CASE_FAIL', JSON.stringify({ name, got, want }))
    }
  }
  return ok
}

// 月度钳制用字面量期望钉死：nextMonthlyClamped 把 29–31 日钳到短月最后一天而非跳月，
// 保留时分秒毫秒，候选必须严格晚于 due 与 now。注入 due/now（本地墙钟），期望不经被测函数自算。
export function runRecurrenceAssertions(): boolean {
  const at = (y: number, mo: number, d: number, h = 9, mi = 0, s = 0, ms = 0) =>
    new Date(y, mo, d, h, mi, s, ms)
  const key = (d: Date | null) =>
    d
      ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`
      : 'null'
  // [due, now, 期望]
  const table: Array<[Date, Date, string]> = [
    // 31 日 → 平年 2 月钳到 28
    [at(2026, 0, 31), at(2026, 0, 31), '2026-2-28 9:0:0.0'],
    // 30 日 → 2 月同样钳到 28
    [at(2026, 0, 30, 8), at(2026, 0, 30, 8), '2026-2-28 8:0:0.0'],
    // 29 日 → 平年 2 月钳到 28
    [at(2026, 0, 29), at(2026, 0, 29), '2026-2-28 9:0:0.0'],
    // 闰年 2 月：31 日钳到 29
    [at(2028, 0, 31, 10), at(2028, 0, 31, 10), '2028-2-29 10:0:0.0'],
    // 31 日 → 4 月（30 天）钳到 30
    [at(2026, 2, 31), at(2026, 2, 31), '2026-4-30 9:0:0.0'],
    // 31 日 → 8 月（31 天）不钳
    [at(2026, 6, 31), at(2026, 6, 31), '2026-8-31 9:0:0.0'],
    // 跨年：12 月 31 → 次年 1 月 31
    [at(2026, 11, 31, 23, 59), at(2026, 11, 31, 23, 59), '2027-1-31 23:59:0.0'],
    // now 已过 due 落在月中：从 now 所在月取钳制日
    [at(2026, 0, 31), at(2026, 2, 15, 12), '2026-3-31 9:0:0.0'],
    // now 在 2 月且 due 是 31：2 月 28 仍晚于 now → 取 2 月 28
    [at(2026, 0, 31), at(2026, 1, 10, 12), '2026-2-28 9:0:0.0'],
    // 保留时分秒毫秒
    [at(2026, 0, 31, 18, 30, 45, 500), at(2026, 0, 31, 18, 30, 45, 500), '2026-2-28 18:30:45.500']
  ]
  let ok = true
  for (const [due, now, want] of table) {
    const got = key(nextMonthlyClamped(due, now))
    if (got !== want) {
      ok = false
      console.error('RECURRENCE_CASE_FAIL', JSON.stringify({ due: key(due), now: key(now), got, want }))
    }
  }

  // nextOccurrence 注入时钟的确定性真值表：核心是「逾期很久不断链」——
  // 旧实现从 due 起逐个迭代、1000 次封顶，每天重复逾期约 2.7 年就静默返回
  // null。新实现 rule.after 直接跳到锚点之后，逾期时长与迭代次数无关。
  // [due（本地墙钟）, rule, now, 期望]
  const occurrenceTable: Array<[Date, string, Date, string]> = [
    // 每天重复逾期 3 年（2023-01-01 → 2026-01-01 共 1096 天 > 旧上限 1000）
    [at(2023, 0, 1, 9), 'FREQ=DAILY', at(2026, 0, 1, 8), '2026-1-1 9:0:0.0'],
    // 逾期 3 年且今天的时段已过 → 明天
    [at(2023, 0, 1, 9), 'FREQ=DAILY', at(2026, 0, 1, 10), '2026-1-2 9:0:0.0'],
    // 每周重复逾期 3 年：2023-01-02 是周一，2026-01-01（周四）之后是 01-05 周一
    [at(2023, 0, 2, 9), 'FREQ=WEEKLY', at(2026, 0, 1, 8), '2026-1-5 9:0:0.0'],
    // 每年 2 月 29 日：rrule 跳过非闰年（既有语义保留），2026 之后是 2028
    [at(2020, 1, 29, 9), 'FREQ=YEARLY', at(2026, 0, 1, 8), '2028-2-29 9:0:0.0'],
    // 每月预设逾期 3 年：钳制路径锚在 now 所在月，31 日不钳
    [at(2023, 0, 31, 9), 'FREQ=MONTHLY', at(2026, 0, 15, 8), '2026-1-31 9:0:0.0'],
    // 每月预设：now 在 2 月 → 钳到 28（预设 clamp 语义保留）
    [at(2023, 0, 31, 9), 'FREQ=MONTHLY', at(2026, 1, 15, 8), '2026-2-28 9:0:0.0'],
    // 自定义 INTERVAL=2：月末语义已与预设统一为钳制（产品拍板，不再分叉）。
    // now 落在非序列月 2 月 → 向上对齐到序列月 3 月，31 日不钳。期望值与旧
    // rrule 跳月路径巧合相同，但改注释钉的是新语义：2 月不是被「跳过」，
    // 而是本就不在 1 月出发的隔月序列里；真正的分叉用例见下方短月钳制组。
    [at(2023, 0, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2026, 1, 15, 8), '2026-3-31 9:0:0.0'],
    // 统一语义新增：INTERVAL=2 从 1 月 31 日出发 → 3 月 31 日 → 5 月 31 日
    //（链上两跳分别钉死，now=due 钉「完成当前实例」的第一跳）
    [at(2026, 0, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2026, 0, 31, 9), '2026-3-31 9:0:0.0'],
    [at(2026, 2, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2026, 2, 31, 9), '2026-5-31 9:0:0.0'],
    // 统一语义新增：now 落在非序列月 4 月 → 对齐到 5 月（序列锚定 due 所在月，
    // 不是从 now 所在月起算间隔）
    [at(2026, 0, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2026, 3, 10, 12), '2026-5-31 9:0:0.0'],
    // 统一语义新增：序列月命中 2 月（12 月 31 出发隔 2 月）→ 平年钳 28。
    // 旧 rrule 路径跳过 2/4/6 月直到 8 月 31（旧期望 2026-8-31），统一后不跳月。
    [at(2025, 11, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2025, 11, 31, 9), '2026-2-28 9:0:0.0'],
    // 统一语义新增：闰年 2 月钳 29（旧 rrule 路径同样整月跳过，旧期望 2028-8-31）
    [at(2027, 11, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2027, 11, 31, 9), '2028-2-29 9:0:0.0'],
    // 统一语义新增：30 天月也钳——7 月 31 隔 2 月到 9 月钳 30
    //（旧 rrule 路径跳过 9/11 月，旧期望 2027-1-31）
    [at(2026, 6, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2026, 6, 31, 9), '2026-9-30 9:0:0.0'],
    // 统一语义新增：对齐月的钳制日已过（now 在 9/30 下午）→ 沿序列再进一格
    // 到 11 月钳 30，而不是退回月频或跳年
    [at(2026, 6, 31, 9), 'FREQ=MONTHLY;INTERVAL=2', at(2026, 8, 30, 12), '2026-11-30 9:0:0.0'],
    // due 在未来：下一次实例严格晚于 due（完成当前实例不再生成它自己）
    [at(2026, 10, 20, 9), 'FREQ=DAILY', at(2026, 10, 12, 10), '2026-11-21 9:0:0.0'],
    // COUNT 耗尽：链合法终结，返回 null（UI 层拒绝 COUNT，这里是防御语义）
    [at(2023, 0, 1, 9), 'FREQ=DAILY;COUNT=5', at(2026, 0, 1, 8), 'null']
  ]
  for (const [due, rule, now, want] of occurrenceTable) {
    const got = key(nextOccurrence(due.toISOString(), rule, now))
    if (got !== want) {
      ok = false
      console.error('RECURRENCE_OCCURRENCE_FAIL', JSON.stringify({ due: key(due), rule, now: key(now), got, want }))
    }
  }
  // 空入参 → null，不抛错。
  if (nextOccurrence(null, 'FREQ=DAILY', at(2026, 0, 1)) !== null) ok = false
  if (nextOccurrence(at(2026, 0, 1).toISOString(), null, at(2026, 0, 1)) !== null) ok = false
  return ok
}

// 自定义重复 parse/build 往返：字面量期望，含星期规范化排序与复杂子句拒绝。
export function runCustomRecurrenceAssertions(): boolean {
  let ok = true
  const parseCases: Array<[string | null, string, number, string[]]> = [
    ['FREQ=DAILY', 'DAILY', 1, []],
    ['FREQ=DAILY;INTERVAL=3', 'DAILY', 3, []],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR', 'WEEKLY', 2, ['MO', 'WE', 'FR']],
    ['FREQ=MONTHLY;INTERVAL=2', 'MONTHLY', 2, []],
    ['FREQ=YEARLY', 'YEARLY', 1, []],
    [null, '', 0, []]
  ]
  for (const [rule, freq, interval, weekdays] of parseCases) {
    const parsed = parseCustomRecurrence(rule)
    if (rule === null) {
      if (parsed !== null) {
        ok = false
        console.error('CUSTOM_RECURRENCE_FAIL', JSON.stringify({ rule, parsed }))
      }
      continue
    }
    if (
      !parsed ||
      parsed.freq !== freq ||
      parsed.interval !== interval ||
      JSON.stringify(parsed.weekdays) !== JSON.stringify(weekdays)
    ) {
      ok = false
      console.error('CUSTOM_RECURRENCE_FAIL', JSON.stringify({ rule, parsed, want: { freq, interval, weekdays } }))
    }
  }
  const buildCases: Array<[CustomRecurrence, string]> = [
    [{ freq: 'DAILY', interval: 1, weekdays: [] }, 'FREQ=DAILY'],
    [{ freq: 'DAILY', interval: 3, weekdays: [] }, 'FREQ=DAILY;INTERVAL=3'],
    [{ freq: 'WEEKLY', interval: 2, weekdays: ['FR', 'MO', 'WE'] }, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR'],
    [{ freq: 'WEEKLY', interval: 1, weekdays: [] }, 'FREQ=WEEKLY'],
    [{ freq: 'MONTHLY', interval: 2, weekdays: ['MO'] }, 'FREQ=MONTHLY;INTERVAL=2']
  ]
  for (const [input, want] of buildCases) {
    const got = buildCustomRecurrence(input)
    if (got !== want) {
      ok = false
      console.error('CUSTOM_RECURRENCE_BUILD_FAIL', JSON.stringify({ input, got, want }))
    }
  }
  for (const complex of ['FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=DAILY;COUNT=5', 'FREQ=WEEKLY;BYSETPOS=1']) {
    if (parseCustomRecurrence(complex) !== null) {
      ok = false
      console.error('CUSTOM_RECURRENCE_COMPLEX_FAIL', complex)
    }
  }
  return ok
}
