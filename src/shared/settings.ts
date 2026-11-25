// 设置窗口的分类注册表：主进程（IPC 载荷白名单 + 路由 hash）与渲染层
// （左侧导航 + 当前页）共用的唯一来源。顺序即导航顺序，「关于」固定在最后。
export const SETTINGS_SECTIONS = ['appearance', 'general', 'hotkey', 'data', 'mcp', 'about'] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** 默认落在第一页；主窗口侧栏的「关于」入口直接定位到最后一页。 */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'appearance'

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

/** 主进程 → 设置窗口的切页事件（executeJavaScript 派发的固定字符串事件，同 polaris:quick-add）。 */
export const SETTINGS_SECTION_EVENT = 'polaris:settings-section'

/** 设置窗口的渲染入口 hash：#/settings/<分类>。渲染层启动时据此定初始页。 */
export function settingsSectionFromHash(hash: string): SettingsSection | null {
  const match = hash.match(/^#\/?settings(?:\/([a-z]+))?$/)
  return match ? (isSettingsSection(match[1]) ? match[1] : DEFAULT_SETTINGS_SECTION) : null
}
