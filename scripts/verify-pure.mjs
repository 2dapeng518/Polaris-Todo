// 纯函数快速校验层：quick-add 解析 / 回收站保留期 / 重复规则 / CSV 导出真值表。
// 与 verify-datetime 同一套路 —— Node type-stripping 直接 import shared 纯函数、
// 注入固定时钟，不启动 Electron，秒级反馈；CI（.github/workflows/ci.yml）已挂。
// 用法：node scripts/verify-pure.mjs
//
// ⚠️ 同步维护：本脚本的表逐字移植自 src/main/harness/assertions.ts 的
// runParseAssertions()（中文语法表 / 英文语法表 / 误报反例 / 撤销与不变量 / 格式表）、
// runRetentionAssertions()（保留期边界表）、runRecurrenceAssertions()（月度钳制表 +
// nextOccurrence 注入时钟表，含逾期 3 年不断链用例）、runCustomRecurrenceAssertions()
// （parse/build 往返表）。CSV 导入功能已移除；导出表（escaping/逐字全文/优先级
// 映射/回收站过滤）与 smoke.ts 的 csvExportWorks 守卫互为镜像，改一处另一处跟着改。
// harness 里的原断言保留不动（E2E 仍跑），两处任何一处改表，另一处必须跟着改，
// 否则快速层与 E2E 层会各自为政。
//
// 时区钉死 Asia/Shanghai：中文格式表（formatParsedDue）的期望字面量按 UTC+8 墙钟
// 书写（与 harness 运行机一致）；解析表两侧都是本地墙钟，本与时区无关，钉死后
// 整个脚本在任何机器 / CI 上都确定性复现。Node 支持运行时改 process.env.TZ。
process.env.TZ = 'Asia/Shanghai'

// quickAddParse.ts 经 './i18n' 目录式 import 引用词典，plain Node 解析不了；
// 先注册解析钩子再动态 import（静态 import 会被提升到 register 之前）。
import { register } from 'node:module'
register('./ts-resolve-hooks.mjs', import.meta.url)
const { dismissKeys, formatParsedDue, parseQuickAdd, pruneDismissed } = await import('../src/shared/quickAddParse.ts')
const { isPurgeable } = await import('../src/shared/retention.ts')
// recurrence 经同一套 ts-resolve-hooks 解析（'rrule' 包依赖由钩子/Node 默认解析接住）。
const { buildCustomRecurrence, nextMonthlyClamped, nextOccurrence, parseCustomRecurrence } = await import('../src/shared/recurrence.ts')
const { CSV_EXPORT_HEADERS, buildCsvExport, csvExportFromBackup, csvField, formatCsvDue } = await import('../src/shared/csvExport.ts')
const { isAutoBackupFileName } = await import('../src/shared/backupNames.ts')
const { shouldMirror } = await import('../src/shared/mirror.ts')

let fail = 0
const assert = (cond, msg) => { if (!cond) { fail++; console.log('  FAIL ' + msg) } else console.log('  PASS ' + msg) }

// 固定时钟：2026-11-12（周四）10:30，与 harness 完全一致。
const now = new Date(2026, 10, 12, 10, 30, 0)
const projects = [
  { id: 'p1', name: '工作' },
  { id: 'p2', name: '生活' },
  { id: 'p3', name: '工作项目' },
  { id: 'p4', name: 'Side Project' },
  { id: 'p5', name: 'Polaris' }
]
const ctx = { now, projects, dismissed: new Map() }
const local = (value) => {
  if (!value) return null
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

console.log('=== 中文语法真值表（固定时钟 2026-11-12 10:30） ===')
// [input, expectedTitle, expectedLocalDue, expectedProjectId]
// 期望值一律写死字面量，不经被测函数反算。
const table = [
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
  ['3点到5点值班', '3点到5点值班', null, null],
  ['15:00到17:00 评审', '15:00到17:00 评审', null, null],
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
for (const [input, wantTitle, wantDue, wantProject] of table) {
  const result = parseQuickAdd(input, ctx)
  const got = [result.title, local(result.dueAt), result.projectId]
  const ok = got[0] === wantTitle && got[1] === wantDue && got[2] === wantProject
  const want = JSON.stringify([wantTitle, wantDue, wantProject])
  assert(ok, `「${input}」→ ${want}` + (ok ? '' : `（实得 ${JSON.stringify(got)}）`))
}

console.log('=== 取消识别：覆盖标记、扛住标点合并 ===')
const dismissCtx = (keys) => ({ now, projects, dismissed: new Map(keys.map((key) => [key, 1])) })
{
  const r = parseQuickAdd('交报告 下周三 #工作', dismissCtx(['project|#工作']))
  assert(
    r.projectId === null && r.title === '交报告 #工作' && local(r.dueAt) === '2026-11-18 23:59',
    '取消 #工作 后项目回到标题、日期照常识别' + `（实得 ${JSON.stringify([r.title, local(r.dueAt), r.projectId])}）`
  )
}
{
  const r = parseQuickAdd('下周三下午3点交季度报告 #工作', dismissCtx(['weekday|下周三', 'clockCn|下午3点', 'project|#工作']))
  assert(
    r.dueAt === null && r.projectId === null && r.title === '下周三下午3点交季度报告 #工作',
    '全部取消后整串原样保留' + `（实得 ${JSON.stringify(r.title)}）`
  )
}
{
  const r = parseQuickAdd('#工作，买菜', dismissCtx(['project|#工作']))
  assert(r.projectId === null && r.title === '#工作，买菜', '取消的标记旁落标点不复活 chip' + `（实得 ${JSON.stringify(r.title)}）`)
}

console.log('=== 优先级落到字段而非默默归零 ===')
for (const [input, want] of [
  ['写周报 !高', 3],
  ['写周报 !中', 2],
  ['写周报 !低', 1],
  ['写周报 !3', 3],
  ['写周报 !1', 1],
  ['写周报', 0],
  ['太棒了!高兴', 0]
]) {
  const got = parseQuickAdd(input, ctx).priority
  assert(got === want, `「${input}」优先级 ${want}` + (got === want ? '' : `（实得 ${got}）`))
}

console.log('=== 重名项目本身是日期词：不猜、不吃日期 ===')
{
  const dupProjects = [...projects, { id: 'd1', name: '明天' }, { id: 'd2', name: '明天' }]
  const r = parseQuickAdd('交报告 #明天', { now, projects: dupProjects, dismissed: new Map() })
  assert(
    r.dueAt === null && r.title === '交报告 #明天' && r.projectId === null && r.notices.length === 1,
    '两个同名「明天」项目：整串保留 + 恰一条提示' + `（实得 ${JSON.stringify([r.title, r.dueAt, r.projectId, r.notices.length])}）`
  )
}

console.log('=== 全角项目名两侧归一化匹配 ===')
{
  const wideProjects = [
    { id: 'w1', name: '项目１' },
    { id: 'w2', name: '第２组' }
  ]
  for (const [input, want] of [
    ['排期 #项目1', 'w1'],
    ['排期 #项目１', 'w1'],
    ['开会 #第2组', 'w2']
  ]) {
    const got = parseQuickAdd(input, { now, projects: wideProjects, dismissed: new Map() }).projectId
    assert(got === want, `「${input}」→ ${want}` + (got === want ? '' : `（实得 ${got}）`))
  }
}

console.log('=== 撤销记账按「可识别次数」而非裸子串 ===')
{
  const guarded = parseQuickAdd('明天交报告 明天的会议材料', ctx)
  assert(
    (guarded.candidateCounts.get('relative|明天') ?? 0) === 1,
    '被守卫挡下的「明天的」不计入次数' + `（实得 ${JSON.stringify([...guarded.candidateCounts])}）`
  )
  const held = dismissKeys(['relative|明天'], new Map(), guarded.candidateCounts)
  const afterEdit = pruneDismissed('明天交报告 的会议材料', held)
  const stillHeld = parseQuickAdd('明天交报告 的会议材料', { now, projects, dismissed: afterEdit })
  assert(afterEdit.has('relative|明天') && stillHeld.dueAt === null, '编辑标题后已取消的日期不复活')
  const twice = parseQuickAdd('明天交报告 明天', ctx)
  const heldTwice = dismissKeys(['relative|明天'], new Map(), twice.candidateCounts)
  assert(
    heldTwice.get('relative|明天') === 2 && pruneDismissed('交报告 明天', heldTwice).size === 0,
    '两处真可识别：删掉一处即释放另一处'
  )
}

console.log('=== 确定性 fuzz：标题恒等于原串挖掉 token 区间 ===')
// 与 harness 同一组碎片、同一个 LCG 种子 —— 两边跑的是同一批 2000 条输入。
{
  const fragments = [
    '明天', '下周三', '下午3点', '15:00', '11月20日', '#工作', '!高', '交报告',
    '买牛奶', '。', '，', ' ', '本周三', '晚上', '3点15', '每周三', '第3点',
    '2月30日', '＃生活', '沪指涨1.5点', '开会', '😀', '上午10点光景'
  ]
  let seed = 20261112
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  let bad = 0
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
        bad++
      }
      prevEnd = token.end
      rebuilt += input.slice(cursor, token.start)
      cursor = token.end
    }
    rebuilt += input.slice(cursor)
    const want = result.tokens.length ? rebuilt.replace(/\s+/g, ' ').trim() : input.trim()
    if (result.title !== want || result.tokens.length > 4 || result.chips.length > 3) {
      bad++
      if (bad <= 3) console.log('    反例 ' + JSON.stringify({ input, title: result.title, want }))
    }
  }
  assert(bad === 0, `2000 条随机拼接：区间升序不重叠、标题守恒、token≤4 / chip≤3（违例 ${bad}）`)
}

console.log('=== 撤销状态机 fuzz：随机编辑下已取消字段保持取消 ===')
{
  let dismissSeed = 777
  const dismissRand = (n) => {
    dismissSeed = (dismissSeed * 1103515245 + 12345) % 2147483648
    return dismissSeed % n
  }
  const dismissBases = ['明天交报告', '下周三下午3点开会', '交报告 #工作', '晚上买菜', '11月20日体检']
  const tails = ['x', ' 备注', '。', '，', ' 明天', '']
  let bad = 0
  for (let i = 0; i < 300; i += 1) {
    const base = dismissBases[dismissRand(dismissBases.length)]
    const first = parseQuickAdd(base, ctx)
    if (!first.chips.length) continue
    const chip = first.chips[dismissRand(first.chips.length)]
    let held = dismissKeys(chip.tokenKeys, new Map(), first.candidateCounts)
    let text = base
    for (let step = 0; step < 4; step += 1) {
      text += tails[dismissRand(tails.length)]
      held = pruneDismissed(text, held)
      const after = parseQuickAdd(text, { now, projects, dismissed: held })
      for (const live of after.chips) {
        if (live.tokenKeys.some((key) => chip.tokenKeys.includes(key))) {
          bad++
          if (bad <= 3) console.log('    反例 ' + JSON.stringify({ base, text, chip: live.id }))
        }
      }
    }
  }
  assert(bad === 0, `300 组随机编辑序列：已取消的 chip 不复活（违例 ${bad}）`)
}

console.log('=== 长输入性能：每次按键都要跑解析 ===')
{
  const longInput = '明天下午3点 '.repeat(400)
  const started = Date.now()
  parseQuickAdd(longInput, ctx)
  const elapsed = Date.now() - started
  assert(elapsed <= 500, `${longInput.length} 字符长串解析 ≤500ms（实耗 ${elapsed}ms）`)
}

console.log('=== 截止日期格式真值表（zh-CN，UTC+8 墙钟字面量） ===')
for (const [value, timeExplicit, want] of [
  [null, true, '无日期'],
  [null, false, '无日期'],
  ['2026-11-18T07:00:00.000Z', true, '11月18日 15:00'],
  ['2025-10-01T15:59:59.000Z', false, '已逾期 · 2025年10月1日 周三'],
  ['2028-02-29T15:59:59.000Z', false, '2028年2月29日 周二']
]) {
  const got = formatParsedDue(value, timeExplicit, now)
  assert(got === want, `${value} → ${want}` + (got === want ? '' : `（实得 ${got}）`))
}
{
  const kept = pruneDismissed('#Polaris 写文档', new Map([['project|#polaris', 1]]))
  assert(kept.has('project|#polaris'), '文本还在则撤销保持')
  const released = pruneDismissed('交报告', new Map([['relative|明天', 1]]))
  assert(released.size === 0, '文本消失则撤销释放')
}

console.log('=== 英文语法真值表（41 条，固定时钟同上） ===')
// [input, title, localDue, priority, timeExplicit]
const enTable = [
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
for (const [input, wantTitle, wantDue, wantPriority, wantExplicit] of enTable) {
  const result = parseQuickAdd(input, ctx)
  const got = [result.title, local(result.dueAt), result.priority, result.timeExplicit]
  const ok = got[0] === wantTitle && got[1] === wantDue && got[2] === wantPriority && got[3] === wantExplicit
  const want = JSON.stringify([wantTitle, wantDue, wantPriority, wantExplicit])
  assert(ok, `「${input}」→ ${want}` + (ok ? '' : `（实得 ${JSON.stringify(got)}）`))
}

console.log('=== 英文误报反例（13 条）：整串原样留下 ===')
for (const input of [
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
]) {
  const r = parseQuickAdd(input, ctx)
  const ok = r.title === input && r.dueAt === null && r.priority === 0 && r.tokens.length === 0
  assert(ok, `「${input}」零消费` + (ok ? '' : `（实得 ${JSON.stringify([r.title, local(r.dueAt), r.priority, r.tokens.length])}）`))
}

console.log('=== 英文取消识别与中文同一套机制 ===')
{
  const r = parseQuickAdd('Call mom tomorrow 3pm', dismissCtx(['relative|tomorrow']))
  assert(
    r.title === 'Call mom tomorrow' && local(r.dueAt) === '2026-11-12 15:00' && r.chips.length === 1,
    '取消 tomorrow 后只剩 3pm' + `（实得 ${JSON.stringify([r.title, local(r.dueAt), r.chips.length])}）`
  )
}

console.log('=== 回收站保留期真值表（满 30 天即清，>= 边界） ===')
// [deletedAtIso, nowIso, 期望]。全部 ISO UTC 瞬间 + epoch 差，期望绝不经被测函数自算。
const retentionTable = [
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
for (const [deletedAt, nowIso, want] of retentionTable) {
  const got = isPurgeable(deletedAt, new Date(nowIso))
  assert(got === want, `isPurgeable(${JSON.stringify(deletedAt)}, ${nowIso}) = ${want}` + (got === want ? '' : `（实得 ${got}）`))
}

console.log('=== 云端镜像去抖门控真值表（与 assertions.ts runMirrorAssertions 逐字镜像） ===')
{
  const base = {
    enabled: true,
    folder: 'C:\\PolarisSync',
    dirty: true,
    lastAttemptAt: 1_000_000,
    now: 1_030_000,
    minGapMs: 30_000
  }
  // [说明, 输入, 期望]
  const mirrorTable = [
    ['关闭不写', { ...base, enabled: false }, false],
    ['无改动不写', { ...base, dirty: false }, false],
    ['未选目录不写', { ...base, folder: null }, false],
    ['空目录不写', { ...base, folder: '' }, false],
    ['纯空白目录不写', { ...base, folder: '   ' }, false],
    ['从未尝试立即写', { ...base, lastAttemptAt: null }, true],
    ['恰好满间隔写', { ...base, lastAttemptAt: 1_000_000, now: 1_030_000 }, true],
    ['差 1ms 不写', { ...base, lastAttemptAt: 1_000_001, now: 1_030_000 }, false],
    ['时钟回拨放行', { ...base, lastAttemptAt: 1_030_001, now: 1_030_000 }, true],
    ['坏时间戳放行', { ...base, lastAttemptAt: Number.NaN }, true],
    ['坏 now 放行', { ...base, now: Number.NaN }, true],
    ['坏间隔放行', { ...base, minGapMs: Number.NaN }, true],
    ['负间隔放行', { ...base, minGapMs: -1 }, true],
    ['零间隔立即写', { ...base, minGapMs: 0 }, true],
    ['目录带空白仍算已选', { ...base, folder: ' C:\\PolarisSync ', lastAttemptAt: null }, true]
  ]
  for (const [label, input, want] of mirrorTable) {
    const got = shouldMirror(input)
    assert(got === want, `shouldMirror(${label}) = ${want}` + (got === want ? '' : `（实得 ${got}）`))
  }
}

console.log('=== 重复规则：月度钳制真值表（本地墙钟，期望字面量） ===')
// 逐字移植 runRecurrenceAssertions()：nextMonthlyClamped 把 29–31 日钳到短月
// 最后一天而非跳月，保留时分秒毫秒，候选必须严格晚于 due 与 now。
{
  const at = (y, mo, d, h = 9, mi = 0, s = 0, ms = 0) => new Date(y, mo, d, h, mi, s, ms)
  const key = (d) =>
    d
      ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`
      : 'null'
  // [due, now, 期望]
  const recurrenceClampTable = [
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
  for (const [due, clampNow, want] of recurrenceClampTable) {
    const got = key(nextMonthlyClamped(due, clampNow))
    assert(got === want, `nextMonthlyClamped(${key(due)}, ${key(clampNow)}) = ${want}` + (got === want ? '' : `（实得 ${got}）`))
  }

  console.log('=== 重复规则：nextOccurrence 注入时钟真值表（逾期 3 年不断链） ===')
  // 核心是「逾期很久不断链」：旧实现从 due 起逐个迭代、1000 次封顶，每天重复
  // 逾期约 2.7 年就静默返回 null。新实现 rule.after 直接跳到锚点之后。
  // [due（本地墙钟）, rule, now, 期望]
  const occurrenceTable = [
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
  for (const [due, rule, occNow, want] of occurrenceTable) {
    const got = key(nextOccurrence(due.toISOString(), rule, occNow))
    assert(got === want, `nextOccurrence(${key(due)}, ${rule}, ${key(occNow)}) = ${want}` + (got === want ? '' : `（实得 ${got}）`))
  }
  // 空入参 → null，不抛错。
  assert(nextOccurrence(null, 'FREQ=DAILY', at(2026, 0, 1)) === null, 'nextOccurrence(null due) = null')
  assert(nextOccurrence(at(2026, 0, 1).toISOString(), null, at(2026, 0, 1)) === null, 'nextOccurrence(null rule) = null')
}

console.log('=== 自定义重复：parse/build 往返真值表 ===')
// 逐字移植 runCustomRecurrenceAssertions()：星期规范化排序与复杂子句拒绝。
{
  const parseCases = [
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
      assert(parsed === null, 'parseCustomRecurrence(null) = null' + (parsed === null ? '' : `（实得 ${JSON.stringify(parsed)}）`))
      continue
    }
    const ok =
      parsed &&
      parsed.freq === freq &&
      parsed.interval === interval &&
      JSON.stringify(parsed.weekdays) === JSON.stringify(weekdays)
    assert(ok, `parseCustomRecurrence(${rule}) = ${JSON.stringify({ freq, interval, weekdays })}` + (ok ? '' : `（实得 ${JSON.stringify(parsed)}）`))
  }
  const buildCases = [
    [{ freq: 'DAILY', interval: 1, weekdays: [] }, 'FREQ=DAILY'],
    [{ freq: 'DAILY', interval: 3, weekdays: [] }, 'FREQ=DAILY;INTERVAL=3'],
    [{ freq: 'WEEKLY', interval: 2, weekdays: ['FR', 'MO', 'WE'] }, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR'],
    [{ freq: 'WEEKLY', interval: 1, weekdays: [] }, 'FREQ=WEEKLY'],
    [{ freq: 'MONTHLY', interval: 2, weekdays: ['MO'] }, 'FREQ=MONTHLY;INTERVAL=2']
  ]
  for (const [input, want] of buildCases) {
    const got = buildCustomRecurrence(input)
    assert(got === want, `buildCustomRecurrence(${JSON.stringify(input)}) = ${want}` + (got === want ? '' : `（实得 ${got}）`))
  }
  for (const complex of ['FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=DAILY;COUNT=5', 'FREQ=WEEKLY;BYSETPOS=1']) {
    const got = parseCustomRecurrence(complex)
    assert(got === null, `复杂子句拒绝：${complex}` + (got === null ? '' : `（实得 ${JSON.stringify(got)}）`))
  }
}

// ---------- 自动备份文件名校验（与 assertions.ts runBackupNameAssertions 逐字镜像） ----------
{
  const table = [
    ['polaris-auto-2026-11-19T02-00-00-000Z.json', true],
    ['polaris-auto-2026-01-01T00-00-00-000Z.json', true],
    ['', false],
    ['polaris-auto-.json', false],
    ['polaris-auto-2026-11-19T02-00-00-000Z.json.tmp', false],
    ['polaris-auto-2026-11-19T02-00-00-000Z.JSON', false],
    ['polaris-backup-2026-11-19T02-00-00-000Z.json', false],
    ['../polaris-auto-2026-11-19T02-00-00-000Z.json', false],
    ['..\\polaris-auto-2026-11-19T02-00-00-000Z.json', false],
    ['sub/polaris-auto-2026-11-19T02-00-00-000Z.json', false],
    ['polaris-auto-..2026-11-19T02-00-00-000Z.json', false],
    ['polaris-auto-2026-11-19T02:00:00.000Z.json', false],
    ['polaris-auto-2026-11-19T02-00-00-000Z.json\n', false],
    ['{SECRET_suhq3wqz}', false]
  ]
  for (const [name, want] of table) {
    const got = isAutoBackupFileName(name)
    assert(got === want, `备份文件名 ${JSON.stringify(name)} → ${want}` + (got === want ? '' : `（实得 ${got}）`))
  }
}

// ---------- CSV 导出：契约表头 + escaping + 逐字全文（导入已移除，无回导圆环） ----------
{
  const q = '"'
  const esc = [
    ['plain', 'plain'],
    ['a,b', q + 'a,b' + q],
    ['say ' + q + 'hi' + q, q + 'say ' + q + q + 'hi' + q + q + q],
    ['line1\nline2', q + 'line1\nline2' + q],
    ['', '']
  ]
  for (const [input, want] of esc) {
    const got = csvField(input)
    assert(got === want, `csvField(${JSON.stringify(input)}) = ${JSON.stringify(want)}` + (got === want ? '' : `（实得 ${JSON.stringify(got)}）`))
  }
  const due = new Date(2026, 10, 20, 9, 5, 0).toISOString()
  assert(formatCsvDue(due) === '2026-11-20T09:05:00', 'formatCsvDue 本地墙钟补零' + (formatCsvDue(due) === '2026-11-20T09:05:00' ? '' : `（实得 ${formatCsvDue(due)}）`))
  const sample = {
    title: '圆环任务,带逗号',
    notes: '备注含' + q + '引号' + q + ',逗号\n与换行',
    priority: 3,
    dueAt: due,
    completed: false,
    projectName: '圆环项目',
    tags: ['甲', '乙'],
    subtasks: ['步骤一', '步骤二']
  }
  const text = buildCsvExport([sample, { ...sample, title: '已完成件', completed: true, subtasks: [], tags: [], projectName: null, dueAt: null, priority: 0 }])
  assert(text.startsWith('\uFEFF' + CSV_EXPORT_HEADERS.join(',') + '\r\n'), '导出首行 BOM+契约表头')
  assert(text.endsWith('\r\n'), 'CRLF 行尾')
  const wantText = '\uFEFF' + [
    CSV_EXPORT_HEADERS.join(','),
    'task,"圆环任务,带逗号","备注含""引号"",逗号\n与换行",4,1,圆环项目,"甲,乙",active,2026-11-20T09:05:00,en,,',
    'task,步骤一,,4,2,,,active,2026-11-20T09:05:00,en,,',
    'task,步骤二,,4,2,,,active,2026-11-20T09:05:00,en,,',
    'task,已完成件,"备注含""引号"",逗号\n与换行",1,1,,,completed,,en,,'
  ].join('\r\n') + '\r\n'
  assert(text === wantText, '导出全文逐字相等：escaping/INDENT 子任务/标签逗号加引号/优先级 3→4/墙钟/完成态' + (text === wantText ? '' : `（实得 ${JSON.stringify(text)}）`))
  for (const p of [0, 1, 2, 3]) {
    const one = buildCsvExport([{ ...sample, priority: p, subtasks: [], tags: [], notes: '' }])
    const want = '\uFEFF' + CSV_EXPORT_HEADERS.join(',') + '\r\n' + `task,"圆环任务,带逗号",,${p + 1},1,圆环项目,,active,2026-11-20T09:05:00,en,,\r\n`
    const ok = one === want
    assert(ok, `优先级 ${p} → Csv ${p + 1}` + (ok ? '' : `（实得 ${JSON.stringify(one)}）`))
  }
  const assembled = csvExportFromBackup({
    projects: [{ id: 'p1', name: '装配项目' }],
    tasks: [
      { id: 't1', title: '活任务', notes: '', priority: 1, dueAt: null, completed: false, deletedAt: null, projectId: 'p1', tags: [{ name: '装配标签' }] },
      { id: 't2', title: '回收站任务', notes: '', priority: 0, dueAt: null, completed: false, deletedAt: '2026-11-19T00:00:00.000Z', projectId: null, tags: [] }
    ],
    subtasks: [{ taskId: 't1', title: '装配步骤' }]
  })
  const wantAssembled = '\uFEFF' + [
    CSV_EXPORT_HEADERS.join(','),
    'task,活任务,,2,1,装配项目,装配标签,active,,en,,',
    'task,装配步骤,,2,2,,,active,,en,,'
  ].join('\r\n') + '\r\n'
  const aok = assembled === wantAssembled
  assert(aok, 'csvExportFromBackup：过滤回收站 + 项目/标签/子任务 join' + (aok ? '' : `（实得 ${JSON.stringify(assembled)}）`))
}

console.log('\n' + (fail === 0 ? '纯函数真值表全部成立 ✓' : fail + ' 项失败 ✗'))
process.exit(fail === 0 ? 0 : 1)