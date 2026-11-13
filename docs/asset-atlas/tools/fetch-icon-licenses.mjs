// Iconify 的 /collection?prefix= 端点没返回 license 字段（本轮实测为空）。
// 改从上游 iconify/icon-sets 仓库的 collections.json 取——那是 Iconify 自己的权威登记表。
// 同时补齐上一轮 404 的图标名。
//
// 用法：node docs/asset-atlas/tools/fetch-icon-licenses.mjs

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(HERE, '..', 'data')
const PREFIXES = ['lucide', 'tabler', 'ph', 'solar', 'iconoir', 'mingcute', 'heroicons', 'ri', 'radix-icons', 'uiw']

async function getJson(url, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      last = err
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1)))
    }
  }
  throw last
}

const licenses = {}
try {
  const all = await getJson('https://raw.githubusercontent.com/iconify/icon-sets/master/collections.json')
  for (const p of PREFIXES) {
    const c = all[p]
    if (!c) { licenses[p] = { ok: false, error: '登记表中没有该前缀' }; continue }
    licenses[p] = {
      ok: true,
      name: c.name,
      total: c.total,
      author: c.author ?? null,
      license: c.license ?? null,
      samples: c.samples ?? [],
      category: c.category ?? '',
      palette: c.palette ?? null,
      height: c.height ?? null
    }
    console.log(`${p.padEnd(12)} ${String(c.license?.spdx ?? c.license?.title ?? '(未声明)').padEnd(20)} ${c.name}  total=${c.total}`)
    if (c.license?.url) console.log(`             ${c.license.url}`)
  }
} catch (err) {
  console.log(`✗ collections.json ${err.message}`)
}

// 补齐缺失图标：上一轮 mingcute 的 bell-line / refresh-line 与 uiw 的多数名字不存在。
const FIXES = [
  { prefix: 'mingcute', names: ['notification-line', 'refresh-2-line', 'loading-line', 'alert-line'] },
  { prefix: 'uiw', names: ['check-circle-o', 'bell-o', 'star-o', 'reload1', 'calendar-o', 'delete-o', 'folder-o'] },
  { prefix: 'lucide', names: ['flag', 'circle', 'check'] }
]
const fixed = {}
for (const f of FIXES) {
  try {
    const data = await getJson(`https://api.iconify.design/${f.prefix}.json?icons=${encodeURIComponent(f.names.join(','))}`)
    fixed[f.prefix] = { width: data.width ?? 24, height: data.height ?? 24, icons: data.icons ?? {}, notFound: data.not_found ?? [] }
    console.log(`补 ${f.prefix}: 拿到 ${Object.keys(data.icons ?? {}).join(', ')}${data.not_found?.length ? ` / 缺 ${data.not_found.join(', ')}` : ''}`)
  } catch (err) {
    fixed[f.prefix] = { error: String(err.message ?? err) }
    console.log(`✗ 补 ${f.prefix}: ${err.message}`)
  }
}

await writeFile(resolve(DATA_DIR, 'icon-licenses.json'), JSON.stringify({ licenses, fixed }, null, 2), 'utf8')

// 把许可证回填进 icon-collections.json，页面只需要读一个文件。
try {
  const path = resolve(DATA_DIR, 'icon-collections.json')
  const collections = JSON.parse(await readFile(path, 'utf8'))
  for (const col of collections.collections) {
    const l = licenses[col.prefix]
    if (l?.ok) {
      col.license = l.license
      col.author = l.author
      col.total = l.total
      col.metaOk = true
      delete col.metaError
    }
    const fx = fixed[col.prefix]
    if (fx?.icons) {
      col.extra = { ...(col.extra ?? {}), ...fx.icons }
    }
  }
  collections.pairs = { ...collections.pairs }
  await writeFile(path, JSON.stringify(collections, null, 2), 'utf8')
  console.log('\n许可证已回填进 icon-collections.json')
} catch (err) {
  console.log(`✗ 回填失败: ${err.message}`)
}
