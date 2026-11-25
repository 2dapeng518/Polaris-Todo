import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { GlobalHotkeyState } from '@shared/types'
import {
  APP_SHORTCUTS,
  defaultKeysFor,
  normalizeKeys,
  parseKeys,
  type AppShortcutId
} from '@shared/shortcuts'
import { Pencil } from '../Icon'
import { useT } from '../../stores/useLocaleStore'
import { effectiveBindings, useShortcutsStore } from '../../stores/useShortcutsStore'
import { keyNameFromCode } from '../../lib/shortcuts'
import { Switch } from './SettingsRow'

const DEFAULT_GLOBAL = 'Ctrl+Alt+P'
const GLOBAL_ROW = 'global'

/** 键串 → 一排键帽。 */
function Keycaps({ keys, muted }: { keys: string; muted?: boolean }) {
  return (
    <span className={`shortcut-keys${muted ? ' is-muted' : ''}`}>
      {parseKeys(keys).map((part, index) => (
        <kbd key={`${part}-${index}`} className="shortcut-keycap">{part}</kbd>
      ))}
    </span>
  )
}

// 「快捷键」页：清单式列表——一行一个快捷键，左动作名、右键帽、最右编辑铅笔。
// 全局快速添加居首（OS 级注册，走 main/hotkey.ts，带启用开关），其余应用内快捷键
// 走注册表 + meta 覆盖。点铅笔该行进入内联录制：按下新组合即换绑（应用内先查冲突，
// 全局要求强修饰键），Esc 取消；录制态附「恢复默认」。改键落库后主窗口 focus 时重拉生效。
export function ShortcutsSection() {
  const t = useT()
  const overrides = useShortcutsStore((state) => state.overrides)
  const loadShortcuts = useShortcutsStore((state) => state.load)
  const setBinding = useShortcutsStore((state) => state.setBinding)
  const [globalHotkey, setGlobalHotkey] = useState<GlobalHotkeyState>({
    enabled: true,
    registered: true,
    accelerator: DEFAULT_GLOBAL
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const recorderRef = useRef<HTMLDivElement>(null)

  // 进页拉应用内覆盖 + 全局热键状态。
  useEffect(() => {
    void loadShortcuts()
    let cancelled = false
    window.polaris.app
      .getGlobalHotkey()
      .then((value) => {
        if (!cancelled) setGlobalHotkey(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loadShortcuts])

  // 进入录制态即聚焦录制框，按键直接开始录入。
  useEffect(() => {
    if (editingId) recorderRef.current?.focus()
  }, [editingId])

  const beginEdit = (id: string) => {
    setEditingId(id)
    setRecordError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setRecordError(null)
  }

  const toggleGlobal = async () => {
    const next = !globalHotkey.enabled
    setGlobalHotkey((current) => ({ ...current, enabled: next, error: undefined }))
    try {
      setGlobalHotkey(await window.polaris.app.setGlobalHotkey(next))
    } catch {
      setGlobalHotkey((current) => ({ ...current, enabled: !next }))
    }
  }

  // 换绑统一入口：全局走 hotkey 后端（注册失败回滚并报错），应用内走 setShortcut。
  const applyKeys = async (id: string, keys: string) => {
    if (id === GLOBAL_ROW) {
      const next = await window.polaris.app.setGlobalHotkeyAccelerator(keys)
      setGlobalHotkey(next)
      if (next.error) {
        setRecordError(t('settings.hotkeyApplyFailed', { error: next.error }))
        return
      }
    } else {
      await setBinding(id as AppShortcutId, keys)
    }
    setEditingId(null)
    setRecordError(null)
  }

  const resetRow = async (id: string) => {
    if (id === GLOBAL_ROW) {
      setGlobalHotkey(await window.polaris.app.setGlobalHotkeyAccelerator(DEFAULT_GLOBAL))
    } else {
      await setBinding(id as AppShortcutId, defaultKeysFor(id as AppShortcutId))
    }
    setEditingId(null)
    setRecordError(null)
  }

  const onRecordKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    // 纯 Esc：取消录制（停传播，避免误关设置窗口）。
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
      return
    }
    const key = keyNameFromCode(event.code)
    if (!key) return
    event.preventDefault()
    event.stopPropagation()

    const isGlobal = editingId === GLOBAL_ROW
    const modifiers: string[] = []
    if (event.ctrlKey) modifiers.push('Ctrl')
    if (event.altKey) modifiers.push('Alt')
    if (event.shiftKey) modifiers.push('Shift')
    if (event.metaKey) modifiers.push('Super')
    // 全局热键必须含强修饰键（Ctrl/Alt/Win）；应用内允许单键。
    if (isGlobal && !event.ctrlKey && !event.altKey && !event.metaKey) {
      setRecordError(t('settings.hotkeyNeedModifier'))
      return
    }
    const keys = normalizeKeys([...modifiers, key].join('+'))
    // 应用内冲突检测：新组合不能与另一个应用内快捷键的生效绑定相同。
    if (!isGlobal && editingId) {
      const bindings = effectiveBindings(overrides)
      const clash = APP_SHORTCUTS.find((def) => def.id !== editingId && bindings[def.id] === keys)
      if (clash) {
        setRecordError(t('shortcut.conflict', { name: t(clash.labelKey) }))
        return
      }
    }
    if (editingId) void applyKeys(editingId, keys)
  }

  const rows = [
    { id: GLOBAL_ROW, label: t('shortcut.globalQuickAdd'), keys: globalHotkey.accelerator, isGlobal: true },
    ...APP_SHORTCUTS.map((def) => ({
      id: def.id as string,
      label: t(def.labelKey),
      keys: overrides[def.id] ?? def.defaultKeys,
      isGlobal: false
    }))
  ]

  return (
    <section className="settings-card shortcut-list-card">
      <div className="shortcut-list">
        {rows.map((row) => {
          const editing = editingId === row.id
          const globalError = row.isGlobal && globalHotkey.enabled && globalHotkey.error
          return (
            <div key={row.id} className={`shortcut-row${editing ? ' is-editing' : ''}`} data-shortcut-row={row.id}>
              <span className="shortcut-label">{row.label}</span>

              {editing ? (
                <span className="shortcut-recording">
                  <div
                    ref={recorderRef}
                    className={`shortcut-recorder${recordError ? ' is-error' : ''}`}
                    tabIndex={0}
                    role="textbox"
                    aria-label={t('shortcut.recordHint')}
                    title={t('shortcut.recordHint')}
                    onKeyDown={onRecordKeyDown}
                  >
                    {recordError ?? t('shortcut.recordHint')}
                  </div>
                  <button className="shortcut-reset" onClick={() => void resetRow(row.id)}>
                    {t('settings.hotkeyResetDefault')}
                  </button>
                </span>
              ) : (
                <Keycaps keys={row.keys} muted={row.isGlobal && !globalHotkey.enabled} />
              )}

              <span className="shortcut-row-actions">
                {row.isGlobal && (
                  <Switch
                    checked={globalHotkey.enabled}
                    label={t('shortcut.globalQuickAdd')}
                    onToggle={() => void toggleGlobal()}
                  />
                )}
                <button
                  className="shortcut-edit"
                  aria-label={t('shortcut.editAria', { name: row.label })}
                  title={t('shortcut.editAria', { name: row.label })}
                  onClick={() => (editing ? cancelEdit() : beginEdit(row.id))}
                >
                  <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </span>

              {globalError && (
                <span className="shortcut-row-error" role="alert">{globalHotkey.error}</span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
