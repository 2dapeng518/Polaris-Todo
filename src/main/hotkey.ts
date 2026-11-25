import { globalShortcut } from 'electron'
import type { GlobalHotkeyState } from '../shared/types'
import { getMeta, setMeta } from './db'

// 全局热键的唯一所有者。meta 记两件事（都不进迁移）：
// - global_hotkey：用户想不想开（默认开，只有明确写过 '0' 才算关掉）；
// - global_hotkey_accelerator：用户自定义组合（缺省键走默认 Ctrl+Alt+P）。
// 注册结果单独放内存：组合被别的程序占用时开关仍是开（用户意图），registered
// 才是 false。accelerator 全程用展示形（'Ctrl+Alt+P'）——'Ctrl' 是 Electron
// 'Control' 的合法别名，注册时原样可用，一套字符串两边不打架。
export const GLOBAL_HOTKEY_ACCELERATOR = 'Ctrl+Alt+P'

const META_KEY = 'global_hotkey'
const META_ACCELERATOR = 'global_hotkey_accelerator'

const MODIFIERS = new Set(['Ctrl', 'Control', 'Alt', 'Shift', 'Super', 'Cmd', 'Command', 'CommandOrControl'])
const PLAIN_KEY = /^[A-Z0-9]$|^F([1-9]|1[0-9]|2[0-4])$/

function occupiedError(accelerator: string): string {
  return `快捷键 ${accelerator} 被其他程序占用`
}

/** 形状校验：至少一个强修饰键（Ctrl/Alt/Cmd/Super，纯 Shift 不算——Shift+字母
 *  是打字键）加一个字母 / 数字 / F 键；渲染层录制器只会产出这种形状，IPC 载荷
 *  也按同一把尺子拒绝。 */
function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false
  const parts = value.split('+')
  if (parts.length < 2 || parts.some((part) => part.length === 0)) return false
  if (!PLAIN_KEY.test(parts[parts.length - 1])) return false
  let hasStrongModifier = false
  for (const part of parts.slice(0, -1)) {
    if (!MODIFIERS.has(part)) return false
    if (part !== 'Shift') hasStrongModifier = true
  }
  return hasStrongModifier
}

function currentAccelerator(): string {
  const stored = getMeta(META_ACCELERATOR)
  return isValidAccelerator(stored) ? stored : GLOBAL_HOTKEY_ACCELERATOR
}

let handler: (() => void) | null = null
let registered = false
let lastError: string | null = null

function enabledInMeta(): boolean {
  return getMeta(META_KEY) !== '0'
}

function state(): GlobalHotkeyState {
  return {
    enabled: enabledInMeta(),
    registered,
    accelerator: currentAccelerator(),
    ...(lastError ? { error: lastError } : {})
  }
}

// 不看 globalShortcut.isRegistered：那个查询回答的是「这个应用注册过吗」，
// 测试里手动占位的注册也会让它为 true，从而把「被别人占用」误判成成功。
// registered 只记录本模块自己成功注册的那一次。
function tryRegister(accelerator: string): boolean {
  if (!handler) return false
  try {
    return globalShortcut.register(accelerator, handler)
  } catch {
    return false
  }
}

function apply(): GlobalHotkeyState {
  if (!enabledInMeta()) {
    if (registered) {
      globalShortcut.unregister(currentAccelerator())
      registered = false
    }
    lastError = null
    return state()
  }

  if (registered) return state()
  if (!handler) return state()

  registered = tryRegister(currentAccelerator())
  lastError = registered ? null : occupiedError(currentAccelerator())
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

/** 自定义组合。关闭态直接落盘（下次开启生效）；开启且当前注册成功时先换绑
 *  再落盘——新组合注册失败立刻回滚旧组合并报错，热键不中断、meta 不留死值。
 *  开启但当前本就没注册成功（组合被占）时：落盘新组合后立即尝试注册——
 *  用户挑一个空闲组合保存，正好把「被占用」的报错当场治好。 */
export function setGlobalHotkeyAccelerator(next: unknown): GlobalHotkeyState {
  if (!isValidAccelerator(next)) {
    lastError = '快捷键格式无效：需要 Ctrl / Alt / Win 加一个字母、数字或 F 键'
    return state()
  }
  const prev = currentAccelerator()
  if (next === prev) return state()

  if (enabledInMeta() && registered) {
    globalShortcut.unregister(prev)
    registered = false
    if (tryRegister(next)) {
      registered = true
      lastError = null
      setMeta(META_ACCELERATOR, next)
      return state()
    }
    // 回滚：旧组合此刻恰好也被别人占住（极小窗口）时如实记录。
    registered = tryRegister(prev)
    lastError = registered ? occupiedError(next) : occupiedError(prev)
    return state()
  }

  setMeta(META_ACCELERATOR, next)
  lastError = null
  return apply()
}

/** 候选可用性探测（设置对话框的「推荐组合」）：当前组合视作可用（改回自己
 *  是 no-op——我们自己注册着它，试注册必然失败，不能误报「已占用」）；其余
 *  候选试注册即注销，探完不留注册痕迹。 */
export function probeHotkeyAccelerators(candidates: string[]): Array<{ accelerator: string; free: boolean }> {
  const current = currentAccelerator()
  return candidates.filter(isValidAccelerator).map((candidate) => {
    if (candidate === current) return { accelerator: candidate, free: true }
    let free = false
    try {
      free = globalShortcut.register(candidate, () => {})
      if (free) globalShortcut.unregister(candidate)
    } catch {
      free = false
    }
    return { accelerator: candidate, free }
  })
}

export function getGlobalHotkeyState(): GlobalHotkeyState {
  return state()
}

/** will-quit 里调用；注销不抛错，也不把 meta 写回去。 */
export function disposeGlobalHotkey(): void {
  if (registered) {
    globalShortcut.unregister(currentAccelerator())
    registered = false
  }
  handler = null
}
