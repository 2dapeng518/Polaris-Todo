import type { MessageKey } from './i18n'
import type { AppView } from './types'

// 应用内快捷键注册表（设置「快捷键」页与主窗口按键分发共用的唯一来源）。
// 全局快速添加热键是 OS 级注册，单独走 main/hotkey.ts（meta global_hotkey_accelerator），
// 不在本表内；本表只管应用内按键。defaultKeys 用展示形（'Ctrl+K' / 'N' / 'Ctrl+1'），
// 与键帽渲染、meta 存储同一套字符串。顺序即列表顺序。视图导航默认带 Ctrl 修饰键
// （裸数字键太容易误触 / 撞键）；用户仍可逐行改回裸键。
export type AppShortcutId =
  | 'quick-add'
  | 'command-palette'
  | 'undo'
  | 'view-today'
  | 'view-upcoming'
  | 'view-calendar'
  | 'view-matrix'
  | 'view-all'
  | 'view-completed'
  | 'view-stats'
  | 'view-trash'

export type AppShortcutDef = {
  id: AppShortcutId
  labelKey: MessageKey
  defaultKeys: string
  /** 视图导航快捷键的目标视图；其余快捷键缺省。 */
  view?: AppView
}

export const APP_SHORTCUTS: AppShortcutDef[] = [
  { id: 'quick-add', labelKey: 'shortcut.quickAdd', defaultKeys: 'N' },
  { id: 'command-palette', labelKey: 'shortcut.commandPalette', defaultKeys: 'Ctrl+K' },
  { id: 'undo', labelKey: 'shortcut.undo', defaultKeys: 'Ctrl+Z' },
  { id: 'view-today', labelKey: 'nav.view.today', defaultKeys: 'Ctrl+1', view: 'today' },
  { id: 'view-upcoming', labelKey: 'nav.view.upcoming', defaultKeys: 'Ctrl+2', view: 'upcoming' },
  { id: 'view-calendar', labelKey: 'nav.view.calendar', defaultKeys: 'Ctrl+3', view: 'calendar' },
  { id: 'view-matrix', labelKey: 'nav.view.matrix', defaultKeys: 'Ctrl+4', view: 'matrix' },
  { id: 'view-all', labelKey: 'nav.view.all', defaultKeys: 'Ctrl+5', view: 'all' },
  { id: 'view-completed', labelKey: 'nav.view.completed', defaultKeys: 'Ctrl+6', view: 'completed' },
  { id: 'view-stats', labelKey: 'nav.view.stats', defaultKeys: 'Ctrl+7', view: 'stats' },
  { id: 'view-trash', labelKey: 'nav.view.trash', defaultKeys: 'Ctrl+8', view: 'trash' }
]

export const APP_SHORTCUT_IDS = APP_SHORTCUTS.map((s) => s.id)

export function isAppShortcutId(value: unknown): value is AppShortcutId {
  return typeof value === 'string' && (APP_SHORTCUT_IDS as string[]).includes(value)
}

export function defaultKeysFor(id: AppShortcutId): string {
  return APP_SHORTCUTS.find((s) => s.id === id)?.defaultKeys ?? ''
}

/** 键串 → 键帽数组：'Ctrl+Alt+P' → ['Ctrl','Alt','P']，'N' → ['N']。 */
export function parseKeys(keys: string): string[] {
  return keys.split('+').filter((part) => part.length > 0)
}

const MODIFIERS = new Set(['Ctrl', 'Control', 'Alt', 'Shift', 'Super', 'Cmd', 'Command', 'CommandOrControl'])
const PLAIN_KEY = /^[A-Z0-9]$|^F([1-9]|1[0-9]|2[0-4])$/

/** 应用内快捷键形状校验：末段是字母 / 数字 / F 键，前面是合法修饰键。与全局热键
 *  不同，应用内允许零修饰键的单键（N、1）——它们只在非输入态触发，不抢打字。 */
export function isValidAppKeys(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false
  const parts = parseKeys(value)
  if (parts.length === 0) return false
  if (!PLAIN_KEY.test(parts[parts.length - 1])) return false
  return parts.slice(0, -1).every((part) => MODIFIERS.has(part))
}

/** 归一化展示形：把 Control→Ctrl、Cmd/Command→Super 之类别名收拢，避免同一组合
 *  因写法不同被当成两个键。录制器产出的本就是标准形，这里主要兜底 IPC 载荷。 */
export function normalizeKeys(keys: string): string {
  const parts = parseKeys(keys)
  const main = parts[parts.length - 1]
  const mods = parts.slice(0, -1).map((part) => {
    if (part === 'Control' || part === 'Cmd' || part === 'Command' || part === 'CommandOrControl') return 'Ctrl'
    return part
  })
  // 修饰键去重 + 固定顺序，保证 'Alt+Ctrl+K' 与 'Ctrl+Alt+K' 视为同一组合。
  const order = ['Ctrl', 'Alt', 'Shift', 'Super']
  const unique = [...new Set(mods)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...unique, main].join('+')
}
