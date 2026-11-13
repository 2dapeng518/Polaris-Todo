// 把抓来的事实（data/*.json）与人工策划内容（curated.mjs）合成 atlas-data.js。
// 页面用普通 <script> 加载它，因此 file:// 直接双击也能跑（fetch JSON 会被 CORS 挡）。
//
// 用法：node docs/asset-atlas/tools/build-data.mjs

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT, THEMES, MOTION, EFFECTS, REFERENCE_ASSETS, INTEGRATION, PHASES, COMPLIANCE } from './curated.mjs'
import { FONT_FACTS, ICON_FACTS, OVERTURNED, NEW_ASSETS, COMPLIANCE_OVERRIDE, INTEGRATION_EXTRA, NO_ASSET_CONCLUSIONS } from './verified.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = resolve(ROOT, 'data')

async function readJson(name) {
  try {
    return JSON.parse(await readFile(resolve(DATA, name), 'utf8'))
  } catch {
    return null
  }
}

const registry = (await readJson('registry-facts.json')) ?? { fonts: [], packages: [] }
const icons = (await readJson('icon-collections.json')) ?? { semantics: {}, collections: [], pairs: {} }
const probe = (await readJson('name-probe.json')) ?? { licenses: [] }
const cjk = (await readJson('cjk-facts.json')) ?? { sample: '', fonts: [] }

const pkgBy = new Map(registry.packages.filter((p) => p.ok).map((p) => [p.pkg, p]))
const probeBy = new Map(probe.licenses.filter((p) => p.ok).map((p) => [p.pkg, p]))

// ── 图标库 ──────────────────────────────────────────────────────────────────
// 许可证优先用 Iconify 上游登记表（素材本体），npm 字段作为交叉印证。
const ICON_VERDICT = {
  lucide: { fit: 9.4, verdict: 'keep', note: '现有选择就是对的。真描边、CSS 可调粗细、ISC 许可干净、tree-shake 友好。' },
  tabler: { fit: 8.6, verdict: 'alternative', note: '6545 个图标，覆盖面最广，真描边 2px。风格比 Lucide 略硬，适合作为补集。' },
  ph: { fit: 8.2, verdict: 'consider', note: '六种字重是独有优势：未完成用 regular、完成用 fill，状态区分不靠颜色。但线性风格是填充轮廓，CSS 改不了粗细。' },
  iconoir: { fit: 7.8, verdict: 'alternative', note: '1.5px 描边更接近 Polaris 现在的 1.75 覆写值，气质安静。图标总数偏少。' },
  mingcute: { fit: 7.2, verdict: 'consider', note: '线/面成对，中文产品语义覆盖好，Apache-2.0。同样是填充轮廓，粗细不可调。' },
  heroicons: { fit: 6.8, verdict: 'alternative', note: 'Tailwind 团队出品，MIT。24 网格 1.5px 描边，但图标数量少，中文工具类语义缺口大。' },
  solar: { fit: 6.6, verdict: 'consider', risk: 'attribution-required', note: '上游登记为 CC-BY-4.0：是开源，但**必须署名**。注意 npm 上的 solar-icons@0.0.15 根本没有 license 字段——要用就直接取上游 SVG 并在 NOTICE 署名，别依赖那个包。' },
  ri: { fit: 5.2, verdict: 'avoid', risk: 'unclear', note: '许可冲突：Iconify 上游登记表写 Apache-2.0，官方 @remixicon/react@4.9.0 的 npm license 字段却写 "Remix Icon License 1.0"。两处不一致，说明上游登记可能滞后于 v4 的改协议。用之前必须向官方确认。' },
  'radix-icons': { fit: 6.0, verdict: 'alternative', note: '15×15 网格是为紧凑 UI 设计的，小尺寸清晰。但只有 332 枚，且网格与现有 24 体系不一致，混用会错位。' },
  uiw: { fit: 3.6, verdict: 'avoid', displayName: 'uiw icons', note: '本轮核实：uiw 是独立的社区图标集（仅 214 枚），**不是 Untitled UI**。我最初把它当作 Untitled UI 的镜像是错的。要 Untitled UI 请用官方 @untitled-ui/icons-react（MIT，已核实）。' }
}

const iconLibs = icons.collections.map((col) => {
  const npmFact = pkgBy.get(col.npm) ?? null
  const base = ICON_VERDICT[col.prefix] ?? { fit: 5, verdict: 'consider', note: '' }
  // 对抗式核验的结论覆盖初版判断
  const v = { ...base, ...(ICON_FACTS[col.prefix] ?? {}) }
  const upstream = col.license ?? null
  return {
    prefix: col.prefix,
    name: v.displayName ?? col.name,
    site: col.site,
    npm: col.npm,
    npmVersion: npmFact?.version ?? probeBy.get(col.npm)?.version ?? '',
    npmLicense: npmFact?.license ?? probeBy.get(col.npm)?.license ?? '(未取得)',
    upstreamLicense: upstream?.spdx ?? upstream?.title ?? '(未取得)',
    upstreamLicenseUrl: upstream?.url ?? '',
    author: col.author?.name ?? '',
    total: col.total ?? null,
    strokeBased: col.strokeBased,
    defaultStroke: col.defaultStroke,
    grid: col.grid,
    gridWidth: col.gridWidth ?? col.grid,
    gridHeight: col.gridHeight ?? col.grid,
    icons: col.icons ?? {},
    extra: col.extra ?? {},
    fit: v.fit,
    verdict: v.verdict,
    risk: v.risk ?? (v.verdict === 'avoid' ? 'unclear' : 'none'),
    note: v.note,
    verifiedExtra: v.extra ?? null,
    verifiedEvidence: v.evidence ?? ''
  }
})

const iconPairs = icons.pairs ?? {}
const semantics = icons.semantics ?? {}

// ── 字体 ────────────────────────────────────────────────────────────────────
const FONT_VERDICT = {
  manrope: { fit: 9.2, verdict: 'keep', note: '现有展示字体。几何无衬线、字面率大，与 Inter 混排基线接近。没有换的理由。' },
  inter: { fit: 9.4, verdict: 'keep', note: '现有 UI 字体。小字号屏显是同类最优之一，tnum 完整。没有换的理由。' },
  'geist-mono': { fit: 8.4, verdict: 'keep', note: '现有等宽。数字锐利、体积小（23 KB latin）。唯一缺口是没有 CJK 字形，年/月要回退。' },
  geist: { fit: 8.0, verdict: 'consider', note: '与 Geist Mono 同族，换成它能让 UI 与数字同源。但字形气质比 Inter 更冷，与暖瓷昼白略有张力。' },
  'jetbrains-mono': { fit: 8.6, verdict: 'consider', note: '0/O、1/l/I 区分度是本轮最好的之一，可变字重。40 KB 比 Geist Mono 大 74%。' },
  'commit-mono': { fit: 7.6, verdict: 'consider', note: '自动等宽间距设计，数字极清晰。非可变，48 KB。' },
  'ibm-plex-mono': { fit: 7.4, verdict: 'consider', note: '14.7 KB 是本轮最小的等宽，气质克制。非可变，字重需分别加载。' },
  'source-code-pro': { fit: 7.2, verdict: 'consider', note: '可变、22 KB，Adobe 出品，屏显成熟。个性弱于 JetBrains Mono。' },
  'martian-mono': { fit: 5.8, verdict: 'avoid', note: '宽体等宽，展示性强。用在密集任务行的时间戳上会挤占宽度。' },
  'cascadia-code': { fit: 7.0, verdict: 'consider', note: 'Windows 自带血统，OFL。非可变，29 KB。与系统观感一致但个性不足。' },
  iosevka: { fit: 5.4, verdict: 'avoid', note: '984 KB —— 本轮最大，是 Geist Mono 的 42 倍。窄体设计不适合中文混排。' },
  'roboto-mono': { fit: 6.4, verdict: 'avoid', note: '过于常见，缺乏辨识度，且字形偏旧。' },
  'plus-jakarta-sans': { fit: 7.4, verdict: 'consider', note: '几何感强于 Manrope，展示位可用。但正文小字号不如 Inter。' },
  figtree: { fit: 7.8, verdict: 'consider', note: '20 KB 是本轮最小的 UI 候选，字腔开阔，小字号友好。与 Inter 差异不大，换的收益有限。' },
  'instrument-sans': { fit: 7.0, verdict: 'consider', note: '字形略带工业感，展示位有个性。正文密度不如 Inter。' },
  'public-sans': { fit: 7.2, verdict: 'consider', note: '美国政府设计系统出品，中性、可读性优先。个性弱，适合极致克制。' },
  'space-grotesk': { fit: 6.6, verdict: 'avoid', note: '展示个性强，但数字与标点造型夸张，不适合待办应用的密集信息。' },
  sora: { fit: 6.8, verdict: 'avoid', note: '几何展示体，33 KB。正文小字号偏硬。' },
  outfit: { fit: 6.4, verdict: 'avoid', note: '几何圆体，气质偏消费级，与「精密桌面工具」不符。' },
  'bricolage-grotesque': { fit: 6.0, verdict: 'avoid', note: '有 opsz 轴、个性鲜明，但造型活泼，违反 Polaris 的安静原则。' },
  'inter-tight': { fit: 7.6, verdict: 'consider', note: 'Inter 的紧排版本，适合展示位。若嫌 Manrope 太圆可以考虑，但没必要引入第五套字体。' },
  geologica: { fit: 6.6, verdict: 'avoid', note: '有 wdth 轴，展示性强。中文混排时字面率差异明显。' },
  'ibm-plex-sans': { fit: 7.4, verdict: 'consider', note: '人本主义无衬线，气质温和，与暖砂/昼白很搭。非可变是主要缺点。' }
}

const fonts = registry.fonts.filter((f) => f.ok).map((f) => {
  const v = { ...(FONT_VERDICT[f.id] ?? { fit: 6, verdict: 'consider', note: '' }), ...(FONT_FACTS[f.id] ?? {}) }
  return {
    id: f.id,
    pkg: f.pkg,
    version: f.version,
    license: f.license,
    family: f.family,
    weightRange: f.faceWeight || f.weightRange,
    packageWeightRange: f.weightRange,
    isVariableFace: f.isVariableFace ?? f.pkg.includes('-variable'),
    faceCount: f.faceCount,
    localFile: f.localFile,
    bytes: f.bytes,
    sourceUrl: f.sourceUrl,
    cssUrl: f.cssUrl,
    unicodeRange: f.unicodeRange,
    unpackedSize: f.unpackedSize,
    repository: f.repository,
    homepage: f.homepage,
    role: f.role,
    use: f.use,
    variable: f.pkg.includes('-variable'),
    fit: v.fit,
    verdict: v.verdict,
    note: v.note,
    verifiedEvidence: v.evidence ?? ''
  }
})

// ── 中文字体（按需分片，真实下载） ──────────────────────────────────────────
const CJK_VERDICT = {
  'noto-sans-sc': { fit: 9.0, verdict: 'keep', note: '现有中文字体。实测：覆盖图鉴全部 332 个试排汉字只需 19 个分片、约 1.0 MB，是本轮分片效率最好的。' },
  'chiron-hei-hk': { fit: 6.2, verdict: 'avoid', note: '实测：同样覆盖 332 字需要 45 个分片、约 10.0 MB —— 是 Noto Sans SC 的 9.6 倍。它的 unicode-range 切分方式与常用字分布不匹配，离线打包代价过高。已测量但不随预览页分发。' },
  'noto-serif-sc': { fit: 4.4, verdict: 'avoid', note: '衬线中文，仅作对照。Polaris 全站无衬线，引入会破坏一致性。分片效率与 Noto Sans SC 相当（19 片 / 1.4 MB）。' }
}

const cjkFonts = cjk.fonts.map((f) => {
  const v = CJK_VERDICT[f.id] ?? { fit: 6, verdict: 'consider', note: '' }
  return {
    id: f.id,
    label: f.label,
    pkg: f.pkg,
    version: f.version,
    license: f.license,
    family: f.family,
    role: f.role,
    shipped: f.shipped,
    shippedNote: f.shippedNote ?? '',
    bytes: f.bytes,
    // 未分发的那套也要保留实测分片数——清空文件不等于没测过。
    shardCount: f.shipped ? f.shards.filter((s) => s.ok).length : (f.measuredShards ?? 0),
    totalShards: f.totalShards,
    coveredCount: f.coveredCount,
    requestedCount: f.requestedCount,
    unpackedSize: f.unpackedSize,
    cssUrl: f.cssUrl,
    repository: f.repository,
    homepage: f.homepage,
    shards: f.shards.filter((s) => s.ok),
    fit: v.fit,
    verdict: v.verdict,
    note: v.note
  }
})

// ── 代码包（动效 / 工具） ────────────────────────────────────────────────────
const CODE_VERDICT = {
  motion: { cat: '动画', fit: 9.4, verdict: 'keep', use: '已在用。列表、浮层、chip 的全部动效都由它承担。', risk: 'none' },
  '@formkit/auto-animate': { cat: '动画', fit: 6.0, verdict: 'avoid', use: '一行给容器加增删动画，但与已有的 motion 能力重复。', risk: 'none' },
  animejs: { cat: '动画', fit: 6.4, verdict: 'avoid', use: '轻量时间轴库。Polaris 的动效都是状态驱动，用不上时间轴。', risk: 'none' },
  gsap: { cat: '动画', fit: 3.0, verdict: 'avoid', use: '能力远超需求，且不是开源许可。', risk: 'custom-eula' },
  'lottie-web': { cat: '动画', fit: 4.0, verdict: 'avoid', use: '播放器本身 MIT，但素材许可逐个不同，且典型用法是循环播放，违反设计约束。', risk: 'unclear' },
  '@lottiefiles/dotlottie-web': { cat: '动画', fit: 4.2, verdict: 'avoid', use: '比 lottie-web 小，但带 WASM 运行时，离线打包复杂度上升。', risk: 'unclear' },
  '@rive-app/react-canvas': { cat: '动画', fit: 3.4, verdict: 'avoid', use: 'Canvas 运行时 + 编辑器生态，对本地待办应用是过度工程。', risk: 'none' },
  'animate.css': { cat: '动画', fit: 5.0, verdict: 'avoid', use: '预置类名动画库，多为装饰性入场，与「动效只做确认」冲突。', risk: 'none' },
  'tw-animate-css': { cat: '动画', fit: 6.6, verdict: 'consider', use: 'Tailwind v4 原生动画工具类，零 JS。若只想补几个 keyframes 可以考虑。', risk: 'none' },
  '@paper-design/shaders-react': { cat: '特效', fit: 3.6, verdict: 'avoid', use: 'WebGL 着色器背景。持续动画 + GPU 开销，直接违反 Polaris 约束。', risk: 'none' },
  '@iconify/react': { cat: '图标', fit: 6.8, verdict: 'consider', use: '运行时按需拉图标 —— 但 Polaris 离线，必须配本地图标集，否则断网即失效。', risk: 'none' },
  '@iconify/json': { cat: '图标', fit: 7.4, verdict: 'consider', use: '全量图标集数据，配合 unplugin-icons 在构建期取用，产物零运行时。', risk: 'none' },
  'unplugin-icons': { cat: '图标', fit: 8.2, verdict: 'consider', use: '构建期把任意图标集的图标编译成组件，tree-shake 干净，无运行时依赖。', risk: 'none' },
  'cn-font-split': { cat: '工具', fit: 9.0, verdict: 'adopt', use: '中文字体按 unicode-range 切片，是压住安装包体积的关键工具。', risk: 'none' },
  svgo: { cat: '工具', fit: 8.6, verdict: 'adopt', use: '压缩第三方 SVG 素材，去掉冗余属性与内联样式，便于用 currentColor 接管颜色。', risk: 'none' },
  '@fontsource-variable/noto-sans-sc': { cat: '字体', fit: 9.0, verdict: 'keep', use: '现有中文字体。OFL-1.1，字形覆盖完整，切片后可控。', risk: 'none' },
  '@fontsource-variable/noto-serif-sc': { cat: '字体', fit: 5.0, verdict: 'avoid', use: '衬线中文。Polaris 全站无衬线，引入会破坏一致性。', risk: 'none' },
  '@phosphor-icons/react': { cat: '图标', fit: 8.2, verdict: 'consider', use: '六字重可表达状态，MIT。', risk: 'none' },
  '@tabler/icons-react': { cat: '图标', fit: 8.6, verdict: 'alternative', use: '覆盖面最广的真描边库，MIT。', risk: 'none' },
  '@heroicons/react': { cat: '图标', fit: 6.8, verdict: 'alternative', use: 'MIT，但图标数量少。', risk: 'none' },
  'iconoir-react': { cat: '图标', fit: 7.8, verdict: 'alternative', use: '1.5px 描边，气质安静，MIT。', risk: 'none' },
  '@remixicon/react': { cat: '图标', fit: 4.6, verdict: 'avoid', use: '许可字段是自定义 Remix Icon License 1.0。', risk: 'unclear' },
  'solar-icons': { cat: '图标', fit: 5.0, verdict: 'avoid', use: 'npm 未声明许可证。', risk: 'unclear' },
  'lucide-react': { cat: '图标', fit: 9.4, verdict: 'keep', use: '现有图标库，ISC 许可。', risk: 'none' }
}

const codePackages = registry.packages.filter((p) => p.ok).map((p) => {
  const v = CODE_VERDICT[p.pkg] ?? { cat: '工具', fit: 5, verdict: 'consider', use: '', risk: 'none' }
  return { ...p, category: v.cat, fit: v.fit, verdict: v.verdict, use: v.use, risk: v.risk }
})

// ── 主清单 ──────────────────────────────────────────────────────────────────
const manifest = []

for (const lib of iconLibs) {
  manifest.push({
    id: `icon-${lib.prefix}`,
    category: '图标',
    name: lib.name,
    preview: lib.site,
    license: lib.upstreamLicense !== '(未取得)' ? lib.upstreamLicense : lib.npmLicense,
    licenseSource: lib.upstreamLicense !== '(未取得)' ? 'Iconify 上游登记表' : 'npm registry',
    licenseUrl: lib.upstreamLicenseUrl || lib.repository || lib.site,
    npmLicense: lib.npmLicense,
    version: lib.npmVersion,
    use: lib.note,
    integration: lib.npm.startsWith('(') ? '需先确认许可' : `npm i ${lib.npm}`,
    fit: lib.fit,
    verdict: lib.verdict,
    risk: lib.risk,
    detail: { kind: 'icon', prefix: lib.prefix }
  })
}

for (const f of fonts) {
  manifest.push({
    id: `font-${f.id}`,
    category: f.use.includes('mono') ? '等宽字体' : (f.role === 'current' ? '现有字体' : '西文字体'),
    name: f.family || f.id,
    preview: f.homepage || f.repository || f.cssUrl,
    license: f.license,
    licenseSource: 'npm registry',
    licenseUrl: f.repository || f.homepage || f.cssUrl,
    version: f.version,
    size: f.bytes,
    use: f.note,
    integration: `npm i ${f.pkg}`,
    fit: f.fit,
    verdict: f.verdict,
    risk: 'none',
    detail: { kind: 'font', id: f.id }
  })
}

for (const f of cjkFonts) {
  manifest.push({
    id: `cjk-${f.id}`,
    category: '中文字体',
    name: f.label,
    preview: f.homepage || f.repository || f.cssUrl,
    license: f.license,
    licenseSource: 'npm registry',
    licenseUrl: f.repository || f.cssUrl,
    version: f.version,
    size: f.bytes,
    use: f.note,
    integration: `npm i ${f.pkg}`,
    fit: f.fit,
    verdict: f.verdict,
    risk: 'none',
    detail: { kind: 'cjk', id: f.id }
  })
}

for (const p of codePackages) {
  manifest.push({
    id: `pkg-${p.pkg}`,
    category: p.category,
    name: p.pkg,
    preview: p.homepage || p.repository || `https://www.npmjs.com/package/${p.pkg}`,
    license: p.license,
    licenseSource: 'npm registry',
    licenseUrl: p.homepage || p.repository || `https://www.npmjs.com/package/${p.pkg}`,
    version: p.version,
    use: p.use,
    integration: p.verdict === 'avoid' ? '不建议引入' : `npm i ${p.pkg}`,
    fit: p.fit,
    verdict: p.verdict,
    risk: p.risk,
    detail: { kind: 'pkg', pkg: p.pkg }
  })
}

for (const m of MOTION) {
  manifest.push({
    id: `motion-${m.id}`,
    category: '动效配方',
    name: m.name,
    preview: '',
    license: m.library.includes('纯') || m.library.includes('原生') ? '自绘 · 无外部许可' : '随所用库',
    licenseSource: '本地配方',
    licenseUrl: '',
    use: m.why,
    integration: m.target,
    fit: m.id === 'auto-animate' ? 6.0 : 9.0,
    verdict: m.id === 'auto-animate' ? 'alternative' : 'adopt',
    risk: 'none',
    detail: { kind: 'motion', id: m.id }
  })
}

for (const e of EFFECTS) {
  manifest.push({
    id: `effect-${e.id}`,
    category: '特效配方',
    name: e.name,
    preview: '',
    license: e.license,
    licenseSource: '本地配方',
    licenseUrl: '',
    use: e.why,
    integration: e.mapping,
    fit: 9.0,
    verdict: 'adopt',
    risk: 'none',
    detail: { kind: 'effect', id: e.id }
  })
}

for (const r of REFERENCE_ASSETS) {
  manifest.push({
    id: `ref-${r.id}`,
    category: r.category,
    name: r.name,
    preview: r.preview,
    license: r.licenseHint,
    licenseSource: '站点声明（本轮未逐条抓取原文）',
    licenseUrl: r.licenseUrl,
    use: r.use,
    integration: r.integration,
    fit: r.status === 'not-recommended' ? 3.0 : 6.0,
    verdict: r.status === 'not-recommended' ? 'avoid' : 'alternative',
    risk: r.status === 'unverified' ? 'unclear' : (r.id === 'hero-patterns' ? 'attribution-required' : 'none'),
    detail: { kind: 'ref', id: r.id }
  })
}

// 核验新增的素材条目
for (const a of NEW_ASSETS) manifest.push({ ...a })

manifest.sort((a, b) => b.fit - a.fit)

// 合规：核验结论优先，同 topic 覆盖，新增追加
const compliance = [...COMPLIANCE]
for (const c of COMPLIANCE_OVERRIDE) {
  const i = compliance.findIndex((x) => x.topic === c.topic)
  if (i >= 0) compliance[i] = c
  else compliance.unshift(c)
}

const integration = [...INTEGRATION, ...INTEGRATION_EXTRA]

const stats = {
  total: manifest.length,
  fontsDownloaded: fonts.length + cjkFonts.filter((f) => f.shipped).length,
  fontBytes: fonts.reduce((s, f) => s + f.bytes, 0) + cjkFonts.filter((f) => f.shipped).reduce((s, f) => s + f.bytes, 0),
  cjkShards: cjkFonts.reduce((s, f) => s + f.shardCount, 0),
  iconLibs: iconLibs.length,
  iconsFetched: iconLibs.reduce((s, l) => s + Object.values(l.icons).filter(Boolean).length + Object.keys(l.extra ?? {}).length, 0),
  motionRecipes: MOTION.length,
  effectRecipes: EFFECTS.length,
  verifiedByRegistry: registry.packages.filter((p) => p.ok).length + fonts.length,
  avoid: manifest.filter((m) => m.verdict === 'avoid').length,
  overturned: OVERTURNED.length,
  researchAgents: 19
}

const payload = {
  generatedFrom: ['data/registry-facts.json', 'data/icon-collections.json', 'data/name-probe.json', 'tools/curated.mjs'],
  project: PROJECT,
  themes: THEMES,
  semantics,
  iconLibs,
  iconPairs,
  fonts,
  cjkFonts,
  cjkSample: cjk.sample,
  codePackages,
  motion: MOTION,
  effects: EFFECTS,
  referenceAssets: REFERENCE_ASSETS,
  integration,
  phases: PHASES,
  compliance,
  overturned: OVERTURNED,
  noAssetConclusions: NO_ASSET_CONCLUSIONS,
  manifest,
  stats
}

const banner = '// 由 tools/build-data.mjs 生成，请勿手改。事实字段来自 npm registry / Iconify 上游登记表。\n'
await writeFile(resolve(ROOT, 'atlas-data.js'), banner + 'window.ATLAS = ' + JSON.stringify(payload, null, 2) + '\n', 'utf8')

console.log(`atlas-data.js 已生成`)
console.log(`  清单 ${stats.total} 条 · 字体 ${stats.fontsDownloaded} 套（${(stats.fontBytes / 1024).toFixed(0)} KB）`)
console.log(`  图标库 ${stats.iconLibs} 个 · 真实 SVG ${stats.iconsFetched} 枚`)
console.log(`  动效配方 ${stats.motionRecipes} · 特效配方 ${stats.effectRecipes} · 建议避开 ${stats.avoid} 条`)
