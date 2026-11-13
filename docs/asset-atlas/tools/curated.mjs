// 人工策划的内容：动效配方、特效配方、集成代码、主题适配矩阵、合规结论。
// 事实性字段（版本号、许可证、字节数、SVG 源码）不写在这里，由 build-data.mjs 从
// data/*.json 注入——那些是抓来的，不是编的。

export const PROJECT = {
  name: 'Polaris',
  version: '0.2.1',
  stack: 'Electron 45 · React 19 · Tailwind v4 · better-sqlite3 · NSIS',
  constraint: '应用运行时完全离线，素材必须能打进 asar；CDN 只用于本预览页。',
  current: {
    icons: 'lucide-react 1.72.0（.lucide 全局覆写 stroke-width: 1.75，勾选/提醒 2.2）',
    motion: 'motion 14.12.0（Motion for React），MotionConfig reducedMotion="user"',
    fonts: '@fontsource-variable/{inter, manrope, noto-sans-sc, geist-mono}'
  }
}

export const THEMES = [
  {
    id: 'dark', label: '夜阑', family: 'dark', desc: '冷墨夜色 · 经典深色',
    bg: '#080a0f', bgSoft: '#0b0e15', panelBg: '#0b0e15',
    text: '#e8ecf4', textSecondary: '#9aa4b2', textTertiary: '#7a8494',
    line: 'rgba(255,255,255,0.07)', lineStrong: 'rgba(255,255,255,0.12)',
    accent: '#5eead4', accentRgb: '94,234,212', accent2: '#a78bfa', accent2Rgb: '167,139,250',
    onAccent: '#07110f', warning: '#fbbf24', danger: '#fb7185',
    surface1: 'rgba(255,255,255,0.02)', surface2: 'rgba(255,255,255,0.025)',
    hover: 'rgba(255,255,255,0.035)', selected: 'rgba(255,255,255,0.06)',
    drawerBg: 'rgba(10,13,19,0.96)', innerHighlight: 'rgba(255,255,255,0.045)',
    auroraOpacity: 0.9, noiseOpacity: 0.032, auroraC: '240,171,252', shadowRgb: '0,0,0'
  },
  {
    id: 'light', label: '昼白', family: 'light', desc: '暖瓷白昼 · 经典浅色',
    bg: '#f4f3ef', bgSoft: '#efeee9', panelBg: '#fbfaf7',
    text: '#14120f', textSecondary: '#5f5a51', textTertiary: '#6b655b',
    line: 'rgba(23,26,33,0.08)', lineStrong: 'rgba(23,26,33,0.14)',
    accent: '#0f766e', accentRgb: '15,118,110', accent2: '#7c3aed', accent2Rgb: '124,58,237',
    onAccent: '#ffffff', warning: '#b45309', danger: '#be123c',
    surface1: 'rgba(255,255,255,0.55)', surface2: 'rgba(255,255,255,0.72)',
    hover: 'rgba(23,26,33,0.035)', selected: 'rgba(13,148,136,0.07)',
    drawerBg: 'rgba(255,255,255,0.97)', innerHighlight: 'rgba(255,255,255,0.9)',
    auroraOpacity: 0.55, noiseOpacity: 0.018, auroraC: '219,39,119', shadowRgb: '23,26,33'
  },
  {
    id: 'dusk', label: '暮蓝', family: 'dark', desc: '深邃蓝调 · 沉静夜色',
    bg: '#132644', bgSoft: '#182c4e', panelBg: '#182c4e',
    text: '#e7ecf6', textSecondary: '#a3afc6', textTertiary: '#93a2be',
    line: 'rgba(255,255,255,0.07)', lineStrong: 'rgba(255,255,255,0.12)',
    accent: '#5eead4', accentRgb: '94,234,212', accent2: '#93c5fd', accent2Rgb: '147,197,253',
    onAccent: '#07110f', warning: '#fbbf24', danger: '#fb7185',
    surface1: 'rgba(255,255,255,0.02)', surface2: 'rgba(255,255,255,0.025)',
    hover: 'rgba(255,255,255,0.035)', selected: 'rgba(94,234,212,0.08)',
    drawerBg: 'rgba(19,36,64,0.96)', innerHighlight: 'rgba(255,255,255,0.045)',
    auroraOpacity: 0.85, noiseOpacity: 0.03, auroraC: '125,211,252', shadowRgb: '0,0,0'
  },
  {
    id: 'sand', label: '暖砂', family: 'light', desc: '燕麦暖砂 · 柔和白昼',
    bg: '#ece0c6', bgSoft: '#e6d9bd', panelBg: '#faf6ee',
    text: '#211b13', textSecondary: '#5d5243', textTertiary: '#665a4b',
    line: 'rgba(40,33,24,0.09)', lineStrong: 'rgba(40,33,24,0.15)',
    accent: '#0d6e66', accentRgb: '13,110,102', accent2: '#9a3412', accent2Rgb: '154,52,18',
    onAccent: '#ffffff', warning: '#b45309', danger: '#be123c',
    surface1: 'rgba(255,252,246,0.55)', surface2: 'rgba(255,252,246,0.74)',
    hover: 'rgba(40,33,24,0.04)', selected: 'rgba(13,110,102,0.08)',
    drawerBg: 'rgba(255,252,246,0.97)', innerHighlight: 'rgba(255,255,255,0.9)',
    auroraOpacity: 0.5, noiseOpacity: 0.018, auroraC: '217,119,6', shadowRgb: '40,33,24'
  },
  {
    id: 'sky', label: '天蓝', family: 'light', desc: '晴空天蓝 · 清透白昼',
    bg: '#dceaf6', bgSoft: '#d2e3f1', panelBg: '#eef6fc',
    text: '#17242f', textSecondary: '#466072', textTertiary: '#4d6476',
    line: 'rgba(23,42,58,0.08)', lineStrong: 'rgba(23,42,58,0.14)',
    accent: '#0d6e66', accentRgb: '13,110,102', accent2: '#075985', accent2Rgb: '7,89,133',
    onAccent: '#ffffff', warning: '#b45309', danger: '#be123c',
    surface1: 'rgba(255,255,255,0.55)', surface2: 'rgba(255,255,255,0.72)',
    hover: 'rgba(23,42,58,0.035)', selected: 'rgba(13,110,102,0.08)',
    drawerBg: 'rgba(255,255,255,0.97)', innerHighlight: 'rgba(255,255,255,0.9)',
    auroraOpacity: 0.5, noiseOpacity: 0.018, auroraC: '56,189,248', shadowRgb: '23,42,58'
  },
  {
    id: 'green', label: '护眼绿', family: 'light', desc: '浅绿护眼 · 柔和白昼',
    bg: '#c7edcc', bgSoft: '#bfe5c5', panelBg: '#eaf7ec',
    text: '#1e2b1c', textSecondary: '#4a6040', textTertiary: '#52684a',
    line: 'rgba(28,43,28,0.09)', lineStrong: 'rgba(28,43,28,0.15)',
    accent: '#0b6b63', accentRgb: '11,107,99', accent2: '#3f6212', accent2Rgb: '63,98,18',
    onAccent: '#ffffff', warning: '#b45309', danger: '#be123c',
    surface1: 'rgba(250,255,251,0.55)', surface2: 'rgba(250,255,251,0.74)',
    hover: 'rgba(28,43,28,0.04)', selected: 'rgba(11,107,99,0.08)',
    drawerBg: 'rgba(250,255,251,0.97)', innerHighlight: 'rgba(255,255,255,0.9)',
    auroraOpacity: 0.45, noiseOpacity: 0.018, auroraC: '74,222,128', shadowRgb: '28,43,28'
  }
]

// ── 动效配方 ────────────────────────────────────────────────────────────────
// 每条都能在页面上真跑。Polaris 规矩：动效只做确认不做装饰，禁止持续循环。
export const MOTION = [
  {
    id: 'check-draw',
    name: '勾选描边',
    target: 'src/renderer/src/components/TaskItem.tsx',
    ms: 200,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
    library: '纯 CSS / SVG',
    bytes: '0 KB（无依赖）',
    why: '完成是 Polaris 最高频的动作。对勾用 stroke-dashoffset 画出来，比直接切图标多一层「确认感」，且不需要任何运行时。',
    reduced: '直接把 dashoffset 设为 0，不播放。',
    loop: false,
    code: `.task-check .check-mark {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  transition: stroke-dashoffset 200ms var(--ease-out);
}
.task-check[data-done='true'] .check-mark {
  stroke-dashoffset: 0;
}
@media (prefers-reduced-motion: reduce) {
  .task-check .check-mark { transition: none; stroke-dashoffset: 0; }
}`
  },
  {
    id: 'row-enter',
    name: '任务行插入',
    target: 'src/renderer/src/components/TaskView.tsx',
    ms: 200,
    ease: 'spring(420, 36)',
    library: 'motion 14（已在用）',
    bytes: '已计入现有依赖',
    why: '列表已有 AnimatePresence。插入只动 opacity + 6px 位移，不动 height，避免密集列表回流。',
    reduced: 'MotionConfig reducedMotion="user" 已自动跳过位移，只保留透明度。',
    loop: false,
    code: `<motion.li
  layout="position"
  initial={{ opacity: 0, y: 6 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -4 }}
  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
>`
  },
  {
    id: 'undo-toast',
    name: '撤销 toast',
    target: 'src/renderer/src/components/UndoToast.tsx',
    ms: 320,
    ease: 'spring(380, 40)',
    library: 'motion 14 + CSS 倒计时条',
    bytes: '0 KB 新增',
    why: '删除是破坏性动作，撤销窗口必须可见。倒计时条用 CSS transform: scaleX 而不是 width，走合成层不触发布局。',
    reduced: 'toast 直接出现在终态；倒计时条仍然走（它承载信息，不是装饰）。',
    loop: false,
    code: `.undo-toast__timer {
  transform-origin: left center;
  animation: undo-countdown 5000ms linear forwards;
}
@keyframes undo-countdown {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}`
  },
  {
    id: 'palette-in',
    name: '命令面板入场',
    target: 'src/renderer/src/components/CommandPalette.tsx',
    ms: 200,
    ease: 'spring(500, 40)',
    library: 'motion 14（已在用）',
    bytes: '已计入现有依赖',
    why: '浮层是唯一允许用阴影和 backdrop-blur 的地方。scale 0.98→1 的幅度要小，大了会显得廉价。',
    reduced: '只保留 opacity。',
    loop: false,
    code: `<motion.div
  initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
>`
  },
  {
    id: 'star-ignite',
    name: '空状态星点亮',
    target: 'src/renderer/src/components/TaskView.tsx（空状态）',
    ms: 320,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
    library: '纯 CSS，一次性',
    bytes: '0 KB',
    why: 'teal→violet 渐变只属于星标记和空状态。点亮一次就停——这是品牌时刻，不是循环装饰。',
    reduced: '直接渲染点亮后的终态。',
    loop: false,
    code: `.empty-star {
  animation: star-ignite 320ms var(--ease-out) both;
}
@keyframes star-ignite {
  from { opacity: 0; transform: scale(0.9) rotate(-12deg); }
  to   { opacity: 1; transform: scale(1) rotate(0deg); }
}
@media (prefers-reduced-motion: reduce) {
  .empty-star { animation: none; }
}`
  },
  {
    id: 'reminder-in',
    name: '提醒卡片弹入',
    target: 'src/renderer/src/components/ReminderView.tsx',
    ms: 320,
    ease: 'spring(380, 40)',
    library: 'motion 14',
    bytes: '已计入现有依赖',
    why: '提醒窗口是独立的 420×212 不透明面。弹入只动 translateY，不动窗口本身——窗口位置由主进程定。',
    reduced: '直接出现在终态。',
    loop: false,
    code: `<motion.div
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: 'spring', stiffness: 380, damping: 40 }}
>`
  },
  {
    id: 'chip-in',
    name: '解析 chip 入场',
    target: 'src/renderer/src/components/QuickAdd.tsx',
    ms: 120,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
    library: 'motion 14（已在用）',
    bytes: '已计入现有依赖',
    why: '快捷添加的 chip 是「机器读懂了你的话」的即时反馈，120ms 微动效级别。注意 AnimatePresence 退出期间按钮仍挂载。',
    reduced: '直接出现。',
    loop: false,
    code: `initial={{ opacity: 0, y: 4 }}
animate={{ opacity: 1, y: 0 }}
exit={{ opacity: 0, y: 4 }}
transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}`
  },
  {
    id: 'theme-cross',
    name: '主题切换淡变',
    target: 'src/renderer/src/components/ThemeSync.tsx',
    ms: 200,
    ease: 'ease-out',
    library: 'View Transitions API（Chromium 原生）',
    bytes: '0 KB（Electron 45 的 Chromium已支持）',
    why: '六套主题切换时整页硬切会闪。View Transitions 由浏览器合成一张快照做交叉淡入，不需要复制 DOM。',
    reduced: '跳过 startViewTransition，直接 setState。',
    loop: false,
    code: `function applyTheme(next: AppTheme) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduce) {
    document.documentElement.dataset.theme = next
    return
  }
  document.startViewTransition(() => {
    document.documentElement.dataset.theme = next
  })
}`
  },
  {
    id: 'progress-ring',
    name: '进度环',
    target: 'src/renderer/src/components/Sidebar.tsx',
    ms: 320,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
    library: '纯 SVG + CSS',
    bytes: '0 KB',
    why: '进度环必须是实心 teal，不能用品牌渐变。dashoffset 过渡走的是 SVG 属性，Chromium 会合成。',
    reduced: '直接跳到目标值。',
    loop: false,
    code: `.progress-ring__value {
  transition: stroke-dashoffset 320ms var(--ease-out);
  stroke: var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  .progress-ring__value { transition: none; }
}`
  },
  {
    id: 'auto-animate',
    name: '列表自动动画（备选）',
    target: '任意列表容器',
    ms: 250,
    ease: 'ease-in-out',
    library: '@formkit/auto-animate 0.10.2',
    bytes: '约 2 KB gzip（需自行复核）',
    why: '如果哪天要去掉 motion 依赖，auto-animate 能用一行给任意容器加上增删移的 FLIP 动画。但 Polaris 已经有 motion，引入它是重复能力。',
    reduced: '需要自己传 duration: 0，它不读 prefers-reduced-motion。',
    loop: false,
    code: `import autoAnimate from '@formkit/auto-animate'

useEffect(() => {
  if (!listRef.current) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const ctrl = autoAnimate(listRef.current, { duration: reduce ? 0 : 250 })
  return () => ctrl.disable()
}, [])`
  }
]

// ── 特效配方 ────────────────────────────────────────────────────────────────
export const EFFECTS = [
  {
    id: 'grain',
    name: '胶片颗粒',
    origin: 'SVG feTurbulence（自绘，无第三方素材）',
    license: '自绘 · 无外部许可',
    runtime: '0 KB 运行时',
    perf: '烘成静态 data URI 后只解码一次；每帧重算 feTurbulence 会吃满 GPU。',
    mapping: 'opacity 绑定 --noise-opacity（夜阑 0.032 / 浅色家族 0.018）',
    why: 'Polaris 已经有 --noise-opacity 令牌。颗粒让大面积纯色画布不显得塑料，但强度必须低到「说不出哪里不一样」。',
    code: `--grain-url: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");

.app-grain {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: var(--grain-url);
  opacity: var(--noise-opacity);
  mix-blend-mode: overlay;
}`
  },
  {
    id: 'aurora',
    name: '极光网格渐变',
    origin: 'CSS radial-gradient（自绘）',
    license: '自绘 · 无外部许可',
    runtime: '0 KB 运行时',
    perf: '三层 radial-gradient 是静态绘制；只在指针移动时改 background-position，不重算渐变。',
    mapping: '三个色停靠点分别取 --accent-rgb / --accent-2-rgb / --aurora-c-rgb，整体透明度取 --aurora-opacity',
    why: '六套主题已经各自定义了 --aurora-c-rgb，所以同一份渐变在六套主题下自动换色，不需要写六份。',
    code: `.app-aurora {
  position: fixed;
  inset: -20%;
  pointer-events: none;
  opacity: var(--aurora-opacity);
  background:
    radial-gradient(38% 44% at 18% 22%, rgba(var(--accent-rgb), 0.16), transparent 70%),
    radial-gradient(34% 40% at 82% 18%, rgba(var(--accent-2-rgb), 0.14), transparent 70%),
    radial-gradient(46% 50% at 62% 88%, rgba(var(--aurora-c-rgb), 0.10), transparent 72%);
  filter: blur(48px);
}`
  },
  {
    id: 'dotgrid',
    name: '点阵底纹',
    origin: 'CSS radial-gradient（自绘）',
    license: '自绘 · 无外部许可',
    runtime: '0 KB 运行时',
    perf: '单个 repeating 渐变，绘制成本极低。',
    mapping: '点色取 --line，间距取 --space-5（24px）',
    why: '空状态和设置面板的大片空白需要一点结构感。点阵比方格更安静，不抢任务行。',
    code: `.dot-grid {
  background-image: radial-gradient(var(--line) 1px, transparent 1px);
  background-size: var(--space-5) var(--space-5);
}`
  },
  {
    id: 'hairline',
    name: '渐隐分隔线',
    origin: 'CSS linear-gradient（自绘）',
    license: '自绘 · 无外部许可',
    runtime: '0 KB 运行时',
    perf: '静态。',
    mapping: '--line-strong 到 transparent',
    why: '侧栏与列表之间的 1px 硬线在暖砂/护眼绿这种深色画布上会显得脏。两端渐隐更柔和。',
    code: `.hairline {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--line-strong) 18%, var(--line-strong) 82%, transparent);
}`
  },
  {
    id: 'starfield',
    name: '静态星点',
    origin: 'SVG pattern（自绘）',
    license: '自绘 · 无外部许可',
    runtime: '0 KB 运行时',
    perf: '一张 SVG pattern 平铺，不生成 DOM 节点。',
    mapping: '星点色取 --accent-rgb，透明度按 --aurora-opacity 缩放',
    why: '「北极星」是产品名的来源。空状态铺一层极淡的星点，比插画更贴合「安静的桌面工具」。禁止闪烁动画。',
    code: `/* 不要把 teal 写进 SVG —— 那样浅色主题就错了。
   SVG 只提供形状，颜色交给 background-color，用 mask 合成。 */
.starfield {
  background-color: var(--accent);
  opacity: 0.5;
  --star-url: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cg fill='%23000'%3E%3Ccircle cx='18' cy='30' r='1.1'/%3E%3Ccircle cx='74' cy='14' r='0.9'/%3E%3Ccircle cx='102' cy='62' r='1.3'/%3E%3Ccircle cx='44' cy='88' r='1'/%3E%3Ccircle cx='90' cy='104' r='0.8'/%3E%3C/g%3E%3C/svg%3E");
  -webkit-mask-image: var(--star-url);
  mask-image: var(--star-url);
}`
  },
  {
    id: 'bevel',
    name: '玻璃内高光（陷阱演示）',
    origin: '项目自有令牌 --inner-highlight',
    license: '项目自有',
    runtime: '0 KB',
    perf: '静态 inset shadow。',
    mapping: '暗色家族 4.5% 白 / 浅色家族 90% 白',
    why: '这是仓库里踩过坑的地方：--inner-highlight 只能用在半透明玻璃面上。放到饱和 --accent 填充上，浅色主题会在顶边生成近白描边，看起来像第二层轮廓。',
    code: `/* 对：半透明玻璃面 */
.quick-add-shell {
  background: var(--surface-2);
  box-shadow: inset 0 1px 0 var(--inner-highlight);
}

/* 错：饱和 accent 填充 —— 浅色主题会出现近白顶边 */
.reminder-primary {
  background: var(--accent);
  box-shadow: none; /* 必须完全去掉 inset */
}`
  },
  {
    id: 'focus-ring',
    name: '焦点环反色规则',
    origin: '项目自有规则',
    license: '项目自有',
    runtime: '0 KB',
    perf: '静态。',
    mapping: 'accent 填充控件用 --on-accent 负偏移；已有 accent 边框的控件聚焦时去掉边框',
    why: '焦点环不能和它包围的表面同色，否则读起来像控件的幽灵副本。冒烟测试会扫描每个可聚焦元素并对此报错。',
    code: `:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* accent 实心控件：环画在填充内侧，用 on-accent */
.btn-accent:focus-visible {
  outline-color: var(--on-accent);
  outline-offset: -3px;
}
/* 已经用 accent 描边的控件：聚焦时去掉边框，避免双环 */
.chip-active:focus-visible {
  border-color: transparent;
}`
  }
]

// ── 参考型素材（不下载，只登记来源与许可） ──────────────────────────────────
export const REFERENCE_ASSETS = [
  {
    id: 'hero-patterns', name: 'Hero Patterns', category: '特效',
    homepage: 'https://heropatterns.com', preview: 'https://heropatterns.com',
    licenseHint: 'CC BY 4.0（图案）/ MIT（站点代码）',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    use: '空状态底纹备选。导出 SVG 后把 fill 换成 currentColor 即可跟随主题。',
    integration: '网页上选图案 → 复制 SVG → 存为 src/renderer/src/assets/patterns/*.svg → 用 CSS mask 上色',
    caveat: '署名要求：CC BY 需要在使用处标注作者与许可。若不想署名，改用自绘 dotgrid。',
    status: 'reference'
  },
  {
    id: 'haikei', name: 'Haikei', category: '特效',
    homepage: 'https://haikei.app', preview: 'https://haikei.app',
    licenseHint: '生成器免费，产出物许可需以站点条款为准',
    licenseUrl: 'https://haikei.app',
    use: '一次性生成 blob / wave / 分层背景 SVG，导出后内联。',
    integration: '导出 SVG → SVGO 压缩 → 内联进组件，颜色改成 var(--accent)',
    caveat: '站点条款未在本轮抓到原文，标记为未验证；不要直接当作 CC0 使用。',
    status: 'unverified'
  },
  {
    id: 'undraw', name: 'unDraw', category: '插画',
    homepage: 'https://undraw.co/illustrations', preview: 'https://undraw.co/illustrations',
    licenseHint: '自定义许可：免费商用、无需署名，但禁止再分发素材本身',
    licenseUrl: 'https://undraw.co/license',
    use: '不推荐。风格偏营销插画，与「安静的桌面工具」不符。',
    integration: '若一定要用：改主色为 teal 后导出 SVG，随安装包分发前须自行确认许可条款',
    caveat: '「禁止再分发素材本身」与「打进 NSIS 安装包」存在解释空间，建议避开。',
    status: 'not-recommended'
  },
  {
    id: 'open-doodles', name: 'Open Doodles', category: '插画',
    homepage: 'https://opendoodles.com', preview: 'https://opendoodles.com',
    licenseHint: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    use: '若将来真的需要插画，这是许可最干净的一档（CC0，可随包分发，无需署名）。',
    integration: '下载 SVG → 把描边色改成 var(--text-secondary)，主色改成 var(--accent)',
    caveat: '手绘涂鸦风格与 Polaris 的精确感冲突，只在空状态考虑，不要进主界面。',
    status: 'reference'
  },
  {
    id: 'lottiefiles', name: 'LottieFiles 免费区', category: '动画',
    homepage: 'https://lottiefiles.com', preview: 'https://lottiefiles.com/free-animations',
    licenseHint: '逐个素材不同，免费不等于可再分发',
    licenseUrl: 'https://lottiefiles.com/page/licensing',
    use: '不推荐。Polaris 禁止持续循环装饰动画，而 Lottie 免费区绝大多数是循环动画。',
    integration: '—',
    caveat: '播放器 lottie-web 本身是 MIT，但**素材**许可逐个不同；且循环播放违反设计约束。',
    status: 'not-recommended'
  },
  {
    id: 'gsap', name: 'GSAP', category: '动画',
    homepage: 'https://gsap.com', preview: 'https://gsap.com',
    licenseHint: "Standard 'no charge' license（自定义，非 OSI 开源）",
    licenseUrl: 'https://gsap.com/standard-license',
    use: '不推荐。能力远超需求，且许可不是开源许可。',
    integration: '—',
    caveat: 'npm 的 license 字段原文就是 "Standard \'no charge\' license: https://gsap.com/standard-license."，2025 年起插件免费但仍非开源。',
    status: 'not-recommended'
  }
]

// ── 集成代码 ────────────────────────────────────────────────────────────────
export const INTEGRATION = [
  {
    id: 'icon-adapter',
    title: '统一图标适配层',
    path: 'src/renderer/src/components/Icon.tsx',
    lang: 'tsx',
    note: '现有 12 个组件直接 import lucide-react。加第二套图标库时不要改这 12 个调用点，用一个适配层把「语义名」映射到具体库，切换成本收敛到一个文件。',
    code: `import type { ComponentType, SVGProps } from 'react'
import {
  Bell, CalendarDays, Check, Circle, Flag, Folder,
  Repeat2, Sparkle, Star, Trash2
} from 'lucide-react'

// 语义名 → 组件。换库时只改这张表，调用点不动。
const REGISTRY = {
  bell: Bell,
  calendar: CalendarDays,
  check: Check,
  circle: Circle,
  flag: Flag,
  folder: Folder,
  repeat: Repeat2,
  sparkle: Sparkle,
  star: Star,
  trash: Trash2
} as const satisfies Record<string, ComponentType<SVGProps<SVGSVGElement>>>

export type IconName = keyof typeof REGISTRY

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
  // 装饰图标默认从无障碍树里隐藏；承载语义时传 label。
  label?: string
}

export function Icon({ name, size = 16, label, ...rest }: IconProps) {
  const Glyph = REGISTRY[name]
  return (
    <Glyph
      width={size}
      height={size}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  )
}`
  },
  {
    id: 'icon-stroke',
    title: '描边统一由 CSS 令牌控制',
    path: 'src/renderer/src/styles/globals.css',
    lang: 'css',
    note: '仓库现在写死 .lucide { stroke-width: 1.75 }。换成令牌后，图标粗细能随主题/密度调整，且换库时不用改选择器。注意：Phosphor / MingCute / Remix 的线性风格是「填充轮廓」，CSS 改 stroke-width 对它们无效——只能换字重变体。',
    code: `:root {
  --icon-stroke: 1.75;
  --icon-stroke-strong: 2.2;
  --icon-size-sm: 14px;
  --icon-size-md: 16px;
  --icon-size-lg: 20px;
}

.icon {
  width: var(--icon-size-md);
  height: var(--icon-size-md);
  stroke-width: var(--icon-stroke);
  color: currentColor;
  flex: none;
}

.task-check .icon,
.reminder-primary .icon {
  stroke-width: var(--icon-stroke-strong);
}

/* 保留 .lucide 兼容期，迁移完成后删除 */
.lucide { stroke-width: var(--icon-stroke); }`
  },
  {
    id: 'font-import',
    title: '字体引入落点',
    path: 'src/renderer/src/main.tsx',
    lang: 'tsx',
    note: '@fontsource-variable 的 CSS 只在渲染进程 import，Vite 会把 woff2 作为 asset 打进 out/renderer，electron-builder 再打进 asar。不要放 devDependencies 之外——字体是运行时资产，应当移到 dependencies。',
    code: `import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/geist-mono'
// 中文只引 latin + 常用汉字分片，避免整包 55 MB 进安装包
import '@fontsource-variable/noto-sans-sc/wght.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'`
  },
  {
    id: 'cjk-subset',
    title: '中文字体子集化（离线打包关键）',
    path: 'scripts/subset-cjk.mjs',
    lang: 'bash',
    note: '@fontsource/lxgw-wenkai 解包后 55.9 MB，直接打进 NSIS 安装包不可接受。cn-font-split 按 unicode-range 切片，浏览器只加载命中的分片；配合 electron-vite 的 assetsInclude 保证 woff2 被当作资产。',
    code: `# 1. 安装切片工具（Apache-2.0）
npm i -D cn-font-split

# 2. 切片：只保留常用汉字 + 拉丁，产出 unicode-range 分片 woff2 + CSS
npx cn-font-split -i ./vendor/NotoSansSC-VF.ttf -o ./src/renderer/src/assets/fonts/noto-sc \\
  --test-html false --preview-image false

# 3. 在 electron.vite.config.ts 里确保 woff2 走资产管线
#    renderer: { assetsInclude: ['**/*.woff2'] }

# 4. 校验体积：切片后单片通常 20–80 KB，首屏只命中 2–4 片
node -e "const fs=require('fs');const d='./src/renderer/src/assets/fonts/noto-sc';console.log(fs.readdirSync(d).length+' files')"`,
  },
  {
    id: 'theme-map',
    title: '新素材的主题映射',
    path: 'src/renderer/src/styles/globals.css',
    lang: 'css',
    note: '所有第三方素材的颜色都必须经由令牌，不能写死色值——否则六套主题里必然有一套翻车。图标靠 currentColor 自动继承，SVG 图案靠 mask + background-color。',
    code: `/* 图标：永远 currentColor，不写死颜色 */
.icon { color: currentColor; }
.icon--signal { color: var(--accent); }
.icon--attention { color: var(--warning); }
.icon--danger { color: var(--danger); }

/* 第三方 SVG 图案：用 mask 上色，而不是改 SVG 里的 fill */
.pattern {
  background-color: var(--line-strong);
  -webkit-mask-image: var(--pattern-url);
  mask-image: var(--pattern-url);
  -webkit-mask-size: 120px 120px;
  mask-size: 120px 120px;
}

/* 颗粒与极光：强度令牌已在六套主题里各自定义，无需重复写 */
.app-grain { opacity: var(--noise-opacity); }
.app-aurora { opacity: var(--aurora-opacity); }

/* 陷阱：浅色家族 --inner-highlight 是 90% 白，禁止用在 accent 填充上 */
.btn-accent {
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: none;
}`
  },
  {
    id: 'notice',
    title: '合规落地：NOTICE 文件',
    path: 'NOTICE',
    lang: 'text',
    note: 'OFL 字体要求随分发附上许可原文；ISC/MIT/Apache 要求保留版权与许可声明。NSIS 安装包属于再分发，这些义务都触发。把声明集中到 NOTICE，并在「设置 → 关于」里给一个入口。',
    code: `Polaris — 第三方素材声明

字体（SIL Open Font License 1.1）
  Inter — Copyright The Inter Project Authors
  Manrope — Copyright The Manrope Project Authors
  Geist / Geist Mono — Copyright Vercel, Inc.
  Noto Sans SC — Copyright The Noto Project Authors
  完整许可原文见 licenses/OFL-1.1.txt

图标
  Lucide — ISC License — Copyright Lucide Contributors
  （若引入）Phosphor Icons — MIT — Copyright Phosphor Icons
  （若引入）Tabler Icons — MIT — Copyright Tabler

动效
  Motion — MIT — Copyright Motion Contributors

本文件随安装包分发，并可在「设置 → 关于 → 开源许可」中查看。`
  },
  {
    id: 'build-check',
    title: '落地后的验证命令',
    path: '终端',
    lang: 'bash',
    note: '仓库没有 ESLint / 单元测试，自动化关口就是 typecheck、smoke 和 verify:themes。改图标/字体属于行为与主题改动，三个都要跑。',
    code: `npm run typecheck
npm run build && npm run smoke
npm run verify:themes`
  }
]

// ── 分阶段落地 ──────────────────────────────────────────────────────────────
export const PHASES = [
  {
    tier: 'P0',
    title: '零风险、立刻可做',
    risk: '低',
    items: [
      '把 .lucide 的写死 stroke-width 换成 --icon-stroke 令牌（不新增依赖）',
      '补 NOTICE 文件，把现有四套 OFL 字体 + Lucide ISC 的声明写全 —— 这是当前就存在的合规缺口',
      '把四个 @fontsource-variable 包从 devDependencies 移到 dependencies（它们是运行时资产）',
      '勾选描边、星点亮、进度环三个纯 CSS 动效落地（0 KB 新增）'
    ],
    verify: 'npm run typecheck && npm run build && npm run smoke'
  },
  {
    tier: 'P1',
    title: '有收益、需要评估',
    risk: '中',
    items: [
      '中文字体子集化：用 cn-font-split 把 Noto Sans SC 切片，压住安装包体积',
      '建 Icon.tsx 适配层，把 12 个组件的 lucide 直接 import 收敛到一处',
      '评估 JetBrains Mono / Commit Mono 替换 Geist Mono（本页可直接对比数字区分度）',
      '主题切换接入 View Transitions API（Chromium 原生，0 KB）'
    ],
    verify: 'npm run typecheck && npm run build && npm run smoke && npm run verify:themes'
  },
  {
    tier: 'P2',
    title: '需要更强理由才做',
    risk: '高',
    items: [
      '引入第二套图标库（Phosphor 的六字重能表达状态，但会增加体积与风格一致性成本）',
      '替换 UI / 展示字体（现有 Inter + Manrope 组合已经成立，换字体是品牌级决策）',
      '引入 Lottie / Rive（运行时体积大，且循环动画违反设计约束——除非有一次性播放的强需求）'
    ],
    verify: '先在分支上做，跑完整 smoke 与六主题截图对比后再决定'
  }
]

// ── 合规结论 ────────────────────────────────────────────────────────────────
export const COMPLIANCE = [
  {
    topic: 'OFL-1.1 字体',
    verdict: '可以随安装包分发',
    detail: 'OFL 允许嵌入软件再分发，条件是随附许可原文与版权声明。唯一红线是「不能单独售卖字体本身」——Polaris 卖的是应用，不触发。',
    action: '把 OFL-1.1.txt 原文放进 licenses/，并在 NOTICE 里列出每套字体的版权行。',
    risk: 'none'
  },
  {
    topic: 'OFL 的 Reserved Font Name',
    verdict: '子集化不改名就不触发',
    detail: 'OFL 的 RFN 条款只在「修改字体并继续用原名发布」时触发。pyftsubset / cn-font-split 做的是子集化，属于修改；若字体声明了 RFN，切片后必须改名。',
    action: '切片前先看字体 OFL 头部有没有 "with Reserved Font Name"。Noto 系列没有声明 RFN，Inter / Manrope 需逐个确认；拿不准就给切片产物加前缀（如 PolarisNotoSC）。',
    risk: 'attribution-required'
  },
  {
    topic: 'ISC / MIT / Apache-2.0 代码与图标',
    verdict: '可以随安装包分发',
    detail: '三者都要求保留版权与许可声明。Apache-2.0 额外要求标注修改。minify 后的 bundle 通常靠 NOTICE 集中声明满足。',
    action: 'NOTICE 集中列出；Apache-2.0 的素材（MingCute、cn-font-split、@paper-design/shaders）若做了修改要写明。',
    risk: 'none'
  },
  {
    topic: 'CC BY 4.0 图案',
    verdict: '可以，但必须署名',
    detail: 'CC BY 要求在合理位置标注作者、许可链接、是否修改。打进安装包属于再分发，署名义务成立。',
    action: '署名放 NOTICE + 「设置 → 关于」。不想维护署名就改用自绘图案。',
    risk: 'attribution-required'
  },
  {
    topic: '自定义 EULA（MiSans / HarmonyOS Sans / 阿里普惠 / GSAP / unDraw）',
    verdict: '逐个确认，本轮不建议引入',
    detail: '「免费商用」不是开源许可。npm 包声明的 license 字段可能只覆盖打包代码，不覆盖字体/图形本体——misans@5.0.0 的 npm license 写 Apache-2.0，但小米字体本体走的是自己的授权协议。',
    action: '要用之前必须抓官方授权页原文，确认「可否嵌入软件再分发」「可否子集化改名」。本轮全部排除。',
    risk: 'custom-eula'
  },
  {
    topic: 'Remix Icon License 1.0 / Solar',
    verdict: '存疑，本轮不建议引入',
    detail: '@remixicon/react@4.9.0 的 npm license 字段原文是 "Remix Icon License 1.0"，不是常被引用的 Apache-2.0。solar-icons@0.0.15 在 npm 上根本没有 license 字段。',
    action: '两者都需要回到上游仓库确认素材本体的许可，确认前不要进安装包。',
    risk: 'unclear'
  }
]
