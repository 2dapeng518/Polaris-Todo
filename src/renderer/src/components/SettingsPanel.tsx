import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from './Icon'
import type { AutoStartState, GlobalHotkeyState, McpState, UpdateState } from '@shared/types'
import { THEME_META, THEME_ORDER } from '@shared/themes'
import { themeDesc, themeLabel } from '@shared/i18n'
import { useTaskStore } from '../stores/useTaskStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useAppVersion } from '../stores/useAppVersion'
import { useUpdateStore } from '../stores/useUpdateStore'
import { useLocaleStore, useT, useLocale, type Translate } from '../stores/useLocaleStore'
import { useFocusTrap } from '../lib/useFocusTrap'

/** 更新状态一行说清；错误细节另有 settings-error，这里不堆长文。 */
function updateStatusText(state: UpdateState | null, t: Translate): string {
  if (!state) return t('settings.update.idle')
  switch (state.status) {
    case 'unsupported':
      return t('settings.update.unsupported')
    case 'checking':
      return t('settings.update.checking')
    case 'available':
      return t('settings.update.available', { version: state.latestVersion ?? '' })
    case 'downloading':
      return t('settings.update.downloading', {
        version: state.latestVersion ?? '',
        percent: state.percent ?? 0
      })
    case 'downloaded':
      return t('settings.update.downloaded', { version: state.latestVersion ?? '' })
    case 'up-to-date':
      return t('settings.update.upToDate')
    case 'error':
      return t('settings.update.error')
    default:
      return t('settings.update.idle')
  }
}

type SettingsPanelProps = {
  open: boolean
  onClose: () => void
  /** 侧栏存储卡片进来时直达备份区；普通入口为 null，停在顶部。 */
  scrollTo?: 'backup' | null
}

export function SettingsPanel({ open, onClose, scrollTo = null }: SettingsPanelProps) {
  const t = useT()
  const locale = useLocale()
  const setLocale = useLocaleStore((state) => state.setLocale)
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
  const [closeToTray, setCloseToTray] = useState(true)
  const [hotkey, setHotkey] = useState<GlobalHotkeyState>({
    enabled: true,
    registered: true,
    accelerator: 'Ctrl+Alt+P'
  })
  const [mcp, setMcp] = useState<McpState>({
    enabled: false,
    running: false,
    endpoint: 'http://127.0.0.1:3737/mcp'
  })
  const update = useUpdateStore((state) => state.state)
  const checkUpdate = useUpdateStore((state) => state.check)
  const openUpdateDialog = useUpdateStore((state) => state.openDialog)
  const [updateChecking, setUpdateChecking] = useState(false)
  // 手动点过检查才展示状态行：dev 的 unsupported 默认不占面板高度。
  const [updateAsked, setUpdateAsked] = useState(false)

  const updateDialogOpen = useUpdateStore((state) => state.dialogOpen)

  // 更新弹窗可能叠在设置面板上（「查看更新」）：焦点陷阱让位，别互相抢。
  useFocusTrap(panelRef, open && !paletteOpen && !updateDialogOpen, panelRef)

  useEffect(() => {
    if (open && paletteOpen) onClose()
  }, [open, paletteOpen, onClose])

  // 直达备份区：等入场弹簧落定再滚，滚动发生在面板自己的 overflow 容器里。
  useEffect(() => {
    if (!open || scrollTo !== 'backup') return
    const timer = setTimeout(() => {
      panelRef.current
        ?.querySelector('.backup-actions')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 350)
    return () => clearTimeout(timer)
  }, [open, scrollTo])

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

    window.polaris.app
      .getMcp()
      .then((value) => {
        if (!cancelled) setMcp(value)
      })
      .catch((error) => {
        if (!cancelled) {
          setMcp((current) => ({ ...current, error: String(error) }))
        }
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

  const toggleMcp = async () => {
    const next = !mcp.enabled
    setMcp((current) => ({ ...current, enabled: next, error: undefined }))
    try {
      setMcp(await window.polaris.app.setMcp(next))
    } catch {
      setMcp((current) => ({ ...current, enabled: !next }))
    }
  }

  const handleCheckUpdate = async () => {
    setUpdateChecking(true)
    setUpdateAsked(true)
    try {
      // 手动检查忽略「跳过此版本」；发现新版时 store 会顺手拉起更新弹窗。
      await checkUpdate()
    } catch {
      // 主进程会把 error 快照推回来，这里不另造一份错误文案。
    } finally {
      setUpdateChecking(false)
    }
  }

  const handleExport = async () => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.data.export()
      if (result.saved) setBackupStatus(t('settings.exported'))
      else if (result.error) setBackupError(t('settings.exportFailed', { error: result.error }))
    } catch (error) {
      setBackupError(t('settings.exportFailed', { error: String(error) }))
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
          t('settings.importDone', {
            tasks: result.tasksImported ?? 0,
            tasksSkipped: result.tasksSkipped ?? 0,
            projects: result.projectsImported ?? 0,
            projectsSkipped: result.projectsSkipped ?? 0,
            subtasks: result.subtasksImported ?? 0,
            subtasksSkipped: result.subtasksSkipped ?? 0
          })
        )
        // 导入的数据要立刻反映到主界面：刷新活任务与回收站两个独立存储。
        await useTaskStore.getState().load()
        await useTaskStore.getState().loadTrash()
      } else if (!result.canceled && result.error) {
        setBackupError(t('settings.importFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.importFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  const handleImportCsv = async () => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.data.importCsv()
      if (result.ok) {
        const source = result.format === 'standard' ? 'Csv' : t('settings.mainstream to-do app')
        setBackupStatus(
          t('settings.csvDone', {
            source,
            tasks: result.tasksImported ?? 0,
            tasksSkipped: result.tasksSkipped ?? 0,
            projects: result.projectsImported ?? 0,
            subtasks: result.subtasksImported ?? 0,
            tags: result.tagsImported ?? 0
          })
        )
        await useTaskStore.getState().load()
        await useTaskStore.getState().loadTrash()
      } else if (!result.canceled && result.error) {
        setBackupError(t('settings.importFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.importFailed', { error: String(error) }))
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
            aria-label={t('settings.title')}
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <div>
                <div className="settings-eyebrow">Polaris</div>
                <h2 className="settings-title">{t('settings.title')}</h2>
              </div>
              <button
                className="detail-close"
                onClick={onClose}
                aria-label={t('settings.close')}
              >
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-row-title">{t('settings.theme')}</div>
              <div className="settings-row-desc theme-section-desc">
                {t('settings.themeDesc')}
              </div>
              <div className="theme-picker" role="group" aria-label={t('settings.theme')}>
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
                          {themeLabel(locale, id)}
                          <span className="theme-family-tag">
                            {meta.family === 'dark'
                              ? t('themes.darkFamily')
                              : t('themes.lightFamily')}
                          </span>
                        </span>
                        <span className="theme-option-desc">{themeDesc(locale, id)}</span>
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

              {/* 语言行留在主题 section 内：设置面板的紧凑两列布局按
                  header + 7 section + footer 的 nth-child 排布，多一个 section 会错位。 */}
              <div className="settings-row settings-language-row">
                <div>
                  <div className="settings-row-title">{t('settings.language')}</div>
                  <div className="settings-row-desc">{t('settings.languageDesc')}</div>
                </div>
                <select
                  className="settings-language-select"
                  aria-label={t('settings.language')}
                  value={locale}
                  onChange={(event) => setLocale(event.target.value === 'en' ? 'en' : 'zh-CN')}
                >
                  <option value="zh-CN">{t('settings.languageZh')}</option>
                  <option value="en">{t('settings.languageEn')}</option>
                </select>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.autoStart')}</div>
                  <div className="settings-row-desc">
                    {t('settings.autoStartDesc')}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={autoStart.enabled}
                  aria-label={t('settings.autoStart')}
                  className={`switch ${autoStart.enabled ? 'on' : ''}`}
                  onClick={() => void toggleAutoStart()}
                  disabled={busy || !autoStart.supported}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              {autoStart.error && (
                <div className="settings-error" role="alert">
                  {t('settings.autoStartError', { error: autoStart.error })}
                </div>
              )}
              {!autoStart.supported && (
                <div className="settings-hint">
                  {t('settings.autoStartUnsupported')}
                </div>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.tray')}</div>
                  <div className="settings-row-desc">
                    {closeToTray ? t('settings.trayOn') : t('settings.trayOff')}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={closeToTray}
                  aria-label={t('settings.tray')}
                  className={`switch ${closeToTray ? 'on' : ''}`}
                  onClick={() => void toggleCloseToTray()}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.hotkey')}</div>
                  <div className="settings-row-desc">
                    {hotkey.enabled
                      ? t('settings.hotkeyOn', { accelerator: hotkey.accelerator })
                      : t('settings.hotkeyOff')}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={hotkey.enabled}
                  aria-label={t('settings.hotkey')}
                  className={`switch ${hotkey.enabled ? 'on' : ''}`}
                  onClick={() => void toggleHotkey()}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              {hotkey.enabled && hotkey.error && (
                <div className="settings-error" role="alert">
                  {t('settings.hotkeyError', { error: hotkey.error })}
                </div>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.mcp')}</div>
                  <div className="settings-row-desc">
                    {mcp.enabled ? mcp.endpoint : t('settings.mcpOff')}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={mcp.enabled}
                  aria-label={t('settings.mcp')}
                  className={`switch ${mcp.enabled ? 'on' : ''}`}
                  onClick={() => void toggleMcp()}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              {mcp.enabled && mcp.error && (
                <div className="settings-error" role="alert">
                  {t('settings.mcpError', { error: mcp.error })}
                </div>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-row-title">{t('settings.backup')}</div>
              <div className="settings-row-desc">
                {t('settings.backupDesc')}
              </div>
              <div className="backup-actions">
                <button className="backup-btn" onClick={() => void handleExport()} disabled={backupBusy}>
                  {t('settings.export')}
                </button>
                <button className="backup-btn" onClick={() => void handleImport()} disabled={backupBusy}>
                  {t('settings.import')}
                </button>
                <button
                  className="backup-btn"
                  onClick={() => void handleImportCsv()}
                  disabled={backupBusy}
                  title={t('settings.importCsvTitle')}
                >
                  {t('settings.importCsv')}
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
              <div className="settings-row-title">{t('settings.about')}</div>
              <div className="settings-row-desc">
                {version
                  ? t('settings.versionLine', { version })
                  : t('settings.versionOnly')}
              </div>
              <div className="about-credits">
                <div className="about-credit-row">
                  <span className="about-credit-label">{t('settings.fonts')}</span>
                  <span className="about-credit-value">Inter · Manrope · Noto Sans SC · Geist Mono (SIL OFL 1.1)</span>
                </div>
                <div className="about-credit-row">
                  <span className="about-credit-label">{t('settings.icons')}</span>
                  <span className="about-credit-value">Lucide (ISC / MIT)</span>
                </div>
                <div className="about-credit-note">
                  {t('settings.creditsNote')}
                </div>
              </div>
            </div>

            {/* 更新入口收进页脚：默认零增高，保住设置面板一屏；
                状态/错误行只在检查过或有动静时出现。 */}
            <div className="settings-footer">
              {version && (
                <>
                  {t('settings.footerVersion')}{' '}
                  <span className="settings-version">{version}</span>
                  {' · '}
                </>
              )}
              {update?.status === 'downloaded' ? (
                <button className="update-footer-btn ready" onClick={openUpdateDialog}>
                  {t('settings.viewUpdate')}
                </button>
              ) : (
                <button
                  className="update-footer-btn"
                  onClick={() => void handleCheckUpdate()}
                  disabled={
                    updateChecking ||
                    update?.status === 'checking' ||
                    update?.status === 'downloading'
                  }
                >
                  {t('settings.checkUpdate')}
                </button>
              )}
            </div>
            {update &&
              (updateAsked ||
                ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error'].includes(
                  update.status
                )) && (
                <div className="settings-hint update-footer-status" role="status">
                  {updateStatusText(update, t)}
                </div>
              )}
            {update?.status === 'error' && update.error && (
              <div className="settings-error" role="alert">{update.error}</div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
