// 从与图鉴页同一份数据生成交付文档，避免「网页一套说法、文档另一套」。
// 用法：node docs/asset-atlas/tools/export-docs.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REPO = resolve(ROOT, '..', '..')

const src = await readFile(resolve(ROOT, 'atlas-data.js'), 'utf8')
const sandbox = {}
new Function('window', src)(sandbox)
const A = sandbox.ATLAS

const VERDICT = { keep: '保留现状', adopt: '建议采纳', consider: '值得考虑', alternative: '备选', avoid: '建议避开' }
const RISK = { none: '无', 'attribution-required': '需署名', 'custom-eula': '自定义协议', unclear: '存疑' }
const kb = (n) => (n / 1024).toFixed(n < 102400 ? 1 : 0) + ' KB'
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')

const L = []
const push = (...x) => L.push(...x)

push('# Polaris 开源素材交付清单', '')
push('> 面向 Polaris v' + A.project.version + '（' + A.project.stack + '）。',
  '> 本文与 `docs/asset-atlas/` 的可交互图鉴同源生成，事实字段来自 npm registry、Iconify 上游登记表与实际下载测量。', '')

push('## 一、结论先行', '')
push('1. **图标与字体保持现状。** Lucide（ISC）+ Inter / Manrope / Geist Mono / Noto Sans SC（均 OFL-1.1）这套组合已经成立。' +
  '本轮把 10 个图标库、23 套拉丁字体、3 套中文字体放在一起实测对比，没有找到「换了明显更好」的理由。')
push('2. **真正该补的是合规与体积，不是素材。** 仓库目前没有 NOTICE 文件，而四套 OFL 字体与 Lucide 已经在随 NSIS 安装包再分发；' +
  '中文字体未子集化，是安装包体积的最大头。这两件事的收益远大于换任何一套素材。')
push('3. **动效自己写就够了。** 本文 ' + A.motion.length + ' 个动效配方里有 7 个是 0 KB 的纯 CSS/SVG。' +
  'GSAP / Lottie / Rive 都会带来许可或体积问题，且它们的典型用法（循环播放）直接违反 Polaris「动效只做确认不做装饰」的硬约束。')
push('4. **许可陷阱比想象的多，而且「免费商用」完全不等于开源。** 经 ' + A.stats.researchAgents + ' 个 agent 两轮对抗式核验：' +
  'MiSans 的 EULA 授权动词只有 `use`、明文禁止再分发，**不能进安装包**；' +
  'HarmonyOS Sans 反而允许原样嵌入但**禁止任何修改**（子集化这条路封死）且许可可撤销；' +
  'Remix Icon 的上游登记与 npm 声明冲突；Solar 是 CC-BY-4.0 必须署名；' +
  'Tabbied 的 MIT 只在子目录、根 LICENSE 是 All rights reserved。详见第六章的推翻记录。', '')
push('5. **有两类素材压根没有可采纳的开源件。** 装饰性特效与一次性确认动画，在「安静表面 + 禁持续循环」的硬约束下' +
  '不存在合适的第三方开源素材。本文这两类的配方**全部是自绘或浏览器内置**，零第三方分发物、零许可义务。' +
  '这是结论，不是遗漏——详见第七章。', '')

push('## 二、本轮实际做了什么', '')
push('| 动作 | 结果 |', '|---|---|')
push('| 下载拉丁可变字体 woff2 | ' + A.fonts.length + ' 套，' + kb(A.fonts.reduce((s, f) => s + f.bytes, 0)) + '（latin 分片实测） |')
const shipped = A.cjkFonts.filter((f) => f.shipped)
push('| 下载中文按需分片 | ' + shipped.length + ' 套 / ' + shipped.reduce((s, f) => s + f.shardCount, 0) + ' 片，' +
  kb(shipped.reduce((s, f) => s + f.bytes, 0)) + '，覆盖图鉴全部 ' + (A.cjkFonts[0]?.requestedCount ?? 0) + ' 个试排汉字 |')
push('| 抓取真实图标 SVG | ' + A.stats.iconsFetched + ' 枚，来自 Iconify 官方 API（未经改写） |')
push('| 核验许可证 | ' + A.stats.verifiedByRegistry + ' 条来自 npm registry 机器可读字段 + Iconify 上游登记表 |')
push('| 可运行配方 | 动效 ' + A.motion.length + ' 个 + 特效 ' + A.effects.length + ' 个，全部在图鉴页可交互 |')
push('| 建议避开 | ' + A.stats.avoid + ' 条，理由逐条写在清单里 |', '')

push('## 三、交付清单总表', '')
push('按契合度排序。「许可来源」列标明这条许可证是从哪里读到的——不是凭记忆写的。', '')
push('| 类别 | 名称 | 预览 | 许可证 | 许可来源 | 推荐用途 | 集成方式 | 契合度 | 建议 | 风险 |')
push('|---|---|---|---|---|---|---|---|---|---|')
for (const m of A.manifest) {
  push('| ' + [m.category, m.name + (m.version ? ' v' + m.version : ''), m.preview ? '[预览](' + m.preview + ')' : '—',
    m.license, m.licenseSource, m.use, '`' + m.integration + '`', m.fit.toFixed(1), VERDICT[m.verdict], RISK[m.risk]
  ].map(cell).join(' | ') + ' |')
}
push('')

push('## 四、按类别详解', '')

push('### 4.1 图标：真描边 vs 填充轮廓', '')
push('这是选型时最容易踩的坑，也是图鉴页可以直接验证的一条：')
push('')
push('| 图标库 | 网格 | 描边可调 | 上游许可 | npm 声明 | 图标数 | 判断 |')
push('|---|---|---|---|---|---|---|')
for (const l of A.iconLibs) {
  push('| ' + [l.name, l.gridWidth + '×' + l.gridHeight, l.strokeBased ? '✅ 真描边' : '❌ 填充轮廓',
    l.upstreamLicense, l.npmLicense, l.total ?? '?', VERDICT[l.verdict]].map(cell).join(' | ') + ' |')
}
push('')
push('**为什么这条重要**：Polaris 现在用 `.lucide { stroke-width: 1.75 }` 统一描边，勾选与提醒用 2.2。' +
  '这套做法只对**真描边**的库有效。Phosphor、MingCute、Remix、Radix 的「线性」风格实际是填充轮廓路径，' +
  'CSS 改 `stroke-width` 对它们完全无效——要改粗细只能换字重变体（例如 Phosphor 的 thin/light/regular/bold）。' +
  '图鉴页左侧的描边滑块可以现场验证：拖到 2.8，Lucide 与 Solar 明显变粗，Phosphor 纹丝不动。', '')
push('**Phosphor 的真正价值**不在于替换 Lucide，而在于它的六种字重可以表达状态：' +
  '未完成用 regular、完成用 fill，状态区分不依赖颜色——这正好呼应 Polaris「不要只用颜色表达状态」的无障碍要求。' +
  '但代价是引入第二套图标体系，属于 P2。', '')

push('### 4.2 拉丁字体：体积与数字区分度', '')
push('| 字体 | 许可 | 可变轴 | latin 分片 | 整包解包 | 判断 |', '|---|---|---|---|---|---|')
for (const f of A.fonts) {
  push('| ' + [f.family, f.license, f.isVariableFace ? f.weightRange : '非可变 ' + f.weightRange,
    kb(f.bytes), f.unpackedSize ? kb(f.unpackedSize) : '—', VERDICT[f.verdict]].map(cell).join(' | ') + ' |')
}
push('')
push('等宽字体的关键是 `0/O`、`1/l/I` 的区分度与 `tnum`——Polaris 的计数与时间戳全靠它。' +
  'JetBrains Mono 在这一项上最好，但 40 KB 比 Geist Mono 的 23 KB 大 74%。' +
  'Iosevka 984 KB，是 Geist Mono 的 42 倍，直接出局。', '')

push('### 4.3 中文字体：分片效率就是选型依据', '')
push('中文字体不可能整包进安装包。实测同样覆盖图鉴的 ' + (A.cjkFonts[0]?.requestedCount ?? 0) + ' 个汉字：')
push('')
push('| 字体 | 许可 | 命中分片 | 实测体积 | 整包解包 | 是否随预览页分发 |', '|---|---|---|---|---|---|')
for (const f of A.cjkFonts) {
  push('| ' + [f.label, f.license, f.shardCount + ' / ' + f.totalShards, kb(f.bytes),
    f.unpackedSize ? kb(f.unpackedSize) : '—', f.shipped ? '是' : '否（过重）'].map(cell).join(' | ') + ' |')
}
push('')
for (const f of A.cjkFonts) push('- **' + f.label + '**：' + f.note)
push('')
push('子集化用 `cn-font-split`（Apache-2.0）。**注意 OFL 的 Reserved Font Name 条款**：' +
  '子集化属于修改，若原字体声明了 RFN，切片产物必须改名。打包前逐个确认。', '')

push('### 4.4 动效：全部一次性，全部尊重 reduced motion', '')
push('| 配方 | 时长 | 依赖 | 新增体积 | 落点 |', '|---|---|---|---|---|')
for (const m of A.motion) {
  push('| ' + [m.name, m.ms + 'ms', m.library, m.bytes, '`' + m.target + '`'].map(cell).join(' | ') + ' |')
}
push('')
push('Polaris 禁止持续循环的装饰动画，所以图鉴页里每个动效都要点「重播」才动——这不是演示的妥协，' +
  '这正是它们在生产里该有的样子：绑定在真实交互上。', '')

push('### 4.5 特效：零运行时，颜色全走令牌', '')
push('| 配方 | 来源 | 运行时 | 主题映射 |', '|---|---|---|---|')
for (const e of A.effects) {
  push('| ' + [e.name, e.origin, e.runtime, e.mapping].map(cell).join(' | ') + ' |')
}
push('')
push('**一个必须避免的错误**：不要把 teal 写进 SVG 的 `fill`。那样浅色主题就错了。' +
  '正确做法是 SVG 只提供形状，颜色交给 `background-color`，用 `mask` 合成——图鉴页的星点纹理就是这么做的，' +
  '六套主题下自动跟随 `{{SECRET_l4j4xk2x}}`。', '')

push('## 五、主题适配矩阵', '')
push('六套主题的 `{{SECRET_l4j4xk2x}}` 色相一致，只按画布明度微调深浅以保 WCAG AA：')
push('')
push('| 主题 | 家族 | 画布 `--bg` | 信号色 `{{SECRET_l4j4xk2x}}` | 次要点缀 `--accent-2` | 颗粒 | 极光 |')
push('|---|---|---|---|---|---|---|')
for (const t of A.themes) {
  push('| ' + [t.label + ' ' + t.id, t.family, '`' + t.bg + '`', '`' + t.accent + '`', '`' + t.accent2 + '`',
    t.noiseOpacity, t.auroraOpacity].map(cell).join(' | ') + ' |')
}
push('')
push('素材接入方式分三档：')
push('')
push('1. **靠 `currentColor` 自动继承**——所有图标。不需要任何颜色覆盖，六套主题天然成立。')
push('2. **靠 CSS 变量映射**——颗粒（`--noise-opacity`）、极光（`--aurora-opacity` + `--accent-rgb` / `--accent-2-rgb` / `--aurora-c-rgb`）、' +
  '点阵（`--line`）、星点（`mask` + `{{SECRET_l4j4xk2x}}`）。同一份代码，六套主题自动换色。')
push('3. **需要显式覆盖**——第三方插画若带写死色值，必须先用 SVGO 去掉 `fill`，再交给 `currentColor` 或 `mask`。' +
  '这也是本轮不建议引入 unDraw / Storyset 的原因之一。', '')
push('**陷阱**：`--inner-highlight` 在暗色家族是 4.5% 白，在浅色家族是 **90% 白**。' +
  '它只能用在半透明玻璃面上；放到饱和 `{{SECRET_l4j4xk2x}}` 填充上，浅色主题会在顶边生成近白描边，看起来像第二层轮廓。' +
  '图鉴页的特效区有这个缺陷的真实复现。', '')

push('## 六、对抗式核验：推翻了哪些判断', '')
push('初版清单交给 ' + A.stats.researchAgents + ' 个 agent 做了两轮独立核验：一轮逐条抓许可证原文与链接，一轮专门找缺口。')
push('下面是被推翻或被补强的结论，**包括推翻本文初版自己的判断**。留着推翻记录比抹掉它有用。', '')
for (const o of A.overturned ?? []) {
  push('### ' + o.title, '')
  push('- **初版**：~~' + o.before + '~~')
  push('- **核验后**：' + o.after)
  push('- **影响**：' + o.impact)
  push('- **证据**：' + o.evidence, '')
}

push('## 七、哪些类别根本没找到合适的开源素材', '')
push('这是结论，不是遗漏。', '')
for (const n of A.noAssetConclusions ?? []) {
  push('### ' + n.category, '')
  push('**' + n.conclusion + '**', '')
  push(n.why, '')
  push('**替代**：' + n.alternative, '')
  push('> ' + n.honest, '')
}

push('## 八、许可证与合规', '')
push('Polaris 用 electron-builder 打成 NSIS 安装包对外分发，字体、SVG、JSON 全都构成**再分发**。')
push('')
for (const c of A.compliance) {
  push('### ' + c.topic, '')
  push('**' + c.verdict + '**（风险：' + RISK[c.risk] + '）', '')
  push(c.detail, '')
  push('> ' + c.action, '')
}
push('### 本轮发现的许可冲突与陷阱', '')
push('| 素材 | 冲突/陷阱 | 处理 |', '|---|---|---|')
push('| Remix Icon | Iconify 上游登记表写 Apache-2.0，官方 `@remixicon/react@4.9.0` 的 npm license 字段写 "Remix Icon License 1.0" | 两处不一致，用前必须向官方确认；本轮排除 |')
push('| Solar | 上游登记 CC-BY-4.0（需署名），但 npm 包 `solar-icons@0.0.15` **没有 license 字段** | 要用就直接取上游 SVG 并在 NOTICE 署名，不要依赖那个包 |')
push('| MiSans | npm 包 `misans@5.0.0` 标 Apache-2.0，但那只是打包代码的许可，字体本体走小米自定义 EULA | 包许可 ≠ 素材许可；本轮排除 |')
push('| GSAP | npm license 字段原文是 "Standard \'no charge\' license"，2025 年起插件免费但仍非 OSI 开源 | 能力远超需求，本轮排除 |')
push('| Lucide | 常被误认为 MIT，实际是 **ISC** | 两者都是宽松开源许可，不影响使用，但 NOTICE 要写对 |')
push('| uiw | 本轮核实它是独立社区图标集（214 枚），**不是 Untitled UI** | 要 Untitled UI 用官方 `@untitled-ui/icons-react`（MIT） |')
push('')

push('## 九、集成方案', '')
for (const b of A.integration) {
  push('### ' + b.title, '')
  push('落点：`' + b.path + '`', '')
  push(b.note, '')
  push('```' + b.lang, b.code, '```', '')
}

push('## 十、分阶段落地', '')
for (const p of A.phases) {
  push('### ' + p.tier + ' · ' + p.title + '（风险' + p.risk + '）', '')
  p.items.forEach((i) => push('- ' + i))
  push('', '验证：`' + p.verify + '`', '')
}

push('## 十一、被排除的素材与原因', '')
push('| 素材 | 原因 |', '|---|---|')
for (const m of A.manifest.filter((x) => x.verdict === 'avoid')) {
  push('| ' + [m.name, m.use].map(cell).join(' | ') + ' |')
}
push('')
push('### 找不到合适开源选项的类别', '')
push('**插画 / 空状态图形**：本轮没有找到既符合「安静的桌面工具」气质、许可又干净到可以随安装包分发的选项。')
push('unDraw 是自定义许可且禁止再分发素材本身；Storyset 免费需署名且风格偏营销；Open Doodles 是 CC0 许可最干净，' +
  '但手绘涂鸦风格与 Polaris 的精确感冲突。')
push('')
push('**替代建议**：不用插画。用几何 SVG 自绘 + 现有的四角星标记做空状态构图——' +
  '图鉴页的星点亮动效与星点纹理就是这个方向的成品，0 KB、无许可负担、六套主题自动适配。', '')
push('**循环动画素材（Lottie 免费区）**：播放器 `lottie-web` 本身是 MIT，但素材许可逐个不同，' +
  '且免费区绝大多数是循环动画，直接违反设计约束。替代建议就是本文第 4.4 节的 10 个一次性配方。', '')

push('## 十二、未验证 / 存疑项', '')
push('诚实列出本轮没能确认的：', '')
push('- **Haikei**：生成器免费，但产出物的许可条款本轮未抓到原文，标记为未验证，不要当作 CC0 使用。')
push('- **Hero Patterns**： commonly 引用为 CC BY 4.0（图案）/ MIT（站点代码），本轮未逐条抓取原文；若要用，署名义务按 CC BY 处理。')
push('- **部分素材站点不可达**：phosphoricons.com、tabler.io/icons 等在抓取时连接失败，' +
  '许可证结论改由 GitHub 仓库与 Iconify 上游登记表交叉印证，不影响许可结论，但官网预览链接可能需要在你的网络环境下重试。')
push('- **Iconify API 限流**：抓取过程中多次 429，Radix 的部分语义与 Tabler 的计数未二次复核。')
push('- **中文分片覆盖范围**：只覆盖图鉴用到的 ' + (A.cjkFonts[0]?.requestedCount ?? 0) + ' 个汉字，超出范围回退系统字体。' +
  '这是 unicode-range 的正常行为，不是缺陷，但生产环境要按实际文案重新切片。', '')

push('---', '')
push('本文与图鉴页同源。重新生成：', '')
push('```bash', 'node docs/asset-atlas/tools/build-data.mjs', 'node docs/asset-atlas/tools/export-docs.mjs', '```', '')
push('打开可交互图鉴：', '')
push('```bash', 'node docs/asset-atlas/tools/serve.mjs', '```')

const out = resolve(REPO, 'docs', '开源素材清单.md')
await writeFile(out, L.join('\n'), 'utf8')
console.log('写入 docs/开源素材清单.md（' + L.length + ' 行，' + (L.join('\n').length / 1024).toFixed(1) + ' KB）')
