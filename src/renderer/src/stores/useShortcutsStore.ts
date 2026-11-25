import { create } from 'zustand'
import { APP_SHORTCUTS, defaultKeysFor, type AppShortcutId } from '@shared/shortcuts'

// 应用内快捷键绑定：overrides 只存改过的（主进程 meta app_shortcuts），生效值 =
// 覆盖 ?? 注册表默认。主窗口与设置窗口是各自独立的渲染进程，各持一份 store：
// 主窗口 mount + 每次 focus 重拉（设置窗口改完键，回到主窗口即生效）；设置窗口
// 打开快捷键页时拉取，改键后就地更新并落库。
type ShortcutsState = {
  overrides: Record<string, string>
  load: () => Promise<void>
  setBinding: (id: AppShortcutId, keys: string) => Promise<void>
}

export const useShortcutsStore = create<ShortcutsState>((set) => ({
  overrides: {},

  load: async () => {
    try {
      set({ overrides: await window.polaris.app.getShortcuts() })
    } catch {
      // 拿不到覆盖就用默认，快捷键系统不因一次 IPC 失效停摆。
    }
  },

  setBinding: async (id, keys) => {
    set({ overrides: await window.polaris.app.setShortcut(id, keys) })
  }
}))

/** 订阅某个快捷键的生效键串（覆盖变化即重渲染，按键监听随之重挂）。 */
export function useShortcutKeys(id: AppShortcutId): string {
  return useShortcutsStore((state) => state.overrides[id] ?? defaultKeysFor(id))
}

/** 全部生效绑定（冲突检测用）：id → 键串。 */
export function effectiveBindings(overrides: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const def of APP_SHORTCUTS) out[def.id] = overrides[def.id] ?? def.defaultKeys
  return out
}
