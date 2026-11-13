// 后台 19 个 agent 的对抗式核验结论（7 类调研 → 7 类核验 → 合规复核 + 集成 → 合成 → 完整性批判 → 补漏）。
// 这里只放「核验推翻或补强了什么」，每条都带证据来源。原始记录在 data/research/。
//
// 重要：其中数条推翻了本图鉴初版的判断，如实保留推翻记录，不抹掉。

// ── 对已有条目的事实修正 ────────────────────────────────────────────────────
export const FONT_FACTS = {
  'public-sans': {
    verdict: 'avoid', fit: 5.4,
    note: '核验升级排除理由：上游 README 原文 "Public Sans as a font is not currently being actively developed or maintained." —— 不只是可变版实验性，**整个字体已停止开发维护**。另外实测 winAscent/winDescent 合计 1.405em，行高偏高。',
    evidence: '核验:latin-fonts — 上游 README 原文'
  },
  outfit: {
    verdict: 'avoid', fit: 5.2,
    note: '核验补硬证据：Outfitio/Outfit-Fonts 已于 **2025-02-25 被作者归档**，仓库 read-only，上游无后续维护。初版只按 x-height 0.460em 与默认 wght 100 排除，理由不够硬。',
    evidence: '核验:latin-fonts — GitHub 仓库归档状态'
  },
  geologica: {
    verdict: 'avoid', fit: 5.0,
    note: '核验补硬证据：仓库横幅写 **2026-04-19 归档**。初版引用的 2023-04-13 是「最后推送」不是归档时间，两者不能混写；该推送日期本轮因 GitHub API 限流未能复核。',
    evidence: '核验:latin-fonts — 仓库归档横幅'
  },
  'plus-jakarta-sans': {
    verdict: 'consider', fit: 6.8,
    note: '核验补一个比 Public Sans 更严重的行高坑：实测 upem 1000、winAscent 1296 / winDescent 356，合计 **1.652em，是本轮 12 款里最高的**。任何紧凑 line-height 都会裁切。几何感强于 Manrope，但这个代价值得掂量。',
    evidence: '核验:latin-fonts — 二进制字段实测'
  },
  'instrument-sans': {
    verdict: 'consider', fit: 6.4,
    note: '核验推翻一条卖点：初版称它是「唯一带 wdth 75–100 宽度轴的候选」——**不成立**，IBM Plex Sans 同样有 wdth 75–100（已二进制复核）。宽度轴不是独占优势，评分随之下调。',
    evidence: '核验:latin-fonts — 二进制轴表复核'
  },
  geist: {
    verdict: 'consider', fit: 8.0,
    note: '核验修正包结构：初版说「该包只有 index.css，无 wght.css」不成立。unpkg ?meta 实测 @fontsource-variable/geist@5.3.0 有 **三个入口**：/index.css、/wght.css、/wght-italic.css，包内**有 italic**。与 Geist Mono 同族，换成它能让 UI 与数字同源。',
    evidence: '核验:latin-fonts — unpkg ?meta 实测'
  },
  'bricolage-grotesque': {
    verdict: 'avoid', fit: 5.6,
    note: '核验修正引文：初版引用的作者自述 "I forked the font and worked to make it fully display-oriented." 在仓库 README 里**根本不存在**（raw README 3,776 B 逐字检索，全文无 display 一词）。实际句子是 "It started as a fork of Mayenne…"。造型活泼违反安静原则的结论不变，但引文是错的。',
    evidence: '核验:latin-fonts — raw README 逐字检索'
  },
  'ibm-plex-sans': {
    verdict: 'consider', fit: 7.4,
    note: '核验修正可达性：初版写「ibm.com/plex 本机实测不可达」，复核为 **HTTP 200**。用仓库当主页可以，但理由要改成「仓库是许可证与源文件的权威位置」，不能写官网打不开。另确认它也有 wdth 75–100 轴。',
    evidence: '核验:latin-fonts — HTTP 复核'
  }
}

export const ICON_FACTS = {
  ph: {
    fit: 9.0,
    note: '核验补三条独有事实：① 1512 基形 × 6 字重 = 9072 定义，**同形线性↔实心切换不跳形**，是本轮唯一能全量做「未完成线性/已完成实心」配对的库；② **唯一有 tray 语义**（tray / tray-arrow-down / tray-arrow-up），Tabler 与 MingCute 搜 tray 均返回空 —— 这对 Polaris 的托盘功能是实打实的缺口补位；③ 光学尺寸差已量化：tray 内容占 192/256 = 75%，而 lucide 是真描边、ink 比几何 bbox 每边多半描边，Inbox 实际 ink 达 90.6%，**真实光学倍率 ×1.208**，混排必须补偿。',
    extra: { tray: true, opticalCompensation: 1.208, baseShapes: 1512, weights: 6 }
  },
  tabler: {
    fit: 8.4,
    note: '核验补一条限制：**filled 不是全量配对** —— flag-x / flag-up / flag-cog 只有 outline，没有 -filled，所以「已完成实心」不能全库统一。官网 6287 个（Iconify 收录 6545）。网格 24 / 描边 2 / round 端点与 lucide 完全一致，替换几乎零视觉回归 —— 但风格辨识度同样低，换了等于没换。',
    extra: { filledFullyPaired: false, officialCount: 6287 }
  },
  iconoir: {
    fit: 7.6,
    note: '核验抓到一个会直接出问题的坑：React 组件**默认 width/height 是 "1.5em"**，会跟随字号 —— Polaris 中文最小 11px，直接用会缩成 16.5px 且随字号漂移。必须用 IconoirProvider 全局钉死像素。另：实心只有 288 个（regular 1383），配对能力弱。1.5 描边比 lucide 的 2 更轻，天然贴「安静表面」。',
    extra: { defaultSizeUnit: 'em', solidCount: 288, regularCount: 1383 }
  },
  mingcute: {
    fit: 8.0,
    note: '核验修正包名与体积：React 包是 **@mingcute/react**（不是几何数据包 @mingcute/icons），v3.1.0，解包 **2.8 MiB —— 本轮最小的 React 图标包**，比 Phosphor 小一个数量级。2263 对全量线/面一一对应。中文语义最贴：repeat-one（重复一次）、folder-1/2/3、**flag-1..4 正好四档对应 Polaris 优先级 0–3**。必须锁 core-regular / core-filled 子路径隔离 Pro 商业授权。',
    extra: { reactPackage: '@mingcute/react', reactVersion: '3.1.0', unpackedMiB: 2.8, pairs: 2263 }
  }
}

// ── 核验推翻的关键结论（页面单独展示） ──────────────────────────────────────
export const OVERTURNED = [
  {
    id: 'misans',
    title: 'MiSans 不能进安装包',
    before: '初版写「免费商用但自定义 EULA，本轮排除」——理由含糊，甚至暗示「法律上可以但不建议」。',
    after: '官方英文 EULA 的授权动词**只有 use**，没有 HarmonyOS 那样的 embed / bundle / redistribute；第 3 项条件明文禁止 "redistribute or sell the font software or any copies thereof"。**结论是硬禁止，不是不建议。**',
    impact: '从「不建议」升级为「不可用」。npm 包 misans@5.0.0 标 Apache-2.0 只覆盖打包代码，救不了字体本体。',
    evidence: '核验:cjk-fonts — 官方英文 EULA 原文'
  },
  {
    id: 'harmonyos',
    title: 'HarmonyOS Sans可以进包，但不能子集化',
    before: '初版把 HarmonyOS Sans 和 MiSans 一起归入「自定义 EULA，本轮排除」。',
    after: '两者**不一样**：HarmonyOS Sans SC EULA 明确允许未修改副本随软件 embed / bundle / redistribute（NSIS 可以带），但**禁止任何修改**、必须显著署名、许可 **revocable**、违约自动终止。',
    impact: '可以用，但「子集化压体积」这条路对它封死 —— 而中文字体不子集化就是 21.6 MB。许可可撤销这一点对长期发行的产品是额外风险。',
    evidence: '核验:cjk-fonts — HarmonyOS Sans EULA 原文'
  },
  {
    id: 'undraw',
    title: 'unDraw 的排除理由说错了',
    before: '初版写「禁止再分发素材本身，与打进 NSIS 安装包存在解释空间」。',
    after: '原文的「add them in an app」限制是以「插画处于你产品的核心目的」为前提的示例；**普通装饰性内嵌其实落在一般授权范围内**。真正禁止的是把素材打包再分发、做竞品服务、以及 AI/ML 用途。',
    impact: '排除结论不变，但准确依据是「自定义 EULA、非 OSI 开源许可」，不是「禁止嵌入你的 App」。把理由说准很重要，否则会误伤其它同类素材。',
    evidence: '核验:illustration — unDraw license 原文'
  },
  {
    id: 'open-doodles',
    title: 'Open Doodles 不是线稿，CC0 依据也不是仓库',
    before: '初版写「CC0，可随包分发」，并暗示是可直接 currentColor 接管的线稿。',
    after: '拿到作者 about 页原文 CC0 声明 + deed 链接（**无官方 GitHub 仓库 LICENSE**，pablostanley/OpenDoodles 实测 404）。实测 coffee.svg：43,758 B、viewBox 1024×768、**57 个 path、填充剪贴稿**，硬编码 `#000000` 与珊瑚色 `#FF5678`，stroke="none"。',
    impact: '不是 currentColor 线稿，必须改色：`#000000 → currentColor`、`#FF5678 → var(--accent)` 或直接删掉强调块以守「一个 teal」。CC0 结论成立但证据来自作者页而非仓库。',
    evidence: '补漏 — 作者 about 页 + coffee.svg 实测结构'
  },
  {
    id: 'tabbied',
    title: 'Tabbied 的 MIT 只在子目录',
    before: '初版未收录；常规做法会引用仓库根 LICENSE。',
    after: '根 LICENSE 是 "Copyright (c) 2020-2026 … **All rights reserved.**" 的专有许可，仅以豁免条款把三个 packages 目录授为 MIT。**真正的 MIT 原文在 packages/tabbied/LICENSE**。',
    impact: 'SPDX 仍是 MIT，但范围仅限 packages 子目录。引错文件等于把专有许可当开源用。',
    evidence: '核验:effects — 根 LICENSE 与子目录 LICENSE 逐字比对'
  },
  {
    id: 'optical',
    title: '光学补偿系数：×1.11 是错的，实测 ×1.208',
    before: '完整性批判按「几何 bbox 对几何 bbox」算出 ×1.11，并建议 viewBox 收到 24 24 208 208。',
    after: '补漏进一步指出：**lucide 是真描边，渲染 ink 每边比几何 bbox 多出半个描边**（CSS 1.75 → +0.875）。Inbox 几何 20/24 → ink 21.75/24 = **90.6%**。Phosphor 是填充路径，bbox 即 ink。真实倍率 = 0.90625 / 0.75 = **×1.208**，精确 viewBox 是 `22 22 212 212`（90.57%，误差 0.07%）。',
    impact: '批判自己给的两个建议彼此不一致（×1.11 vs 92.3%），补漏统一到 ink 口径。这是「看起来对但量错了」的典型 —— 混排图标必须按 ink 而不是几何算。',
    evidence: '补漏 — 路径 bbox 数值采样'
  },
  {
    id: 'stroke-inherit',
    title: '描边继承陷阱：注释理由方向反了',
    before: '集成初稿给对勾的 motion.svg 写了 path 级 strokeWidth: 2.6，注释称「必须写 style，否则会被 .task-check .p-icon 盖掉」。',
    after: '实测该 motion.svg **没有任何 class**，`.lucide` 与 `.p-icon` 都命不中它 —— 没有选择器盖它，注释方向反了。真实后果：2.6 生效 = 1.3px，比现状（2.2 × 12/24 = 1.1px）**粗 18%**，且新令牌管不到全应用最显眼的图标。',
    impact: '正确做法：给 svg 加 className，**删掉 path 的 strokeWidth** 让它继承 svg 的 var(--icon-stroke)。只要 path 自带 stroke-width 就会盖掉继承。',
    evidence: '完整性批判 + 补漏 — globals.css:374-381 与 TaskItem.tsx:57-62 实测'
  },
  {
    id: 'cn-font-split',
    title: 'cn-font-split 不是 WASM，也不收 woff2',
    before: '初版集成方案称它是「本地 WASM 工具」，示例未给安装命令与版本。',
    after: 'Node 下走 **koffi 2.10.0 原生 FFI**（dist/auto.mjs 按运行时动态 import ./node/index.mjs），不是纯 WASM。**v7 不支持 woff2 直接输入**，需 ttf/otf。默认产物名 `result.css` 来自 Rust 源码逐字核实。安装：`npm i -D cn-font-split@7.4.3`。',
    impact: '它是 build-time devDependency、不进安装包，所以「运行时零依赖」仍成立 —— 但工具本身需要原生二进制。CFF 子集化产物体积本轮**未实跑**。',
    evidence: '补漏 — 发布包 README + 仓库 Rust 源码'
  },
  {
    id: 'spring',
    title: 'Motion spring() 的真实时长是 400ms',
    before: '调研写「String(spring(0.2, 0)) 得到形如 200ms linear(...) 的字符串」。',
    after: '用本机已装的 motion 14.12.0 **实跑**，真实输出是 **400ms** linear(0, 0.2175, 0.5207, …)。',
    impact: '照抄会把动效时长写错一倍。Polaris 的 120/200/320ms 三档节奏对不上。',
    evidence: '核验:motion — 本机 motion 14.12.0 实跑'
  }
]

// ── 核验新增的素材条目 ──────────────────────────────────────────────────────
export const NEW_ASSETS = [
  {
    id: 'cjk-glow-sans', category: '中文字体', name: '{{PERSON_oxufgzrq}}',
    preview: 'https://github.com/welai/glow-sans',
    license: 'OFL-1.1（字体）+ MIT（构建代码）',
    licenseSource: '仓库 OFL.txt / LICENSE 原文',
    licenseUrl: 'https://raw.githubusercontent.com/welai/glow-sans/master/OFL.txt',
    version: '0.93',
    use: '本轮唯一「许可干净 + 可子集化 + 气质克制」的中文黑体候选。基于思源黑体改造，字面率略窄，适合密集列表。',
    integration: '下载 v0.93 zip → 取 GlowSansSC-Normal-Book.otf → cn-font-split 切片',
    fit: 8.2, verdict: 'consider', risk: 'none',
    detail: { kind: 'ref' },
    facts: [
      'release zip 实测 200，67,419,594 B；目标 GlowSansSC-Normal-Book.otf 9,186,344 B（已下载解包核实）',
      'zip 内**不含任何许可证文本**，OFL 全文须从仓库 OFL.txt 取并随包',
      '版权行是个人作者名，不是组织名 welai —— 写 NOTICE 时必须照抄原文那一行',
      'OTF/CFF 子集化产物体积本轮未实跑'
    ]
  },
  {
    id: 'cjk-harmonyos', category: '中文字体', name: 'HarmonyOS Sans SC',
    preview: 'https://developer.huawei.com/consumer/cn/design/',
    license: 'LicenseRef-HarmonyOS-Sans-EULA',
    licenseSource: '华为官方 EULA 原文',
    licenseUrl: 'https://developer.huawei.com/consumer/cn/design/',
    version: '2026-06-12',
    use: '允许未修改副本随 NSIS 安装包分发，但禁止任何修改（不能子集化）、必须显著署名、许可可撤销。21.6 MB 全量进包。',
    integration: '仅在接受「全量 21.6 MB + 显著署名 + 许可可撤销」时考虑',
    fit: 5.0, verdict: 'avoid', risk: 'custom-eula',
    detail: { kind: 'ref' },
    facts: [
      'EULA 明确允许 embed / bundle / redistribute 未修改副本',
      '禁止任何修改 → 子集化这条路封死',
      '许可 revocable，违约自动终止 —— 对长期发行产品是额外风险',
      '21.6 MB / 2026-06-12 属实；字重数与字形总数官方页未列'
    ]
  },
  {
    id: 'cjk-misans', category: '中文字体', name: 'MiSans',
    preview: 'https://hyperos.mi.com/font/',
    license: 'LicenseRef-MiSans-EULA',
    licenseSource: '小米官方英文 EULA 原文',
    licenseUrl: 'https://hyperos.mi.com/font/',
    version: '—',
    use: '不可用。EULA 授权动词只有 use，第 3 项明文禁止 redistribute or sell the font software or any copies thereof。',
    integration: '不要引入',
    fit: 2.0, verdict: 'avoid', risk: 'custom-eula',
    detail: { kind: 'ref' },
    facts: [
      'npm 包 misans@5.0.0 标 Apache-2.0，只覆盖打包代码，不覆盖字体本体',
      '与 HarmonyOS 的关键差别：没有 embed / bundle / redistribute 授权',
      '这是「包许可 ≠ 素材许可」最硬的一个反例'
    ]
  },
  {
    id: 'illus-coffee', category: '插画', name: 'Open Doodles · coffee.svg',
    preview: 'https://cdn.prod.website-files.com/5d5d5904f8a21bfe5ff69367/5da83548990d0a00b21786ee_coffee.svg',
    license: 'CC0-1.0',
    licenseSource: '作者 about 页原文 + CC0 deed（无官方仓库 LICENSE）',
    licenseUrl: 'https://www.opendoodles.com/about',
    version: '—',
    size: 43758,
    use: '若将来真要插画，这是许可最干净的一件。静态物件无人物，适合「已完成」空状态。但风格仍与 Polaris 的精确感有张力。',
    integration: '下载后改色内联：#000000 → currentColor，#FF5678 → var(--accent) 或删掉',
    fit: 5.6, verdict: 'alternative', risk: 'none',
    detail: { kind: 'ref' },
    facts: [
      '实测 200，43,758 B，viewBox 1024×768，57 个 path',
      '**不是 currentColor 线稿**：填充剪贴稿 + 硬编码 #FF5678，stroke="none"',
      'CC0 依据是作者 about 页，pablostanley/OpenDoodles 仓库实测 404',
      '第二候选 plant.svg 本轮 TLS/403 未验证'
    ]
  },
  {
    id: 'fx-tabbied', category: '特效', name: 'Tabbied 图案库',
    preview: 'https://github.com/Ye Joo Park/tabbied',
    license: 'MIT（仅 packages/tabbied 子目录）',
    licenseSource: 'packages/tabbied/LICENSE（根 LICENSE 是专有许可）',
    licenseUrl: 'https://github.com/Ye Joo Park/tabbied/blob/main/packages/tabbied/LICENSE',
    version: '—',
    use: '几何图案生成器。根 LICENSE 是 All rights reserved，仅以豁免条款把三个 packages 目录授为 MIT —— 引用必须指子目录。',
    integration: '生成后导出 SVG，SVGO 压缩，用 mask + var(--line-strong) 上色',
    fit: 6.0, verdict: 'alternative', risk: 'attribution-required',
    detail: { kind: 'ref' },
    facts: ['SPDX 是 MIT 但范围仅限 packages 子目录', '引错文件等于把专有许可当开源用']
  },
  {
    id: 'fx-shape-dividers', category: '特效', name: 'shape-dividers',
    preview: 'https://github.com/andraswebcode/shape-dividers/tree/main/svg',
    license: 'CC0-1.0',
    licenseSource: '仓库 LICENSE',
    licenseUrl: 'https://github.com/andraswebcode/shape-dividers',
    version: '—',
    use: '34 个形状分隔 SVG，CC0 无署名义务。但波浪/斜切风格偏营销页，与「安静的桌面工具」不符。',
    integration: '仅在需要非渐变形状时考虑；取仓库 svg/ 目录，不要用官网编辑器',
    fit: 4.6, verdict: 'avoid', risk: 'none',
    detail: { kind: 'ref' },
    facts: [
      '官网预览地址已 404（andrasweb.com 改版，编辑器不存在），README 链接同样是死地址',
      'svg/ 文件数 GitHub API 实测 34，不是调研初稿说的 25'
    ]
  },
  {
    id: 'fx-pattern-monster', category: '特效', name: 'Pattern Monster',
    preview: 'https://github.com/catchspider2002/svelte-svg-patterns',
    license: 'MIT（仅覆盖 Software，生成物存疑）',
    licenseSource: 'LICENSE.md 逐字核实',
    licenseUrl: 'https://raw.githubusercontent.com/catchspider2002/svelte-svg-patterns/master/LICENSE.md',
    version: '—',
    use: '维持存疑，不提为采纳。LICENSE 定义句只覆盖 "this software and associated documentation files"，未明示覆盖生成的图案。',
    integration: '需自行确认生成物许可后才可启用',
    fit: 4.0, verdict: 'avoid', risk: 'unclear',
    detail: { kind: 'ref' },
    facts: [
      '仓库全树只有 1 个静态 SVG（static/social/test.svg），图案是 Svelte 代码生成',
      '**没有 topography.svg 静态文件** —— 初版集成方案里指向它的 CSS 会让 Vite 构建期报未解析资源'
    ]
  },
  {
    id: 'motion-starting-style', category: '动画', name: '@starting-style / allow-discrete',
    preview: 'https://drafts.csswg.org/css-transitions-2/',
    license: 'NONE（Chromium 内置能力，非第三方素材）',
    licenseSource: '不是素材，无分发物',
    licenseUrl: '',
    version: 'Electron 45 内置',
    use: '入场动画的浏览器原生方案：元素首次渲染时从 @starting-style 过渡到常规样式，配合 transition-behavior: allow-discrete 可过渡 display。零依赖零许可义务。',
    integration: '纯 CSS，直接写进 globals.css',
    fit: 8.6, verdict: 'adopt', risk: 'none',
    detail: { kind: 'ref' },
    facts: [
      '核验修正：初版标 LicenseRef-自定义 并指向 w3c/csswg-drafts 的 LICENSE，会让下游误以为有自定义 EULA义务',
      '不随包分发任何 W3C 文本，SPDX 应为 NONE',
      'globals.css:3346 的 reduced-motion 块覆盖不到 ::view-transition-*，需单独处理'
    ]
  }
]

// ── 合规结论更新 ────────────────────────────────────────────────────────────
export const COMPLIANCE_OVERRIDE = [
  {
    topic: '自定义 EULA：MiSans 与 HarmonyOS 不是一回事',
    verdict: 'MiSans 硬禁止；HarmonyOS 可用但不能改',
    detail: 'MiSans 官方英文 EULA 的授权动词只有 use，第 3 项明文禁止 "redistribute or sell the font software or any copies thereof" —— 不能进 NSIS 安装包。HarmonyOS Sans 则明确允许未修改副本 embed / bundle / redistribute，但禁止任何修改、必须显著署名、许可 revocable、违约自动终止。',
    action: 'MiSans 直接排除。HarmonyOS 若要用，必须接受「全量 21.6 MB 不子集化 + 显著署名 + 许可可撤销」三个条件；对长期发行的产品，可撤销许可是实质风险。',
    risk: 'custom-eula'
  },
  {
    topic: '「免费商用」与包许可的双重陷阱',
    verdict: 'npm license 字段救不了素材本体',
    detail: 'misans@5.0.0 的 npm license 写 Apache-2.0，但那只是打包代码的许可。同理 @fontpkg/smiley-sans 的 license 指向不存在的 readme、仓库是占位地址；cn-fontsource-smiley-sans-oblique-regular 的 license 字段是 unknown —— 上游得意黑本体确为 OFL-1.1，但那不能替打包产物授权。',
    action: '一律回到素材本体的官方授权原文。第三方打包产物的 license 字段不作为依据；授权不明的包一律不引入对外发布的仓库。',
    risk: 'unclear'
  },
  {
    topic: 'MIT 的范围可能只覆盖子目录',
    verdict: 'Tabbied 根 LICENSE 是专有许可',
    detail: 'Tabbied 仓库根 LICENSE 写 "All rights reserved."，仅以豁免条款把三个 packages 目录授为 MIT。真正的 MIT 原文在 packages/tabbied/LICENSE。Pattern Monster 的 LICENSE.md 定义句只覆盖 Software，未明示覆盖生成的图案。',
    action: '引用许可必须指到真正授权的那个文件。「仓库有 LICENSE 且写着 MIT」不足以判断素材可用。',
    risk: 'attribution-required'
  },
  {
    topic: 'CC0 的证据可能不在仓库里',
    verdict: 'Open Doodles 成立，但依据是作者页',
    detail: 'Open Doodles 无官方 GitHub 仓库 LICENSE（pablostanley/OpenDoodles 实测 404）。CC0 依据是作者 about 页原文「without restriction under copyright or database law (CC0 license.)」+ CC0 deed 链接。这比第三方质疑的 Blush 证据更强，但仍不是仓库 LICENSE。',
    action: '可以随包分发、无需署名。把作者 about 页的原文与抓取日期一并存进 licenses/ 作为证据留痕。',
    risk: 'none'
  }
]

// ── 集成方案补充 ────────────────────────────────────────────────────────────
export const INTEGRATION_EXTRA = [
  {
    id: 'stroke-inherit',
    title: '描边继承陷阱（核验实测修正）',
    path: 'src/renderer/src/components/TaskItem.tsx',
    lang: 'tsx',
    note: '实测：globals.css:374-381 是 .lucide{1.75} / .task-check .lucide{2.2}，TaskItem.tsx:57-62 是 <Check size={12} strokeWidth={2.6}>。CSS 优先级高于呈现属性，真正生效 2.2 × 12/24 = 1.1px。若换成没有 class 的 motion.svg 并在 path 上写 strokeWidth: 2.6，会变成 1.3px（粗 18%），且新令牌管不到它。正确做法：给 svg 加 class，删掉 path 的 strokeWidth 让它继承。',
    code: `{task.completed && (
  <motion.svg
    viewBox="0 0 24 24"
    width={12}
    height={12}
    fill="none"
    aria-hidden="true"
    className="p-icon"
    style={{ stroke: 'var(--check-mark)' }}
  >
    <motion.path
      d="M20 6 9 17l-5-5"
      initial={{ pathLength: reduced ? 1 : 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
      style={{ strokeLinecap: 'round', strokeLinejoin: 'round' }}
    />
  </motion.svg>
)}

/* 配套 CSS：stroke-width 设在 svg 上，向 path 继承。
   path 一旦自带 stroke-width（属性或 style）就会盖掉继承。 */
.task-check .p-icon { stroke-width: var(--icon-stroke-strong); }`
  },
  {
    id: 'optical-comp',
    title: '混排图标的光学补偿（实测 ink 口径）',
    path: 'scripts/make-icons.mjs',
    lang: 'js',
    note: 'lucide 是真描边，渲染 ink 每边比几何 bbox 多半描边（CSS 1.75 → +0.875），Inbox 实际 ink 21.75/24 = 90.6%。Phosphor 是填充路径，bbox 即 ink，tray 只占 75%。按几何算得出的 ×1.11 低估了 lucide，真实倍率是 ×1.208。只改发射的 viewBox，size 与布局盒不变，smoke 高度断言不受影响。',
    code: `// 逐字形 viewBox 覆盖：把最大 ink 边对齐到 lucide 满幅 ink 90.6%
const GLYPHS = [
  { name: 'Tray',          viewBox: '22 22 212 212' },              // ×1.208
  { name: 'TrayArrowDown', viewBox: '22 22 212 212' },
  { name: 'TrayArrowUp',   viewBox: '22 22 212 212' },
  { name: 'RepeatOnce',    viewBox: '13.23 13.23 229.53 229.53' },  // ×1.115
  { name: 'Circle',        viewBox: '13.24 13.24 229.52 229.52' },
  { name: 'CheckCircle',   viewBox: '13.24 13.24 229.52 229.52' },
  { name: 'Flag',          viewBox: '25.67 21.69 220.66 220.66' }   // ×1.160
]

for (const glyph of GLYPHS) {
  const svg = await readGlyph(glyph.name)
  const viewBox = glyph.viewBox ?? /viewBox="([^"]+)"/.exec(svg)?.[1]
  // 补偿只作用于 .p-icon 发射的 viewBox，lucide 完全不受影响
  emit(glyph.name, svg, viewBox)
}

// 厚度 sanity：tray 壁厚 16 单位 → 16/212×16 = 1.208px
//              lucide 1.75/24×16 = 1.167px（+3.5%，可接受）`
  },
  {
    id: 'cjk-split-verified',
    title: '中文子集化（核验修正版）',
    path: 'scripts/split-fonts.mjs',
    lang: 'js',
    note: '核验修正三点：① Node 下走 koffi 原生 FFI，不是 WASM；② v7 不支持 woff2 直接输入，需 ttf/otf；③ 默认产物名 result.css 来自 Rust 源码逐字核实，这里显式指定消除歧义。它是 build-time devDependency，不进安装包，运行时零依赖仍成立。CFF 子集化产物体积本轮未实跑。',
    code: `// 构建期一次性运行，产物入库。用法：node scripts/split-fonts.mjs
// 前置：npm i -D cn-font-split@7.4.3
//       下载 https://github.com/welai/glow-sans/releases/download/v0.93/GlowSansSC-Normal-v0.93.zip
//       只解出 GlowSansSC-Normal-Book.otf（9,186,344 B）放到 scripts/vendor/glow-sans/
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fontSplit } from 'cn-font-split'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await fontSplit({
  input: new Uint8Array(await readFile(join(root, 'scripts/vendor/glow-sans/GlowSansSC-Normal-Book.otf'))),
  outDir: join(root, 'src/renderer/src/assets/fonts/glow-sans'),
  css: {
    fontFamily: '{{PERSON_oxufgzrq}}',
    fontWeight: '400 700',
    fontDisplay: 'swap',
    fileName: 'result.css'
  },
  chunkSize: 70 * 1024
})

// 注意：release zip 不含许可证文本，OFL 全文须从仓库取并随包：
// https://raw.githubusercontent.com/welai/glow-sans/master/OFL.txt
// 版权行是个人作者名，不是组织名 welai —— NOTICE 必须照抄原文那一行。`
  },
  {
    id: 'iconoir-provider',
    title: 'Iconoir 的 em 单位陷阱',
    path: 'src/renderer/src/App.tsx',
    lang: 'tsx',
    note: '核验实测：Iconoir React 组件默认 width/height 是 "1.5em"，会跟随字号。Polaris 中文最小 11px，直接用会缩成 16.5px 且随字号漂移。必须用 Provider 全局钉死像素。',
    code: `import { IconoirProvider } from 'iconoir-react'

// 不钉死像素的话，图标尺寸会随 font-size 漂移
<IconoirProvider iconProps={{
  width: 16,
  height: 16,
  strokeWidth: 1.5,
  color: 'currentColor'
}}>
  <App />
</IconoirProvider>`
  },
  {
    id: 'mingcute-subpath',
    title: 'MingCute 子路径隔离 Pro 授权',
    path: 'src/renderer/src/components/Icon.tsx',
    lang: 'tsx',
    note: '核验修正包名：React 包是 @mingcute/react（不是几何数据包 @mingcute/icons），2.8 MiB 是本轮最小。Pro 的 Cute/Sharp 风格是单独商业授权，必须锁死 core-regular / core-filled 两个子路径。flag-1..4 正好对应 Polaris 优先级 0–3。',
    code: `// 只从这两个子路径导入，天然隔离 Pro 商业授权
import { Flag1Regular, Flag2Regular, Flag3Regular, Flag4Regular } from '@mingcute/react/core-regular'
import { CheckCircleFilled } from '@mingcute/react/core-filled'

// 优先级 0–3 → 四档旗标，形状本身就带语义，不靠颜色
const PRIORITY_GLYPH = [null, Flag1Regular, Flag2Regular, Flag3Regular, Flag4Regular] as const

// 不传 title 即装饰性，对辅助技术隐藏；纯图标控件仍要在外层按钮写 aria-label
export function PriorityFlag({ level }: { level: 0 | 1 | 2 | 3 }) {
  const Glyph = PRIORITY_GLYPH[level]
  if (!Glyph) return null
  return <Glyph width={14} height={14} color="currentColor" />
}`
  }
]

// ── 「找不到合适开源选项」的明确结论 ────────────────────────────────────────
export const NO_ASSET_CONCLUSIONS = [
  {
    category: '装饰性特效素材',
    conclusion: '在设计硬约束下不存在可采纳的第三方开源特效件',
    why: '硬约束 4（安静表面、内容面禁毛玻璃）与 5（禁持续循环装饰动画）把市面上绝大多数特效素材直接排除。Pattern Monster 生成物许可存疑且无静态 SVG；Tabbied 的 MIT 只覆盖子目录；shape-dividers 是 CC0 但波浪风格偏营销页。',
    alternative: '自绘 CSS 渐变（网格/点阵）+ 自绘 feTurbulence 噪点（去饱和）+ Chromium 内置 @starting-style。三件都是自绘或浏览器内置，零第三方分发物、零许可义务。',
    honest: '本图鉴「特效」类的 7 个配方**全部是自绘**，没有一件从网络获取的第三方素材。这是结论，不是遗漏。'
  },
  {
    category: '一次性确认动画素材',
    conclusion: '不存在合适的第三方开源件',
    why: 'Lottie / Rive 的典型用法就是循环装饰，与硬约束 5 正面冲突；且 LottieFiles 免费区素材许可逐个不同。GSAP 是自定义 no-charge 许可，非 OSI 开源。',
    alternative: '已装 motion 14.12.0 的 pathLength 一次性描边 + 纯 CSS keyframes。',
    honest: '本图鉴「动效」类的 10 个配方里，7 个是 0 KB 纯 CSS/SVG，其余是已装 motion 的用法。同样没有新增第三方素材。'
  },
  {
    category: '插画 / 空状态图形',
    conclusion: '许可最干净的一件也仍有风格张力',
    why: 'unDraw 自定义 EULA；Storyset 免费需署名且偏营销；Lukasz Adam MIT 同页混称 CC0 与 MIT（法律含义互斥）被判 drop；Open Doodles 是 CC0 但实测是填充剪贴稿 + 硬编码珊瑚色，需改色。',
    alternative: '不用插画。自绘几何 SVG + 现有四角星做空状态构图 —— 本图鉴的星点亮动效与星点纹理就是成品。',
    honest: '若一定要用，Open Doodles coffee.svg 是唯一证据完整、许可干净的选择，已给直链与改色步骤。'
  },
  {
    category: '中文等宽 / 托盘图标',
    conclusion: '存在真实语义缺口',
    why: 'Geist Mono 无 CJK 字形，年/月只能回退 UI 字体；本轮未找到许可干净且 2:1 对齐的中文等宽。托盘语义只有 Phosphor 有（tray / tray-arrow-down / tray-arrow-up），Tabler 与 MingCute 搜索均返回空。',
    alternative: '等宽：接受年/月回退，或用 Noto Sans SC 单独渲染中文部分。托盘：若要做托盘图标语义，Phosphor 是唯一现成选项。',
    honest: '这两条是「现有方案的真实缺口」，不是可以靠换素材解决的问题。'
  }
]
