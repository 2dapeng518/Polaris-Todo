// 纯函数快速校验层：quick-add 解析真值表 + 回收站保留期真值表。
// 与 verify-datetime 同一套路 —— Node type-stripping 直接 import shared 纯函数、
// 注入固定时钟，不启动 Electron，秒级反馈；CI（.github/workflows/ci.yml）已挂。
// 用法：node scripts/verify-pure.mjs
//
// ⚠️ 同步维护：本脚本的表逐字移植自 src/main/harness/assertions.ts 的
// runParseAssertions()（中文语法表 / 英文语法表 / 误报反例 / 撤销与不变量 / 格式表）
// 与 runRetentionAssertions()（保留期边界表）。harness 里的原断言保留不动（E2E 仍跑），
// 两处任何一处改表，另一处必须跟着改，否则快速层与 E2E 层会各自为政。
//
// 本轮只移植 parse + retention 两类；recurrence / csv 的真值表正由并行工作改动，
// 落地后下一波再补（见文件末尾的结构预留位）。
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

// ---- 结构预留位（下一波补齐，勿删） ----
// === 重复规则真值表 ===
// 待并行改动落地后，从 harness assertions.ts 的 runRecurrenceAssertions()
// （nextMonthlyClamped 月度钳制表）与 runCustomRecurrenceAssertions()
// （parseCustomRecurrence / buildCustomRecurrence 往返表）逐字移植到此处。
// import 方式同上：await import('../src/shared/recurrence.ts')。
//
// === CSV 搬家真值表 ===
// 从 runCsvImportAssertions() 的纯函数半区（parseCsvImport 字面量表）移植；
// 真实落库往返（importCsvText → SQLite）依赖 better-sqlite3 原生模块，
// 属于 E2E 层，留在 harness，不进本脚本。

console.log('\n' + (fail === 0 ? '纯函数真值表全部成立 ✓' : fail + ' 项失败 ✗'))
process.exit(fail === 0 ? 0 : 1)