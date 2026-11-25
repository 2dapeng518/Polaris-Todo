import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { AutoStartState, GlobalHotkeyState } from '@shared/types'
import { useT } from '../../stores/useLocaleStore'
import { SettingsRow, Switch } from './SettingsRow'
import { HotkeyDialog } from './HotkeyDialog'

// 「常规」：开机自启 / 关窗驻托盘 / 全局快速添加。三个开关的行为与设置还是
// 浮层面板时逐条一致，只是各自成行、住在独立窗口的一页里。
export function GeneralSection() {
  const t = useT()
  const [autoStart, setAutoStart] = useState<AutoStartState>({
    enabled: false,
    supported: true
  })
  const [busy, setBusy] = useState(false)
  const [closeToTray, setCloseToTray] = useState(true)
  const [hotkey, setHotkey] = useState<GlobalHotkeyState>({
    enabled: true,
    registered: true,
    accelerator: 'Ctrl+Alt+P'
  })
  // 快捷键自定义对话框：保存（含换绑失败）都回传最新状态刷新行描述。
  const [hotkeyDialogOpen, setHotkeyDialogOpen] = useState(false)

  // 进入本页时取一次当前值（廉价 IPC）；离开页面即作废迟到的回执。
  useEffect(() => {
    let cancelled = false

    window.polaris.app
      .getAutoStart()
      .then((state) => {
        if (!cancelled) setAutoStart(state)
      })
      .catch((error) => {
        if (!cancelled) {
          setAutoStart({ enabled: false, supported: false, error: String(error) })
        }
      })

    window.polaris.app
      .getCloseToTray()
      .then((value) => {
        if (!cancelled) setCloseToTray(value)
      })
      .catch(() => {
        if (!cancelled) setCloseToTray(true)
      })

    window.polaris.app
      .getGlobalHotkey()
      .then((value) => {
        if (!cancelled) setHotkey(value)
      })
      .catch((error) => {
        if (!cancelled) {
          setHotkey((current) => ({ ...current, error: String(error) }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const toggleAutoStart = async () => {
    if (busy || !autoStart.supported) return
    setBusy(true)

    try {
      const next = await window.polaris.app.setAutoStart(!autoStart.enabled)
      setAutoStart(next)
    } catch (error) {
      setAutoStart((current) => ({ ...current, error: String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const toggleCloseToTray = async () => {
    const next = !closeToTray
    setCloseToTray(next)
    try {
      await window.polaris.app.setCloseToTray(next)
    } catch {
      setCloseToTray(!next)
    }
  }

  const toggleHotkey = async () => {
    const next = !hotkey.enabled
    setHotkey((current) => ({ ...current, enabled: next, error: undefined }))
    try {
      setHotkey(await window.polaris.app.setGlobalHotkey(next))
    } catch {
      setHotkey((current) => ({ ...current, enabled: !next }))
    }
  }

  // 描述：错误/不支持替换正常文案落同一行（alert 换色，全文另进 title）。
  const autoStartDesc = autoStart.error
    ? t('settings.autoStartError', { error: autoStart.error })
    : !autoStart.supported
      ? t('settings.autoStartUnsupported')
      : t('settings.autoStartDesc')
  const hotkeyDesc =
    hotkey.enabled && hotkey.error
      ? t('settings.hotkeyError', { error: hotkey.error })
      : hotkey.enabled
        ? t('settings.hotkeyOn', { accelerator: hotkey.accelerator })
        : t('settings.hotkeyOff')

  return (
    <>
    <section className="settings-card">
      <SettingsRow title={t('settings.autoStart')} desc={autoStartDesc} alert={Boolean(autoStart.error) || !autoStart.supported}>
        <Switch
          checked={autoStart.enabled}
          label={t('settings.autoStart')}
          disabled={busy || !autoStart.supported}
          onToggle={() => void toggleAutoStart()}
        />
      </SettingsRow>
      <SettingsRow title={t('settings.tray')} desc={closeToTray ? t('settings.trayOn') : t('settings.trayOff')}>
        <Switch checked={closeToTray} label={t('settings.tray')} onToggle={() => void toggleCloseToTray()} />
      </SettingsRow>
      {/* 热键行右侧一组两个控件：修改入口 + 开关。组合被占用（行描述落红）
          时，「修改快捷键…」就是当场出路：对话框里探测推荐的空闲组合。 */}
      <SettingsRow title={t('settings.hotkey')} desc={hotkeyDesc} alert={Boolean(hotkey.enabled && hotkey.error)}>
        <div className="settings-row-actions">
          <button
            className="backup-btn backup-btn--small settings-row-btn-sm"
            onClick={() => setHotkeyDialogOpen(true)}
          >
            {t('settings.hotkeyChange')}
          </button>
          <Switch checked={hotkey.enabled} label={t('settings.hotkey')} onToggle={() => void toggleHotkey()} />
        </div>
      </SettingsRow>
    </section>

    <AnimatePresence>
      {hotkeyDialogOpen && (
        <HotkeyDialog
          accelerator={hotkey.accelerator}
          onApplied={(next) => setHotkey(next)}
          onClose={() => setHotkeyDialogOpen(false)}
        />
      )}
    </AnimatePresence>
    </>
  )
}
