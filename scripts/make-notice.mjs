// 生成 NOTICE 与 licenses/ 下的许可原文。
// 素材随 NSIS 安装包分发即构成再分发，OFL / ISC / MIT / BSD / 0BSD 都要求
// 保留版权与许可声明。这里从**已安装的包**里逐字提取，不手抄。
//
// 采集范围是**生产依赖闭包**，不是顶层 dependencies：framer-motion、scheduler、
// tslib 等传递依赖同样随包分发，漏掉它们等于声明不完整。
//
// 用法：node scripts/make-notice.mjs
// 依赖变动后重跑。scripts/ 本身被 electron-builder 排除，不进安装包。

import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NM = join(ROOT, 'node_modules')
const LICENSE_DIR = join(ROOT, 'licenses')

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'LICENSE-MIT', 'OFL.txt']

async function readLicense(dir) {
  for (const name of LICENSE_NAMES) {
    try {
      return { name, text: await readFile(join(dir, name), 'utf8') }
    } catch {
      // 换下一个候选名
    }
  }
  try {
    const hit = (await readdir(dir)).find((f) => /licen[cs]e/i.test(f))
    if (hit) return { name: hit, text: await readFile(join(dir, hit), 'utf8') }
  } catch {
    // 目录不可读
  }
  return null
}

// ── 版权行识别 ──────────────────────────────────────────────────────────────
// 必须扫全文：lucide 的 Feather MIT 段、rrule 的 python-dateutil 段都在文件中后部，
// 只取「头部连续版权行」会把它们整段丢掉。
// 但又不能见 copyright 就抓：OFL/ISC 正文里的 "Copyright Holder. This restriction…"
// "copyright notice and this permission notice appear in all copies." 都是条款句子。
// 判据：行首是 Copyright（大小写敏感，排除全大写的免责段）/(c)/©，
//       且含四位年份或 (c)/© 标记（React 的 "Copyright (c) Meta Platforms" 无年份）。
function isCopyrightNotice(line) {
  const t = line.trim()
  if (!/^(Copyright\b|\(c\)|©)/.test(t)) return false
  return /\b(19|20)\d{2}\b/.test(t) || /\(c\)|©/i.test(t)
}

function copyrightLines(text, spdx) {
  // OFL 头部就是 "This Font Software is licensed" 之前的内容。
  // noto-sans-sc 的头部只有 "Google Inc."，没有 Copyright 字样，也要照抄。
  if (String(spdx).startsWith('OFL')) {
    const i = text.search(/This Font Software is licensed/i)
    const head = i >= 0 ? text.slice(0, i) : text
    return head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  }
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    if (isCopyrightNotice(raw)) out.push(raw.trim())
  }
  return [...new Set(out)]
}

// ── 复合许可识别 ────────────────────────────────────────────────────────────
// lucide-react 是 ISC + Feather 派生图标的 MIT，两段都在同一份 LICENSE 里。
// 只按 package.json 的 license 字段标记会漏掉第二段的归属义务。
const LICENSE_HEADERS = [
  { spdx: 'ISC', re: /^\s*ISC License\s*$/im },
  { spdx: 'MIT', re: /^\s*(The )?MIT License(\s*\(MIT\))?/im },
  { spdx: 'Apache-2.0', re: /^\s*Apache License\s*$/im },
  { spdx: 'BSD-3-Clause', re: /Redistribution and use in source and binary forms, with or without/i },
  { spdx: 'BSD-2-Clause', re: /^\s*BSD 2-Clause/im },
  { spdx: '0BSD', re: /^\s*(BSD Zero Clause License|0BSD)/im }
]

function detectLicenses(text, declared) {
  const found = new Set()
  for (const h of LICENSE_HEADERS) if (h.re.test(text)) found.add(h.spdx)
  // BSD-3 与 BSD-2 的正文特征重叠，声明优先
  if (found.has('BSD-3-Clause') && found.has('BSD-2-Clause')) {
    found.delete(declared === 'BSD-2-Clause' ? 'BSD-3-Clause' : 'BSD-2-Clause')
  }
  const primary = String(declared || '').trim()
  if (primary && primary !== '(未声明)') found.add(primary)
  if (!found.size) return { label: primary || '(未声明)', parts: [] }
  const parts = [...found].sort()
  return { label: parts.join(' AND '), parts }
}

// OFL 正文从 "This Font Software is licensed" 起，前面的版权行归 NOTICE
function oflBody(text) {
  const i = text.search(/This Font Software is licensed/i)
  return i >= 0 ? text.slice(i).trim() : text.trim()
}

// 其余许可：保留全文（含多段），只去掉最前面的标题与首个版权行以外的空行。
// 不裁剪正文——lucide 的 Feather 段、rrule 的 python-dateutil 段都必须留住。
function licenseBody(text) {
  return text.trim()
}

// RFN：OFL 的 Reserved Font Name 条款只在字体声明了保留名时才约束改名。
function hasReservedFontName(text) {
  return /with Reserved Font Name/i.test(text)
}

// ── 生产依赖闭包 ────────────────────────────────────────────────────────────
// npm ls --omit=dev --all 是权威来源；失败则退回递归遍历 node_modules。
function productionClosure() {
  try {
    // 直接用当前 node 跑 npm 的 CLI 入口：不经 shell，避免 .cmd 解析与参数拼接问题。
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const raw = execFileSync(
      process.execPath,
      [npmCli, 'ls', '--omit=dev', '--all', '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const tree = JSON.parse(raw)
    const names = new Set()
    const walk = (node) => {
      for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
        if (dep.dev) continue
        // npm ls --all 会列出未安装的可选 peer（zustand 的 immer /
        // use-sync-external-store / remix）：无 version 且无 resolved 即未落盘，
        // 不随包分发，既不进清单也不算错误。
        if (!dep.version && !dep.resolved) continue
        names.add(name)
        walk(dep)
      }
    }
    walk(tree)
    return { names: [...names].sort(), source: 'npm ls --omit=dev --all' }
  } catch {
    // 退回：从顶层生产依赖出发，按各自 package.json 的 dependencies 递归
    const seen = new Set()
    const visit = (name) => {
      if (seen.has(name)) return
      seen.add(name)
      try {
        const meta = JSON.parse(readFileSync(join(NM, name, 'package.json'), 'utf8'))
        for (const child of Object.keys(meta.dependencies ?? {})) visit(child)
      } catch {
        // 包未安装，交由下游 missing 报告
      }
    }
    for (const name of Object.keys(pkg.dependencies)) visit(name)
    return { names: [...seen].sort(), source: '递归遍历 node_modules（npm ls 不可用）' }
  }
}

const { names, source } = productionClosure()

const entries = []
const missing = []

for (const name of names) {
  const dir = join(NM, name)
  let meta
  try {
    meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    missing.push(`${name}（未安装，跳过）`)
    continue
  }
  const lic = await readLicense(dir)
  if (!lic) {
    missing.push(`${name}（找不到许可原文）`)
    continue
  }
  const declared = meta.license ?? '(未声明)'
  const copyright = copyrightLines(lic.text, declared)
  if (!copyright.length) {
    // 抓不到版权行必须报错，不能静默出一份缺声明的 NOTICE
    missing.push(`${name}（未能从 ${lic.name} 提取到版权行，需人工确认）`)
  }
  const { label, parts } = detectLicenses(lic.text, declared)
  entries.push({
    name,
    version: meta.version,
    declared,
    spdx: label,
    parts,
    copyright,
    file: lic.name,
    text: lic.text,
    homepage: meta.homepage ?? '',
    rfn: String(declared).startsWith('OFL') ? hasReservedFontName(lic.text) : null
  })
}

entries.sort((a, b) => a.spdx.localeCompare(b.spdx) || a.name.localeCompare(b.name))

// ── licenses/ 原文 ──────────────────────────────────────────────────────────
await mkdir(LICENSE_DIR, { recursive: true })

const bySpdx = new Map()
for (const e of entries) {
  if (!bySpdx.has(e.spdx)) bySpdx.set(e.spdx, [])
  bySpdx.get(e.spdx).push(e)
}

const written = []
for (const [spdx, group] of bySpdx) {
  const safe = spdx.replace(/[^\w.-]+/g, '-')
  const file = `${safe}.txt`
  // 复合许可（如 ISC AND MIT）保留全文，绝不按单一 SPDX 裁剪
  const body = spdx.startsWith('OFL') ? oflBody(group[0].text) : licenseBody(group[0].text)
  const header = spdx.startsWith('OFL') ? '' : `${spdx} 许可原文（版权归属见 NOTICE）\n\n`
  await writeFile(join(LICENSE_DIR, file), header + body + '\n', 'utf8')
  written.push(file)
}

// 清掉孤儿：许可组合变化后（例如 lucide 从 ISC 变成 ISC AND MIT），
// 旧文件名会留在目录里跟着进安装包，成为重复且过时的声明。
const orphans = (await readdir(LICENSE_DIR)).filter((f) => f.endsWith('.txt') && !written.includes(f))
for (const f of orphans) await rm(join(LICENSE_DIR, f))

// ── NOTICE ──────────────────────────────────────────────────────────────────
const L = []
L.push('Polaris — 第三方组件与素材声明')
L.push('')
L.push(`本文件由 scripts/make-notice.mjs 生成（Polaris v${pkg.version}）。`)
L.push(`采集范围：生产依赖闭包（${source}），共 ${entries.length} 个组件。`)
L.push('Polaris 以 NSIS 安装包分发，下列组件与字体随包再分发，')
L.push('按其许可要求在此保留版权声明与许可指引。许可原文见同目录 licenses/。')
L.push('')
const hasOwnLicense = await readFile(join(ROOT, 'LICENSE'), 'utf8').then(() => true, () => false)
L.push(hasOwnLicense
  ? `本软件自身以 ${pkg.license} 许可发布，见 LICENSE。`
  : `本软件自身在 package.json 中声明为 ${pkg.license} 许可；仓库尚未提供 LICENSE 原文文件。`)
L.push('')

for (const [spdx, group] of bySpdx) {
  const safe = spdx.replace(/[^\w.-]+/g, '-')
  L.push('─'.repeat(64))
  L.push(`${spdx}    许可原文：licenses/${safe}.txt`)
  L.push('─'.repeat(64))
  L.push('')
  for (const e of group) {
    L.push(`  ${e.name} ${e.version}`)
    if (e.parts.length > 1) L.push(`    复合许可：${e.parts.join(' + ')}（同一份 ${e.file} 内含多段授权）`)
    for (const c of e.copyright) L.push(`    ${c}`)
    if (e.homepage) L.push(`    ${e.homepage}`)
    L.push('')
  }
  if (spdx.startsWith('OFL')) {
    const rfn = group.filter((e) => e.rfn)
    L.push('  OFL 附加说明：')
    L.push('  - 字体随应用分发属于「嵌入软件」，OFL 允许，且不要求应用本身开源。')
    L.push('  - 不得单独售卖字体本身。')
    L.push('  - 本项目分发的是 fontsource 提供的 WOFF2 转码与 unicode-range 分片版本。')
    L.push('    按 OFL DEFINITIONS，格式转换属 Modified Version。')
    if (rfn.length) {
      L.push(`  - ⚠ 以下字体声明了 Reserved Font Name，修改后必须改名：${rfn.map((e) => e.name).join(', ')}`)
    } else {
      L.push('  - 上述字体的许可头部均未声明 Reserved Font Name，故不触发改名义务。')
      L.push('    若将来引入声明了 RFN 的字体，本说明会自动改为警告。')
    }
    L.push('')
  }
  if (spdx.includes('BSD-3-Clause')) {
    L.push('  BSD-3-Clause 附加说明：')
    L.push('  - 再分发须保留上述版权声明、条件列表与免责声明（见 licenses/）。')
    L.push('  - 不得以原作者或贡献者名义为本产品背书或促销。')
    L.push('')
  }
  if (spdx === '0BSD') {
    L.push('  0BSD 附加说明：不附加保留条件，此处列出仅为清单完整。')
    L.push('')
  }
  if (spdx.includes('AND')) {
    L.push('  复合许可说明：该组件的同一份许可文件内含多段授权，')
    L.push('  各段的版权与义务均须保留，不可只按其中一种许可处理。')
    L.push('')
  }
}

L.push('─'.repeat(64))
L.push('')
L.push('说明：渲染器依赖由 Vite 打包进 out/renderer/assets，字体 woff2 亦在其中；')
L.push('node_modules 内的 @fontsource-variable 整包已在 electron-builder.yml 中排除，')
L.push('以免同一份字体被重复打包。声明义务不因打包形式改变而免除。')
L.push('')

await writeFile(join(ROOT, 'NOTICE'), L.join('\n'), 'utf8')

console.log(`NOTICE 已生成：${entries.length} 个组件（${source}）`)
for (const [spdx, group] of bySpdx) {
  console.log(`  ${spdx.padEnd(16)} ${group.length} 个  → licenses/${spdx.replace(/[^\w.-]+/g, '-')}.txt`)
}
console.log(`许可原文 ${written.length} 份：${written.join(', ')}`)
const compound = entries.filter((e) => e.parts.length > 1)
if (compound.length) {
  console.log(`复合许可 ${compound.length} 个：${compound.map((e) => e.name + '(' + e.spdx + ')').join(', ')}`)
}
if (missing.length) {
  console.log(`\n⚠ 未能处理 ${missing.length} 项：`)
  for (const m of missing) console.log(`  ${m}`)
  process.exitCode = 1
}
