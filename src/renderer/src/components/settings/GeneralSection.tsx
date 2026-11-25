import { useEffect, useState } from 'react'
import type { AutoStartState } from '@shared/types'
import { useT } from '../../stores/useLocaleStore'
import { SettingsRow, Switch } from './SettingsRow'

// 「常规」：开机自启 / 关窗驻托盘。全局快速添加的开关与自定义已抽到独立的
// 「快捷键」分类页（HotkeySection），这里不再承载热键。
export function GeneralSection() {
  const t = useT()
  const [autoStart, setAutoStart] = useState<AutoStartState>({
    enabled: false,
    supported: true
  })
  const [busy, setBusy] = useState(false)
  const [closeToTray, setCloseToTray] = useState(true)

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

  // 描述：错误/不支持替换正常文案落同一行（alert 换色，全文另进 title）。
  const autoStartDesc = autoStart.error
    ? t('settings.autoStartError', { error: autoStart.error })
    : !autoStart.supported
      ? t('settings.autoStartUnsupported')
      : t('settings.autoStartDesc')

  return (
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
    </section>
  )
}
