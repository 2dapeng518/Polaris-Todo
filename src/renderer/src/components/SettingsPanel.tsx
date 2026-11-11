import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import type { AutoStartState } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useFocusTrap } from '../lib/useFocusTrap'

type SettingsPanelProps = {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [autoStart, setAutoStart] = useState<AutoStartState>({
    enabled: false,
    supported: true
  })
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  useFocusTrap(panelRef, open && !paletteOpen, panelRef)

  useEffect(() => {
    if (open && paletteOpen) onClose()
  }, [open, paletteOpen, onClose])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBusy(true)

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
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || paletteOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, paletteOpen, onClose])

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={onClose}
        >
          <motion.div
            className="settings-panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <div>
                <div className="settings-eyebrow">Polaris</div>
                <h2 className="settings-title">设置</h2>
              </div>
              <button className="detail-close" onClick={onClose} aria-label="关闭设置">
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">开机自启</div>
                  <div className="settings-row-desc">
                    登录 Windows 后在后台启动 Polaris，提醒不会错过
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={autoStart.enabled}
                  aria-label="开机自启"
                  className={`switch ${autoStart.enabled ? 'on' : ''}`}
                  onClick={() => void toggleAutoStart()}
                  disabled={busy || !autoStart.supported}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              {autoStart.error && (
                <div className="settings-error" role="alert">
                  设置失败：{autoStart.error}
                </div>
              )}
              {!autoStart.supported && (
                <div className="settings-hint">
                  当前环境不支持开机自启；打包安装到 Windows 后可用
                </div>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">关闭窗口后驻留托盘</div>
                  <div className="settings-row-desc">
                    关闭主窗口不会退出，提醒与托盘常驻继续运行
                  </div>
                </div>
                <span className="settings-static">已开启</span>
              </div>
            </div>

            <div className="settings-footer">Polaris 0.1 · 数据保存在本机</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}