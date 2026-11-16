// Polaris 主题注册表：纯模块，无 DOM / Node 依赖，主进程、渲染器与预加载共享。
// 设计原则：品牌信号色（teal）色相在所有主题中保持一致，主题改变的是 ambient 画布
// （中性色阶的温度与色相）与克制的次要点缀色，以此体现「克制统一的高级感」。
// 浅色家族的 teal 按画布明度微调深浅（暖砂/天蓝画布更深，信号色随之略深）以保 WCAG AA。
// 三深三浅按色系成对：夜阑↔昼白（中性）、暮蓝↔天蓝（蓝）、护眼绿↔暖砂（墨绿/燕麦）。
// 画布之间必须拉开可感知的色差（ΔE00 ≥ 10）：近黑画布上的微弱色相偏移人眼几乎不可见。

export type AppTheme = 'dark' | 'light' | 'dusk' | 'sand' | 'sky' | 'green'
export type ThemeFamily = 'dark' | 'light'

// 选择器与命令面板的展示顺序：逐对成行（深在前浅在后），两列网格每行即一对。
export const THEME_ORDER: AppTheme[] = ['dark', 'light', 'dusk', 'sky', 'green', 'sand']

export type ThemeMeta = {
  label: string
  family: ThemeFamily
  desc: string
  // 主题卡片预览色：[画布, surface, 信号色]
  swatch: [string, string, string]
}

export const THEME_META: Record<AppTheme, ThemeMeta> = {
  dark: { label: '夜阑', family: 'dark', desc: '冷墨夜色 · 经典深色', swatch: ['#080a0f', '#151821', '#5eead4'] },
  light: { label: '昼白', family: 'light', desc: '暖瓷白昼 · 经典浅色', swatch: ['#f4f3ef', '#ffffff', '#0f766e'] },
  dusk: { label: '暮蓝', family: 'dark', desc: '深邃蓝调 · 沉静夜色', swatch: ['#132644', '#1e3760', '#5eead4'] },
  sand: { label: '暖砂', family: 'light', desc: '燕麦暖砂 · 柔和白昼', swatch: ['#ece0c6', '#fffaf2', '#0d6e66'] },
  sky: { label: '天蓝', family: 'light', desc: '晴空天蓝 · 清透白昼', swatch: ['#dceaf6', '#ffffff', '#0d6e66'] },
  green: { label: '护眼绿', family: 'dark', desc: '墨绿护眼 · 沉静夜色', swatch: ['#10241a', '#163022', '#5eead4'] }
}

// 窗口首帧背景色，必须与 globals.css 中各主题的 --bg 完全一致。
export const THEME_WINDOW_BG: Record<AppTheme, string> = {
  dark: '#080A0F',
  light: '#F4F3EF',
  dusk: '#132644',
  sand: '#ECE0C6',
  sky: '#DCEAF6',
  green: '#10241A'
}

// 原生标题栏按钮符号色按家族区分（深/浅），与现有取值保持一致。
export const THEME_SYMBOL_COLOR: Record<ThemeFamily, string> = {
  dark: '#9CA3AF',
  light: '#4B5563'
}

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'light' || value === 'dusk' || value === 'sand' || value === 'sky' || value === 'green'
}

export function themeFamily(theme: AppTheme): ThemeFamily {
  return THEME_META[theme].family
}

// 标题栏快捷切换是对合（自身的逆）：dark↔light、dusk↔sky、green↔sand。
// 这保证「连点两次回到原主题」这一不变量对全部主题成立，冒烟测试据此校验。
// 三对全部跨家族：每对一深一浅，快切即深浅互换。
export function partnerTheme(theme: AppTheme): AppTheme {
  switch (theme) {
    case 'dark': return 'light'
    case 'light': return 'dark'
    case 'dusk': return 'sky'
    case 'sky': return 'dusk'
    case 'green': return 'sand'
    case 'sand': return 'green'
  }
}
