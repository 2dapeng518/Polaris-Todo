// 主题注册表不变量自检：配对对合、家族交叉、窗口背景与 CSS --bg 一致、元数据完整。
// 用法：node scripts/verify-theme-registry.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { THEME_ORDER, THEME_META, THEME_WINDOW_BG, THEME_SYMBOL_COLOR, isAppTheme, themeFamily, partnerTheme } from '../src/shared/themes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/src/styles/globals.css'), 'utf8')
let fail = 0
const assert = (cond, msg) => { if (!cond) { fail++; console.log('  FAIL ' + msg) } else console.log('  PASS ' + msg) }

console.log('=== 注册表结构 ===')
assert(THEME_ORDER.length === 6, 'THEME_ORDER 含 6 套主题')
assert(new Set(THEME_ORDER).size === 6, '主题 id 唯一')
for (const id of THEME_ORDER) {
  assert(isAppTheme(id), 'isAppTheme 接受 ' + id)
  const m = THEME_META[id]
  assert(Boolean(m && m.label && m.desc && Array.isArray(m.swatch) && m.swatch.length === 3), 'THEME_META[' + id + '] 元数据完整')
  assert(/^#[0-9a-f]{6}$/i.test(THEME_WINDOW_BG[id]), 'THEME_WINDOW_BG[' + id + '] 为合法 HEX')
}
assert(!isAppTheme('blue') && !isAppTheme(undefined) && !isAppTheme('LIGHT'), 'isAppTheme 拒绝非法值')

console.log('=== 配对对合与家族交叉 ===')
for (const id of THEME_ORDER) {
  assert(partnerTheme(partnerTheme(id)) === id, 'partner 对合：' + id + ' ↔ ' + partnerTheme(id))
  assert(partnerTheme(id) !== id, 'partner 非自身：' + id)
}
// 经典两对必须跨家族；天蓝↔护眼绿同为浅色护眼画布，允许同家族配对。
for (const id of ['dark', 'light', 'dusk', 'sand']) {
  assert(themeFamily(partnerTheme(id)) !== themeFamily(id), 'partner 跨家族：' + id)
}
assert(themeFamily('dark') === 'dark' && themeFamily('dusk') === 'dark', 'dark/dusk 属深色家族')
assert(themeFamily('light') === 'light' && themeFamily('sand') === 'light' && themeFamily('sky') === 'light' && themeFamily('green') === 'light', 'light/sand/sky/green 属浅色家族')
assert(THEME_SYMBOL_COLOR.dark && THEME_SYMBOL_COLOR.light, '原生符号色按家族齐备')

console.log('=== 窗口背景与 CSS --bg 一致 ===')
function bgOf(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  const m = css.match(re)
  const t = m && m[1].match(/--bg:\s*([^;]+);/)
  return t ? t[1].trim().toLowerCase() : null
}
const cssBg = { dark: bgOf(':root'), light: bgOf('[data-theme="light"]'), dusk: bgOf('[data-theme="dusk"]'), sand: bgOf('[data-theme="sand"]'), sky: bgOf('[data-theme="sky"]'), green: bgOf('[data-theme="green"]') }
for (const id of THEME_ORDER) {
  assert(cssBg[id] === THEME_WINDOW_BG[id].toLowerCase(), id + ' 窗口背景 ' + THEME_WINDOW_BG[id] + ' === CSS --bg ' + cssBg[id])
}
console.log('=== 令牌覆盖（无遗漏样式） ===')
function themeTokens(selector) {
  const i = css.indexOf(selector)
  const open = css.indexOf('{', i)
  const close = css.indexOf('}', open)
  const set = new Set()
  for (const line of css.slice(open + 1, close).split('\n')) {
    const t = line.trim()
    if (t.startsWith('--')) set.add(t.slice(2, t.indexOf(':')).trim())
  }
  return set
}
const rootSet = themeTokens(':root')
const structural = /^(space|radius|font|ease|titlebar|sidebar-width)/
const colorKeys = [...rootSet].filter(k => !structural.test(k))
const sel = { dark: ':root', light: '[data-theme="light"]', dusk: '[data-theme="dusk"]', sand: '[data-theme="sand"]', sky: '[data-theme="sky"]', green: '[data-theme="green"]' }
for (const id of THEME_ORDER) {
  const set = themeTokens(sel[id])
  const missing = colorKeys.filter(k => !set.has(k))
  assert(missing.length === 0, id + ' 定义全部 ' + colorKeys.length + ' 个主题令牌' + (missing.length ? '（缺 ' + missing.join(', ') + '）' : ''))
}
const defined = new Set()
for (const line of css.split('\n')) {
  const t = line.trim()
  if (t.startsWith('--')) defined.add(t.slice(2, t.indexOf(':')).trim())
}
const used = new Set()
const varRe = /var\(\s*--([\w-]+)/g
let mm
while ((mm = varRe.exec(css)) !== null) used.add(mm[1])
const undef = [...used].filter(u => !defined.has(u) && !u.startsWith('tw-'))
assert(undef.length === 0, '全部 ' + used.size + ' 个 var() 引用均有定义' + (undef.length ? '（未定义: ' + undef.join(', ') + '）' : ''))
console.log('\n' + (fail === 0 ? '注册表全部不变量成立 ✓' : fail + ' 项失败 ✗'))
process.exit(fail === 0 ? 0 : 1)
