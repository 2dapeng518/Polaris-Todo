// 上一轮 404 的包名核对：用 npm search API 找真实包名，再取 latest 的 license。
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(HERE, '..', 'data')
await mkdir(DATA_DIR, { recursive: true })

const QUERIES = [
  'maple-mono', 'commit-mono', 'mingcute', 'lxgw-wenkai', 'lxgw wenkai',
  'sarasa-gothic', 'source-han-sans', 'glow-sans', 'chiron-hei', 'misans',
  'harmonyos-sans', 'alibaba-puhuiti', 'smiley-sans', 'iosevka', 'cascadia-code',
  'solar icons', 'heroicons', 'radix-icons', 'untitled-ui-icons', 'hugeicons'
]

const out = []
for (const q of QUERIES) {
  try {
    const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=8`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const hits = (json.objects ?? []).map((o) => ({
      name: o.package.name,
      version: o.package.version,
      description: (o.package.description ?? '').slice(0, 120),
      links: o.package.links?.repository ?? o.package.links?.npm ?? ''
    }))
    out.push({ query: q, ok: true, hits })
    console.log(`\n## ${q}`)
    for (const h of hits) console.log(`  ${h.name}@${h.version}  ${h.description}`)
  } catch (err) {
    out.push({ query: q, ok: false, error: String(err.message ?? err) })
    console.log(`\n## ${q}  ✗ ${err.message}`)
  }
}

// 对确认存在的候选取权威 license 字段
const CONFIRM = [
  '@fontsource-variable/manrope',
  '@fontsource/commit-mono',
  '@fontsource-variable/iosevka',
  '@fontsource/cascadia-code',
  '@fontsource/lxgw-wenkai',
  'lxgw-wenkai-webfont',
  'lxgw-wenkai-lite-webfont',
  'lxgw-wenkai-screen-webfont',
  'misans',
  '@radix-ui/react-icons',
  '@untitled-ui/icons-react',
  '@hugeicons/react',
  '@hugeicons/core-free-icons',
  'mingcute_icon',
  '@mingcute/icons'
]
const licenses = []
for (const pkg of CONFIRM) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const m = await res.json()
    const rec = {
      pkg, ok: true, version: m.version, license: m.license ?? '(未声明)',
      homepage: m.homepage ?? '', unpackedSize: m.dist?.unpackedSize ?? null,
      repository: typeof m.repository === 'string' ? m.repository : (m.repository?.url ?? '')
    }
    licenses.push(rec)
    console.log(`  ✓ ${pkg.padEnd(34)} ${String(rec.license).padEnd(18)} ${rec.version}  unpacked=${rec.unpackedSize}`)
  } catch (err) {
    licenses.push({ pkg, ok: false, error: String(err.message ?? err) })
    console.log(`  ✗ ${pkg.padEnd(34)} ${err.message}`)
  }
}

await writeFile(resolve(DATA_DIR, 'name-probe.json'), JSON.stringify({ searches: out, licenses }, null, 2), 'utf8')
console.log('\n写入 docs/asset-atlas/data/name-probe.json')
