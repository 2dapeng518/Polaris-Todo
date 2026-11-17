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
import { useT, useLocale, type Translate } from '../stores/useLocaleStore'
import { LanguageSelect } from './LanguageSelect'
import { ConfirmDialog } from './ConfirmDialog'
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
  // MCP 访问令牌：仅启用时展示；单行掩码头尾可见中段隐藏（sk-1234…c1d9），
  // 明文永不上屏；复制/重新生成走主进程 IPC，渲染层不落任何持久化。
  const [mcpToken, setMcpToken] = useState<string | null>(null)
  const [mcpTokenNotice, setMcpTokenNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [mcpRegenConfirm, setMcpRegenConfirm] = useState(false)
  const [mcpTokenBusy, setMcpTokenBusy] = useState(false)
  const mcpNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const update = useUpdateStore((state) => state.state)
  const checkUpdate = useUpdateStore((state) => state.check)
  const openUpdateDialog = useUpdateStore((state) => state.openDialog)
  const [updateChecking, setUpdateChecking] = useState(false)
  // 手动点过检查才展示状态文案：dev 的 unsupported 默认不落字（占位槽仍在）。
  const [updateAsked, setUpdateAsked] = useState(false)

  const updateDialogOpen = useUpdateStore((state) => state.dialogOpen)

  // 更新状态行常驻占位：检查前空槽占一行，检查后文案落槽，面板高度全程不变。
  // 错误细节复用同一槽（替换通用文案），不追加新行。
  const updateErrorDetail = update?.status === 'error' && update.error ? update.error : null
  const updateStatusVisible =
    !!update &&
    (updateAsked ||
      ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error'].includes(update.status))

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
      .then(async (value) => {
        if (cancelled) return
        setMcp(value)
        if (value.enabled) {
          const token = await window.polaris.app.getMcpToken()
          if (!cancelled) setMcpToken(token)
        }
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

  // 关闭面板即收起提示/确认框：下次打开干净状态。
  useEffect(() => {
    if (!open) {
      setMcpTokenNotice(null)
      setMcpRegenConfirm(false)
    }
    return () => {
      if (mcpNoticeTimer.current) {
        clearTimeout(mcpNoticeTimer.current)
        mcpNoticeTimer.current = null
      }
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
      if (next) {
        // 首次启用主进程已生成 token，这里直接取回展示。
        setMcpToken(await window.polaris.app.getMcpToken())
      } else {
        setMcpToken(null)
        setMcpTokenNotice(null)
      }
    } catch {
      setMcp((current) => ({ ...current, enabled: !next }))
    }
  }

  // 复制/重新生成的短暂反馈：沿用备份区 settings-hint 的静默状态行模式。
  const flashMcpNotice = (text: string, error = false) => {
    if (mcpNoticeTimer.current) clearTimeout(mcpNoticeTimer.current)
    setMcpTokenNotice({ text, error })
    mcpNoticeTimer.current = setTimeout(() => setMcpTokenNotice(null), 2600)
  }

  const copyMcpToken = async () => {
    if (!mcpToken) return
    try {
      await navigator.clipboard.writeText(mcpToken)
      flashMcpNotice(t('settings.mcpTokenCopied'))
    } catch {
      flashMcpNotice(t('settings.mcpTokenCopyFailed'), true)
    }
  }

  const regenerateMcpToken = async () => {
    setMcpRegenConfirm(false)
    setMcpTokenBusy(true)
    try {
      setMcpToken(await window.polaris.app.regenerateMcpToken())
      flashMcpNotice(t('settings.mcpTokenRegenerated'))
    } catch (error) {
      flashMcpNotice(String(error), true)
    } finally {
      setMcpTokenBusy(false)
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
                <LanguageSelect />
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
              {/* 令牌行留在 MCP section 内部：紧凑两列布局按 header + 7 section
                  的 nth-child 排布，不新增 section。仅启用时渲染，默认零增高。 */}
              {mcp.enabled && mcpToken && (
                <div className="settings-language-row">
                  <div className="settings-row-title">{t('settings.mcpToken')}</div>
                  <div className="settings-row-desc">{t('settings.mcpTokenDesc')}</div>
                  <code
                    aria-label={t('settings.mcpToken')}
                    style={{
                      display: 'block',
                      marginTop: 8,
                      padding: '6px 8px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      background: 'var(--surface-1)',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      lineHeight: 1.5,
                      // 单行掩码：头 7 字符（sk- + 前 4 位）+ … + 末 4 位，中段隐藏。
                      // 定长 12 字符任何档位都放得下；nowrap + ellipsis 兜底极窄窗口，
                      // 高度恒定一行，面板零回流。明文永不渲染，只能整串复制。
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {`${mcpToken.slice(0, 7)}…${mcpToken.slice(-4)}`}
                  </code>
                  <div className="backup-actions">
                    <button className="backup-btn" onClick={() => void copyMcpToken()}>
                      {t('settings.mcpTokenCopy')}
                    </button>
                    <button
                      className="backup-btn"
                      onClick={() => setMcpRegenConfirm(true)}
                      disabled={mcpTokenBusy}
                    >
                      {t('settings.mcpTokenRegenerate')}
                    </button>
                  </div>
                  {/* 反馈行常驻占位：复制/重新生成的 2.6s 提示落进槽里再消失，
                      不来回撑面板高度。 */}
                  <div
                    className={mcpTokenNotice?.error ? 'settings-error' : 'settings-hint'}
                    role={mcpTokenNotice?.error ? 'alert' : 'status'}
                    style={{ minHeight: '1.5em' }}
                  >
                    {mcpTokenNotice?.text ?? ''}
                  </div>
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

            {/* 更新入口收进页脚：状态行常驻占位一行，检查过或有动静才落字，
                高度不随状态变化，面板不重新居中抖动。 */}
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
            <div
              className={`settings-hint update-footer-status${updateErrorDetail ? ' is-error' : ''}`}
              role={updateErrorDetail ? 'alert' : 'status'}
            >
              {updateErrorDetail ?? (updateStatusVisible && update ? updateStatusText(update, t) : '')}
            </div>

            {/* 重新生成令牌的二次确认：旧客户端配置立即失效，属破坏性动作。
                ConfirmDialog 自带焦点陷阱（压在面板陷阱之上）并在 React 根
                停掉 Esc，面板的 window 监听不会抢去整面板关闭。 */}
            <AnimatePresence>
              {mcpRegenConfirm && (
                <ConfirmDialog
                  message={t('settings.mcpTokenRegenConfirm')}
                  confirmLabel={t('settings.mcpTokenRegenerate')}
                  onConfirm={() => void regenerateMcpToken()}
                  onClose={() => setMcpRegenConfirm(false)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
