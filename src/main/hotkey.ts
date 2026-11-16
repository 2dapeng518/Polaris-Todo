import { globalShortcut } from 'electron'
import type { GlobalHotkeyState } from '../shared/types'
import { getMeta, setMeta } from './db'

// 全局热键的唯一所有者。meta 只记「用户想不想开」，注册结果单独放在内存里：
// 组合键被别的程序占用时，开关仍是开（用户的意图），registered 才是 false。
export const GLOBAL_HOTKEY_ACCELERATOR = 'Control+Alt+P'
export const GLOBAL_HOTKEY_LABEL = 'Ctrl+Alt+P'

const META_KEY = 'global_hotkey'
const OCCUPIED_ERROR = `快捷键 ${GLOBAL_HOTKEY_LABEL} 被其他程序占用`

let handler: (() => void) | null = null
let registered = false
let lastError: string | null = null

function enabledInMeta(): boolean {
  // 默认开：只有明确写过 '0' 才算用户关掉了它。
  return getMeta(META_KEY) !== '0'
}

function state(): GlobalHotkeyState {
  return {
    enabled: enabledInMeta(),
    registered,
    accelerator: GLOBAL_HOTKEY_LABEL,
    ...(lastError ? { error: lastError } : {})
  }
}

// 不看 globalShortcut.isRegistered：那个查询回答的是「这个应用注册过吗」，
// 测试里手动占位的注册也会让它为 true，从而把「被别人占用」误判成成功。
// registered 只记录本模块自己成功注册的那一次。
function apply(): GlobalHotkeyState {
  if (!enabledInMeta()) {
    if (registered) {
      globalShortcut.unregister(GLOBAL_HOTKEY_ACCELERATOR)
      registered = false
    }
    lastError = null
    return state()
  }

  if (registered) return state()
  if (!handler) return state()

  let ok = false
  try {
    ok = globalShortcut.register(GLOBAL_HOTKEY_ACCELERATOR, handler)
  } catch {
    ok = false
  }
  registered = ok
  lastError = ok ? null : OCCUPIED_ERROR
  return state()
}

/** app.whenReady() 里、窗口与托盘就绪后调用一次。 */
export function initGlobalHotkey(onTrigger: () => void): GlobalHotkeyState {
  handler = onTrigger
  return apply()
}

/** 先落库再注册：注册失败时用户的「开」仍然被记住，下次启动或再点一次会重试。 */
export function setGlobalHotkeyEnabled(enabled: boolean): GlobalHotkeyState {
  setMeta(META_KEY, enabled ? '1' : '0')
  return apply()
}

export function getGlobalHotkeyState(): GlobalHotkeyState {
  return state()
}

/** will-quit 里调用；注销不抛错，也不把 meta 写回去。 */
export function disposeGlobalHotkey(): void {
  if (registered) {
    globalShortcut.unregister(GLOBAL_HOTKEY_ACCELERATOR)
    registered = false
  }
  handler = null
}