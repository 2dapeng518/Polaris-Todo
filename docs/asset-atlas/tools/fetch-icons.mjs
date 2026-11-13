// 从 Iconify 官方 API 取两样东西：
//   1) /collection?prefix=xxx  → 图标集的权威许可证（title / spdx / url）与图标总数
//   2) /<prefix>.json?icons=a,b,c → 未经改写的 SVG body（MCP 那条路会给描边元素注入 fill，渲染成实心）
// 产物落在 data/icon-collections.json，供图鉴页离线渲染。
//
// 用法：node docs/asset-atlas/tools/fetch-icons.mjs

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(HERE, '..', 'data')
await mkdir(DATA_DIR, { recursive: true })

const API = 'https://api.iconify.design'

// 每个库要取同一组语义，才能横向比描边风格。取不到就留空，页面上显示「该库无此语义」。
const SEMANTICS = {
  check: { label: '完成', zh: '勾选完成' },
  bell: { label: '提醒', zh: '提醒铃铛' },
  star: { label: '星标', zh: '五角星' },
  fourStar: { label: '四角星', zh: '品牌四角星' },
  repeat: { label: '重复', zh: '重复规则' },
  folder: { label: '项目', zh: '项目文件夹' },
  calendar: { label: '日期', zh: '截止日期' },
  trash: { label: '删除', zh: '删除任务' }
}

const COLLECTIONS = [
  {
    prefix: 'lucide', name: 'Lucide', strokeBased: true, defaultStroke: 2, grid: 24,
    npm: 'lucide-react', site: 'https://lucide.dev',
    picks: {
      check: 'circle-check', bell: 'bell', star: 'star', fourStar: 'sparkle',
      repeat: 'repeat-2', folder: 'folder', calendar: 'calendar-days', trash: 'trash-2'
    }
  },
  {
    prefix: 'tabler', name: 'Tabler Icons', strokeBased: true, defaultStroke: 2, grid: 24,
    npm: '@tabler/icons-react', site: 'https://tabler.io/icons',
    picks: {
      check: 'circle-check', bell: 'bell', star: 'star', fourStar: 'north-star',
      repeat: 'repeat', folder: 'folder', calendar: 'calendar', trash: 'trash'
    }
  },
  {
    prefix: 'ph', name: 'Phosphor', strokeBased: false, defaultStroke: null, grid: 256,
    npm: '@phosphor-icons/react', site: 'https://phosphoricons.com',
    picks: {
      check: 'check-circle', bell: 'bell', star: 'star', fourStar: 'star-four',
      repeat: 'arrows-clockwise', folder: 'folder', calendar: 'calendar', trash: 'trash'
    }
  },
  {
    prefix: 'solar', name: 'Solar', strokeBased: true, defaultStroke: 1.5, grid: 24,
    npm: '(社区包 solar-icons，许可证未声明)', site: 'https://www.figma.com/community/file/1166831539721848736',
    picks: {
      check: 'check-circle-linear', bell: 'bell-linear', star: 'star-linear', fourStar: 'star-fall-linear',
      repeat: 'refresh-linear', folder: 'folder-linear', calendar: 'calendar-linear', trash: 'trash-bin-trash-linear'
    }
  },
  {
    prefix: 'iconoir', name: 'Iconoir', strokeBased: true, defaultStroke: 1.5, grid: 24,
    npm: 'iconoir-react', site: 'https://iconoir.com',
    picks: {
      check: 'check-circle', bell: 'bell', star: 'star', fourStar: 'sparks',
      repeat: 'refresh', folder: 'folder', calendar: 'calendar', trash: 'bin-full'
    }
  },
  {
    prefix: 'mingcute', name: 'MingCute', strokeBased: false, defaultStroke: null, grid: 24,
    npm: '@mingcute/icons', site: 'https://www.mingcute.com',
    picks: {
      check: 'check-circle-line', bell: 'bell-line', star: 'star-line', fourStar: 'sparkles-line',
      repeat: 'refresh-line', folder: 'folder-line', calendar: 'calendar-line', trash: 'delete-line'
    }
  },
  {
    prefix: 'heroicons', name: 'Heroicons', strokeBased: true, defaultStroke: 1.5, grid: 24,
    npm: '@heroicons/react', site: 'https://heroicons.com',
    picks: {
      check: 'check-circle', bell: 'bell', star: 'star', fourStar: 'sparkles',
      repeat: 'arrow-path', folder: 'folder', calendar: 'calendar-days', trash: 'trash'
    }
  },
  {
    prefix: 'ri', name: 'Remix Icon', strokeBased: false, defaultStroke: null, grid: 24,
    npm: '@remixicon/react', site: 'https://remixicon.com',
    picks: {
      check: 'checkbox-circle-line', bell: 'notification-line', star: 'star-line', fourStar: 'sparkling-line',
      repeat: 'repeat-line', folder: 'folder-line', calendar: 'calendar-line', trash: 'delete-bin-line'
    }
  },
  {
    prefix: 'radix-icons', name: 'Radix Icons', strokeBased: false, defaultStroke: null, grid: 15,
    npm: '@radix-ui/react-icons', site: 'https://www.radix-ui.com/icons',
    picks: {
      check: 'check-circled', bell: 'bell', star: 'star', fourStar: 'magic-wand',
      repeat: 'update', folder: 'archive', calendar: 'calendar', trash: 'trash'
    }
  },
  {
    prefix: 'uiw', name: 'Untitled UI (社区镜像 uiw)', strokeBased: true, defaultStroke: 2, grid: 24,
    npm: '@untitled-ui/icons-react', site: 'https://untitledui.com/icons',
    picks: { check: 'check-circle', bell: 'bell', star: 'star', fourStar: 'sparkles', repeat: 'refresh-ccw', folder: 'folder', calendar: 'calendar', trash: 'trash' }
  }
]

// 额外抓取：同一语义的「实心 / 线性」成对变体，用来演示状态区分。
const PAIRS = [
  { prefix: 'lucide', names: ['circle', 'circle-check-big', 'check'] },
  { prefix: 'tabler', names: ['circle-check-filled', 'star-filled', 'bell-filled'] },
  { prefix: 'ph', names: ['check-circle-fill', 'check-circle-light', 'check-circle-bold', 'check-circle-duotone', 'star-four-fill'] },
  { prefix: 'solar', names: ['check-circle-bold', 'check-circle-line-duotone'] },
  { prefix: 'mingcute', names: ['check-circle-fill'] },
  { prefix: 'iconoir', names: ['check-circle-solid'] },
  { prefix: 'heroicons', names: ['check-circle-solid'] }
]

async function getJson(url, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      last = err
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 900 * (i + 1)))
    }
  }
  throw last
}

const results = []

for (const col of COLLECTIONS) {
  const rec = { ...col, semantics: SEMANTICS, icons: {}, extra: {} }
  try {
    const meta = await getJson(`${API}/collection?prefix=${col.prefix}`)
    rec.total = meta.total ?? null
    rec.license = meta.license ?? null
    rec.author = meta.author ?? null
    rec.category = meta.category ?? ''
    rec.samples = meta.samples ?? []
    rec.metaOk = true
    console.log(`\n## ${col.name} (${col.prefix})  total=${rec.total}  license=${rec.license?.spdx ?? rec.license?.title ?? '(未声明)'}`)
  } catch (err) {
    rec.metaOk = false
    rec.metaError = String(err.message ?? err)
    console.log(`\n## ${col.name} (${col.prefix})  ✗ 元数据 ${rec.metaError}`)
  }

  const wanted = Object.entries(col.picks)
  const list = wanted.map(([, n]) => n).join(',')
  try {
    const data = await getJson(`${API}/${col.prefix}.json?icons=${encodeURIComponent(list)}`)
    rec.gridWidth = data.width ?? col.grid
    rec.gridHeight = data.height ?? col.grid
    const notFound = data.not_found ?? []
    for (const [sem, iconName] of wanted) {
      const entry = data.icons?.[iconName]
      if (!entry) { rec.icons[sem] = null; continue }
      rec.icons[sem] = {
        name: iconName,
        body: entry.body,
        width: entry.width ?? rec.gridWidth,
        height: entry.height ?? rec.gridHeight
      }
    }
    const got = Object.values(rec.icons).filter(Boolean).length
    console.log(`   图标 ${got}/${wanted.length}${notFound.length ? `  缺失: ${notFound.join(', ')}` : ''}`)
  } catch (err) {
    rec.iconsError = String(err.message ?? err)
    console.log(`   ✗ 图标 ${rec.iconsError}`)
  }
  results.push(rec)
}

const pairs = {}
for (const p of PAIRS) {
  try {
    const data = await getJson(`${API}/${p.prefix}.json?icons=${encodeURIComponent(p.names.join(','))}`)
    pairs[p.prefix] = { width: data.width ?? 24, height: data.height ?? 24, icons: data.icons ?? {}, notFound: data.not_found ?? [] }
    console.log(`   变体 ${p.prefix}: ${Object.keys(data.icons ?? {}).length}/${p.names.length}`)
  } catch (err) {
    pairs[p.prefix] = { error: String(err.message ?? err) }
    console.log(`   ✗ 变体 ${p.prefix}: ${err.message}`)
  }
}

await writeFile(
  resolve(DATA_DIR, 'icon-collections.json'),
  JSON.stringify({ semantics: SEMANTICS, collections: results, pairs }, null, 2),
  'utf8'
)
console.log('\n写入 docs/asset-atlas/data/icon-collections.json')
