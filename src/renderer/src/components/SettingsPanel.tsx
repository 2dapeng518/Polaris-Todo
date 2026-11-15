import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from './Icon'
import type { AutoStartState } from '@shared/types'
import { THEME_META, THEME_ORDER } from '@shared/themes'
import { useTaskStore } from '../stores/useTaskStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useAppVersion } from '../stores/useAppVersion'
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
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  // 打开时才取；与主界面页脚共用同一份版本号，取到就不再请求，失败下次打开重试。
  const version = useAppVersion(open)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

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

  const handleExport = async () => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.data.export()
      if (result.saved) setBackupStatus('已导出备份文件')
      else if (result.error) setBackupError(`导出失败：${result.error}`)
    } catch (error) {
      setBackupError(`导出失败：${String(error)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  const handleImport = async () => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.data.import()
      if (result.ok) {
        setBackupStatus(
          `导入完成：任务 +${result.tasksImported ?? 0}（跳过 ${result.tasksSkipped ?? 0}），项目 +${result.projectsImported ?? 0}（跳过 ${result.projectsSkipped ?? 0}）`
        )
        // 导入的数据要立刻反映到主界面：刷新活任务与回收站两个独立存储。
        await useTaskStore.getState().load()
        await useTaskStore.getState().loadTrash()
      } else if (!result.canceled && result.error) {
        setBackupError(`导入失败：${result.error}`)
      }
    } catch (error) {
      setBackupError(`导入失败：${String(error)}`)
    } finally {
      setBackupBusy(false)
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
              <div className="settings-row-title">颜色主题</div>
              <div className="settings-row-desc theme-section-desc">
                六套克制配色，切换即时生效并自动保存；信号色统一，画布各有气质
              </div>
              <div className="theme-picker" role="group" aria-label="颜色主题">
                {THEME_ORDER.map((id) => {
                  const meta = THEME_META[id]
                  const selected = theme === id
                  return (
                    <button
                      key={id}
                      type="button"
                      data-theme-option={id}
                      aria-pressed={selected}
                      className={`theme-option ${selected ? 'selected' : ''}`}
                      onClick={() => setTheme(id)}
                    >
                      <span className="theme-swatch" aria-hidden="true" style={{ background: meta.swatch[0] }}>
                        <span className="theme-swatch-surface" style={{ background: meta.swatch[1] }} />
                        <span className="theme-swatch-dot" style={{ background: meta.swatch[2] }} />
                      </span>
                      <span className="theme-option-text">
                        <span className="theme-option-label">
                          {meta.label}
                          <span className="theme-family-tag">{meta.family === 'dark' ? '深色' : '浅色'}</span>
                        </span>
                        <span className="theme-option-desc">{meta.desc}</span>
                      </span>
                      {selected && (
                        <span className="theme-option-check" aria-hidden="true">
                          <Check size={15} strokeWidth={2} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
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

            <div className="settings-section">
              <div className="settings-row-title">数据备份</div>
              <div className="settings-row-desc">
                导出全部项目与任务（含回收站）为 JSON；导入按 ID 合并，不覆盖现有数据
              </div>
              <div className="backup-actions">
                <button className="backup-btn" onClick={() => void handleExport()} disabled={backupBusy}>
                  导出备份
                </button>
                <button className="backup-btn" onClick={() => void handleImport()} disabled={backupBusy}>
                  导入备份
                </button>
              </div>
              {backupStatus && (
                <div className="settings-hint" role="status">{backupStatus}</div>
              )}
              {backupError && (
                <div className="settings-error" role="alert">{backupError}</div>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-row-title">关于</div>
              <div className="settings-row-desc">
                Polaris{version ? ` · 版本 ${version}` : ''} · MIT 许可
              </div>
              <div className="about-credits">
                <div className="about-credit-row">
                  <span className="about-credit-label">字体</span>
                  <span className="about-credit-value">Inter · Manrope · Noto Sans SC · Geist Mono（SIL OFL 1.1）</span>
                </div>
                <div className="about-credit-row">
                  <span className="about-credit-label">图标</span>
                  <span className="about-credit-value">Lucide（ISC / MIT）</span>
                </div>
                <div className="about-credit-note">
                  完整第三方声明见安装目录 resources/NOTICE 与 resources/licenses/
                </div>
              </div>
            </div>

            <div className="settings-footer">
              {version && (
                <>
                  版本 <span className="settings-version">{version}</span>
                  {' · '}
                </>
              )}
              数据仅保存在本机
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
