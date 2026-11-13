// 素材抓取器：把候选字体的 latin 可变 woff2 下载到本地，并从 npm registry 取权威的
// license / version 字段。产物是「事实」，不是推测——每条都带 HTTP 状态与字节数。
//
// 用法：node docs/asset-atlas/tools/fetch-assets.mjs
// 下载物只落在 docs/asset-atlas/fonts/（新建空目录），脚本本身在 tools/，两者分开。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FONT_DIR = resolve(ROOT, 'fonts')
const DATA_DIR = resolve(ROOT, 'data')

const CDN = 'https://cdn.jsdelivr.net/npm'
const REGISTRY = 'https://registry.npmjs.org'

// 现有四套 + 候选。subset 优先 latin，退回第一个可用 subset。
const FONT_PACKAGES = [
  { id: 'manrope', pkg: '@fontsource-variable/manrope', role: 'current', use: '--font-display' },
  { id: 'inter', pkg: '@fontsource-variable/inter', role: 'current', use: '--font-ui' },
  { id: 'geist-mono', pkg: '@fontsource-variable/geist-mono', role: 'current', use: '--font-mono' },
  { id: 'geist', pkg: '@fontsource-variable/geist', role: 'candidate', use: 'UI / display' },
  { id: 'plus-jakarta-sans', pkg: '@fontsource-variable/plus-jakarta-sans', role: 'candidate', use: 'display' },
  { id: 'figtree', pkg: '@fontsource-variable/figtree', role: 'candidate', use: 'UI' },
  { id: 'instrument-sans', pkg: '@fontsource-variable/instrument-sans', role: 'candidate', use: 'UI' },
  { id: 'public-sans', pkg: '@fontsource-variable/public-sans', role: 'candidate', use: 'UI' },
  { id: 'space-grotesk', pkg: '@fontsource-variable/space-grotesk', role: 'candidate', use: 'display' },
  { id: 'sora', pkg: '@fontsource-variable/sora', role: 'candidate', use: 'display' },
  { id: 'outfit', pkg: '@fontsource-variable/outfit', role: 'candidate', use: 'display' },
  { id: 'bricolage-grotesque', pkg: '@fontsource-variable/bricolage-grotesque', role: 'candidate', use: 'display' },
  { id: 'inter-tight', pkg: '@fontsource-variable/inter-tight', role: 'candidate', use: 'UI' },
  { id: 'geologica', pkg: '@fontsource-variable/geologica', role: 'candidate', use: 'display' },
  { id: 'jetbrains-mono', pkg: '@fontsource-variable/jetbrains-mono', role: 'candidate', use: 'mono' },
  { id: 'source-code-pro', pkg: '@fontsource-variable/source-code-pro', role: 'candidate', use: 'mono' },
  { id: 'roboto-mono', pkg: '@fontsource-variable/roboto-mono', role: 'candidate', use: 'mono' },
  { id: 'martian-mono', pkg: '@fontsource-variable/martian-mono', role: 'candidate', use: 'mono' },
  { id: 'commit-mono', pkg: '@fontsource/commit-mono', role: 'candidate', use: 'mono（非可变）' },
  { id: 'cascadia-code', pkg: '@fontsource/cascadia-code', role: 'candidate', use: 'mono（非可变）' },
  { id: 'iosevka', pkg: '@fontsource/iosevka', role: 'candidate', use: 'mono（非可变）' },
  { id: 'ibm-plex-mono', pkg: '@fontsource/ibm-plex-mono', role: 'candidate', use: 'mono（非可变）' },
  { id: 'ibm-plex-sans', pkg: '@fontsource/ibm-plex-sans', role: 'candidate', use: 'UI（非可变）' }
]

// 图标库 / 动效库 / 特效库：只取 registry 元数据，不下载运行时。
const CODE_PACKAGES = [
  'lucide-react',
  '@phosphor-icons/react',
  '@tabler/icons-react',
  '@heroicons/react',
  'iconoir-react',
  'mingcute-icons',
  '@remixicon/react',
  'solar-icons',
  '@iconify/react',
  '@iconify/json',
  'unplugin-icons',
  'motion',
  '@formkit/auto-animate',
  'animejs',
  'gsap',
  'lottie-web',
  '@lottiefiles/dotlottie-web',
  '@rive-app/react-canvas',
  'animate.css',
  'tw-animate-css',
  '@paper-design/shaders-react',
  '@fontsource-variable/noto-sans-sc',
  '@fontsource-variable/noto-serif-sc',
  '@fontsource/lxgw-wenkai-lite',
  '@fontsource/lxgw-wenkai-screen',
  'cn-font-split',
  'svgo'
]

// jsDelivr / registry 偶发 fetch failed 与 429，退避重试三次；失败如实记录，不静默跳过。
async function withRetry(fn, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw last
}

async function getJson(url) {
  return withRetry(async () => {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })
}

async function registryFacts(pkg) {
  try {
    const meta = await getJson(`${REGISTRY}/${pkg.replace('/', '%2F')}/latest`)
    return {
      pkg,
      ok: true,
      version: meta.version ?? '',
      license: meta.license ?? '(未声明)',
      homepage: meta.homepage ?? '',
      repository: typeof meta.repository === 'string' ? meta.repository : (meta.repository?.url ?? ''),
      description: meta.description ?? '',
      unpackedSize: meta.dist?.unpackedSize ?? null,
      tarball: meta.dist?.tarball ?? ''
    }
  } catch (err) {
    return { pkg, ok: false, error: String(err.message ?? err) }
  }
}

// 从 fontsource 的 CSS 里解析出真实的 woff2 URL 与 font-family / 可变轴。
function parseCss(css, baseUrl) {
  const family = /font-family:\s*'([^']+)'/.exec(css)?.[1] ?? ''
  const weight = /font-weight:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? ''
  const blocks = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1])
  const faces = blocks.map((body) => {
    const url = /url\(([^)]+\.woff2)\)/.exec(body)?.[1]?.replace(/["']/g, '') ?? ''
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? ''
    const style = /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal'
    // 每个 face 自己的字重：整份 CSS 的第一个 font-weight 未必属于我们选中的那一片。
    const faceWeight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? ''
    return { url: url.startsWith('.') ? new URL(url, baseUrl).href : url, range, style, faceWeight, body }
  }).filter((f) => f.url)
  return { family, weight, faces }
}

async function fetchFont(entry) {
  const out = { ...entry }
  try {
    const meta = await getJson(`${REGISTRY}/${entry.pkg.replace('/', '%2F')}/latest`)
    out.version = meta.version
    out.license = meta.license ?? '(未声明)'
    out.homepage = meta.homepage ?? ''
    out.repository = typeof meta.repository === 'string' ? meta.repository : (meta.repository?.url ?? '')
    out.unpackedSize = meta.dist?.unpackedSize ?? null

    const cssUrl = `${CDN}/${entry.pkg}@${meta.version}/index.css`
    const css = await withRetry(async () => {
      const cssRes = await fetch(cssUrl)
      if (!cssRes.ok) throw new Error(`index.css HTTP ${cssRes.status}`)
      return cssRes.text()
    })
    out.cssUrl = cssUrl
    const parsed = parseCss(css, cssUrl)
    out.family = parsed.family
    out.weightRange = parsed.weight
    out.faceCount = parsed.faces.length

    // 只要 normal 样式里覆盖基本拉丁 (U+0000-00FF) 的那一片，预览够用且体积最小。
    const latin = parsed.faces.find((f) => f.style === 'normal' && /U\+0000-00FF/i.test(f.range))
      ?? parsed.faces.find((f) => f.style === 'normal')
      ?? parsed.faces[0]
    if (!latin) throw new Error('CSS 里没有解析到 woff2')

    out.sourceUrl = latin.url
    out.unicodeRange = latin.range
    out.faceWeight = latin.faceWeight || parsed.weight
    out.isVariableFace = /\d+\s+\d+/.test(out.faceWeight)
    const buf = await withRetry(async () => {
      const fontRes = await fetch(latin.url)
      if (!fontRes.ok) throw new Error(`woff2 HTTP ${fontRes.status}`)
      return Buffer.from(await fontRes.arrayBuffer())
    })
    const file = `${entry.id}.woff2`
    await writeFile(resolve(FONT_DIR, file), buf)
    out.localFile = `fonts/${file}`
    out.bytes = buf.length
    out.ok = true
  } catch (err) {
    out.ok = false
    out.error = String(err.message ?? err)
  }
  return out
}

await mkdir(FONT_DIR, { recursive: true })
await mkdir(DATA_DIR, { recursive: true })

console.log(`抓取 ${FONT_PACKAGES.length} 个字体包 + ${CODE_PACKAGES.length} 个代码包元数据…`)

const fonts = []
for (const entry of FONT_PACKAGES) {
  const r = await fetchFont(entry)
  fonts.push(r)
  console.log(r.ok
    ? `  ✓ ${entry.id.padEnd(22)} ${String(r.bytes).padStart(7)}B  ${r.license}  ${r.version}`
    : `  ✗ ${entry.id.padEnd(22)} ${r.error}`)
}

const packages = []
for (const pkg of CODE_PACKAGES) {
  const r = await registryFacts(pkg)
  packages.push(r)
  console.log(r.ok
    ? `  ✓ ${pkg.padEnd(32)} ${r.license.padEnd(14)} ${r.version}`
    : `  ✗ ${pkg.padEnd(32)} ${r.error}`)
}

const facts = { fonts, packages }
await writeFile(resolve(DATA_DIR, 'registry-facts.json'), JSON.stringify(facts, null, 2), 'utf8')
console.log(`\n写入 docs/asset-atlas/data/registry-facts.json`)
console.log(`字体成功 ${fonts.filter((f) => f.ok).length}/${fonts.length}，包元数据成功 ${packages.filter((p) => p.ok).length}/${packages.length}`)
