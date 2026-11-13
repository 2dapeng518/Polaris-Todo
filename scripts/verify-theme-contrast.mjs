// 主题对比度自检：解析 globals.css 的各主题令牌，按 WCAG 2.x 计算对比度。
// 正文/次要/三级文字、信号色、危险色须 ≥ 4.5:1；图形类（警告/优先级/次要强调）≥ 3:1。
// 用法：node scripts/verify-theme-contrast.mjs  （任一不达标即非零退出）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/src/styles/globals.css'), 'utf8')

function block(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  const m = css.match(re)
  if (!m) throw new Error('未找到主题块: ' + selector)
  const tokens = {}
  for (const [, name, value] of m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[name.trim()] = value.trim()
  return tokens
}

function parseColor(str) {
  str = str.trim()
  let m = str.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  m = str.match(/^rgba?\(([^)]+)\)$/i)
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
  }
  throw new Error('无法解析颜色: ' + str)
}

function composite(fg, bg) {
  const a = fg[3]
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)))
}
function lum(rgb) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
function contrast(fg, bg) {
  const l1 = lum(fg), l2 = lum(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const themes = {
  dark: block(':root'),
  light: block('[data-theme="light"]'),
  dusk: block('[data-theme="dusk"]'),
  sand: block('[data-theme="sand"]'),
  sky: block('[data-theme="sky"]'),
  green: block('[data-theme="green"]')
}

// [前景令牌, 背景令牌, 阈值, 说明]
const checks = [
  ['text', 'bg', 4.5, '正文'],
  ['text-secondary', 'bg', 4.5, '次要文字'],
  ['text-tertiary', 'bg', 4.5, '三级文字'],
  ['accent', 'bg', 4.5, '信号色文字'],
  ['on-accent', 'accent', 4.5, '强调按钮文字'],
  ['danger', 'bg', 4.5, '危险色文字'],
  ['text', 'panel-bg', 4.5, '面板正文'],
  ['warning', 'bg', 3, '警告图形'],
  ['accent-2', 'bg', 3, '次要强调图形'],
  ['priority-low', 'bg', 3, '低优先级图形'],
  ['priority-mid', 'bg', 3, '中优先级图形'],
  ['priority-high', 'bg', 3, '高优先级图形']
]

let failures = 0
for (const [name, t] of Object.entries(themes)) {
  console.log('\n=== 主题 ' + name + ' ===')
  const bg = parseColor(t['bg'])
  for (const [fgTok, bgTok, min, label] of checks) {
    const fgRaw = parseColor(t[fgTok])
    const bgRaw = parseColor(t[bgTok])
    const fg = fgRaw[3] < 1 ? composite(fgRaw, bgRaw) : fgRaw
    const ratio = contrast(fg, bgRaw)
    const ok = ratio >= min
    if (!ok) failures++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(10)} --${fgTok} / --${bgTok}  ${ratio.toFixed(2)}:1  (需 ≥ ${min})`)
  }
}
console.log('\n' + (failures === 0 ? '全部对比度达标 ✓' : failures + ' 项不达标 ✗'))
process.exit(failures === 0 ? 0 : 1)
