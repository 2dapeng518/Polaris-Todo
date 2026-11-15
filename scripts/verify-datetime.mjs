// 日期时间纯函数不变量自检：「今天」绝不落过去、整分推进不越日、半截数字判据。
// 这些是 lib/dateTime.ts 里的纯函数，注入时钟即可确定性覆盖边界 —— 靠跑真实 UI
// 撞 23:59 那一分钟的概率是 60/86400，实际上永远撞不到。
// 用法：node scripts/verify-datetime.mjs
//
// 覆盖范围的诚实说明：DAY 固定在非夏令时跳变日，且脚本跑在**本机时区**。
// 在 Asia/Shanghai（本应用的目标时区，无 DST）这足以证明「不落过去」。
// 但在有夏令时回拨的时区，laterToday 的 sameDay 分支仍可能返回过去时刻 ——
// 墙钟时分在重复小时里是歧义的，回填后解析到较早的那个瞬间。那条路径**尚未修复**，
// 本脚本也不声称覆盖它：把 DAY 换成跳变日并设 process.env.TZ 就能复现。
import { laterToday, shiftMinutes, isComplete, draftToIso } from '../src/renderer/src/lib/dateTime.ts'

let fail = 0
const assert = (cond, msg) => { if (!cond) { fail++; console.log('  FAIL ' + msg) } else console.log('  PASS ' + msg) }

// 期望值一律写死字面量，不经被测函数反算。
const DAY = [2026, 10, 15] // 2026-11-15，本地墙钟
const at = (h, m, s = 0, ms = 0) => new Date(DAY[0], DAY[1], DAY[2], h, m, s, ms)
const shape = (d) => `${d.day.getFullYear()}-${d.day.getMonth() + 1}-${d.day.getDate()} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`

console.log('=== 「今天」向上取整到 5 分钟 ===')
for (const [now, want] of [
  [at(0, 0, 0), '2026-11-15 00:05'],
  [at(0, 0, 30), '2026-11-15 00:05'],
  [at(9, 2, 0), '2026-11-15 09:05'],
  [at(9, 5, 0), '2026-11-15 09:10'],
  [at(18, 59, 59, 999), '2026-11-15 19:00']
]) {
  assert(shape(laterToday(now)) === want, `${shape({ day: now, hour: now.getHours(), minute: now.getMinutes() })} → ${want}`)
}

console.log('=== 跨分钟前夜：今天还剩 23:59 就用它 ===')
for (const [now, want] of [
  [at(23, 55, 0, 1), '2026-11-15 23:59'],
  [at(23, 57, 10), '2026-11-15 23:59'],
  [at(23, 58, 59, 999), '2026-11-15 23:59']
]) {
  assert(shape(laterToday(now)) === want, `${now.toTimeString().slice(0, 8)} → ${want}`)
}

console.log('=== 一天的最后一分钟：23:59 已过去，只能顺延到明天 00:00 ===')
// 这正是修复前会返回「今天 23:59」——一个保存即逾期的时刻。
for (const now of [at(23, 59, 0), at(23, 59, 0, 1), at(23, 59, 10), at(23, 59, 59, 999)]) {
  const got = laterToday(now)
  assert(shape(got) === '2026-11-16 00:00', `${now.toTimeString().slice(0, 8)} → 明天 00:00（实得 ${shape(got)}）`)
  assert(new Date(draftToIso(got)).getTime() > now.getTime(), `${now.toTimeString().slice(0, 8)} 结果在未来`)
}

console.log('=== 全天扫描：结果永远严格晚于当下 ===')
// 按**真实时刻**（epoch）步进，而不是 new Date(y,m,d,h,m,s) 拼墙钟。
// 墙钟构造只能拿到歧义小时的第一次出现，结构上撞不到夏令时回拨的第二次；
// 用 epoch 步进才覆盖得到那一天里实际流过的每一刻。
let swept = 0
let past = 0
let badDay = 0
const dayStart = new Date(DAY[0], DAY[1], DAY[2]).getTime()
for (let t = dayStart; t < dayStart + 86400000; t += 15000) {
  const now = new Date(t)
  const got = laterToday(now)
  swept++
  if (new Date(draftToIso(got)).getTime() <= now.getTime()) past++
  const localDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayDiff = Math.round((got.day.getTime() - localDay) / 86400000)
  if (dayDiff !== 0 && dayDiff !== 1) badDay++
}
assert(past === 0, `${swept} 个真实时刻无一落到过去或当下（越界 ${past} 个）`)
assert(badDay === 0, `${swept} 个真实时刻的结果只落在今天或明天（越界 ${badDay} 个）`)

console.log('=== ±15 夹在当天之内 ===')
const base = { day: new Date(DAY[0], DAY[1], DAY[2]), hour: 0, minute: 5 }
assert(shape(shiftMinutes(base, -15)) === '2026-11-15 00:00', '00:05 −15 夹到 00:00 而非前一天')
const late = { day: new Date(DAY[0], DAY[1], DAY[2]), hour: 23, minute: 50 }
assert(shape(shiftMinutes(late, 15)) === '2026-11-15 23:59', '23:50 +15 夹到 23:59 而非次日')

console.log('=== 半截数字判据 ===')
assert(isComplete('hour', '3') && !isComplete('hour', '2'), '小时首位 3 已完成、2 未完成')
assert(isComplete('minute', '6') && !isComplete('minute', '5'), '分钟首位 6 已完成、5 未完成')
assert(isComplete('hour', '09') && isComplete('minute', '05'), '两位数一律完成')
assert(!isComplete('hour', ''), '空串未完成')

console.log('=== 夏令时跳变：多时区真实时刻扫描 ===')
// 墙钟拼不出重复小时的第二次出现，所以这一段一律按 epoch 步进真实时刻。
// 跳变日不写死：按小时扫一年，找 getTimezoneOffset() 变化的位置，自动定位。
// Node 支持运行时改 process.env.TZ 并立即生效（已实测），所以一个进程能跑完全部时区。
const originalTZ = process.env.TZ
const ZONES = [
  'Asia/Shanghai',        // 无 DST，对照组
  'America/New_York',     // 02:00 回拨 1 小时
  'America/Santiago',   // 午夜回拨，墙钟在同一天内倒退
  'America/Havana',       // 午夜回拨 1 小时
  'Australia/Lord_Howe',  // 半小时 DST
  'Pacific/Chatham',      // 45 分钟偏移
  'Europe/London'
]
const YEAR_START = Date.UTC(2026, 0, 1)
const HOUR = 3600000

for (const zone of ZONES) {
  process.env.TZ = zone
  const transitions = []
  let prevOffset = new Date(YEAR_START).getTimezoneOffset()
  for (let t = YEAR_START + HOUR; t < YEAR_START + 366 * 24 * HOUR; t += HOUR) {
    const offset = new Date(t).getTimezoneOffset()
    if (offset !== prevOffset) transitions.push(t)
    prevOffset = offset
  }

  let samples = 0
  let past = 0
  let badDay = 0
  let worst = 0
  for (const edge of transitions) {
    for (let t = edge - 3 * HOUR; t < edge + 3 * HOUR; t += 15000) {
      const now = new Date(t)
      const got = laterToday(now)
      const back = new Date(draftToIso(got)).getTime()
      samples++
      if (back <= now.getTime()) { past++; worst = Math.min(worst, back - now.getTime()) }
      const localDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const dayDiff = Math.round((got.day.getTime() - localDay) / 86400000)
      if (dayDiff !== 0 && dayDiff !== 1) badDay++
    }
  }
  const label = `${zone}（2026 年 ${transitions.length} 次跳变，${samples} 个时刻）`
  assert(past === 0, `${label} 无一落到过去或当下` + (past ? `（越界 ${past}，最差 ${Math.round(worst / 60000)} 分钟）` : ''))
  assert(badDay === 0, `${label} 结果只落在今天或明天` + (badDay ? `（越界 ${badDay}）` : ''))
}

console.log('=== 审查给出的两个具体反例 ===')
process.env.TZ = 'America/New_York'
{
  // 2026-11-01 01:30 EST —— 重复小时的第二次出现。Draft 表达不了它，
  // 只能跳到歧义结束后的第一个刻度 02:00 EST。
  const now = new Date(Date.UTC(2026, 10, 1, 6, 30))
  const got = laterToday(now)
  assert(shape(got) === '2026-11-1 02:00', `纽约重复小时 01:30 EST → 今天 02:00（实得 ${shape(got)}）`)
  assert(new Date(draftToIso(got)).getTime() > now.getTime(), '纽约反例结果在未来')
}
process.env.TZ = 'America/Santiago'
{
  // 2026-04-04 23:59:30 -03，午夜回拨前最后一分钟。墙钟随后倒退到 23:00，
  // 修复前会返回「今天 23:00」，比 now 早 59.5 分钟。
  const now = new Date(Date.UTC(2026, 3, 5, 2, 59, 30))
  const got = laterToday(now)
  assert(shape(got) === '2026-4-5 00:00', `圣地亚哥午夜回拨 23:59:30 → 次日 00:00（实得 ${shape(got)}）`)
  assert(new Date(draftToIso(got)).getTime() > now.getTime(), '圣地亚哥反例结果在未来')
}
if (originalTZ === undefined) delete process.env.TZ
else process.env.TZ = originalTZ

console.log('\n' + (fail === 0 ? '日期时间不变量全部成立 ✓' : fail + ' 项失败 ✗'))
process.exit(fail === 0 ? 0 : 1)