import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, X } from './Icon'
import type { AutoBackupItem, AutoStartState, GlobalHotkeyState, McpState, UpdateState } from '@shared/types'
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

/** 备份行时间戳跟随界面语言；大小给人类可读单位，列表不解析文件内容。 */
function formatBackupWhen(mtimeMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(mtimeMs)
}

function formatBackupSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

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
  // 自动备份折叠块：默认收起不占高度；每次展开重读列表（目录可能被
  // 外部改动），缓存只供收起态的计数展示。
  const [autoBackupOpen, setAutoBackupOpen] = useState(false)
  const [autoBackups, setAutoBackups] = useState<AutoBackupItem[] | null>(null)
  const [autoBackupError, setAutoBackupError] = useState<string | null>(null)
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
  // MCP 访问令牌：仅启用时展示；明文全量上屏（本机凭证，用户拍板不掩码），
  // 复制/重新生成走主进程 IPC，渲染层不落任何持久化。
  const [mcpToken, setMcpToken] = useState<string | null>(null)
  const [mcpTokenNotice, setMcpTokenNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [mcpRegenConfirm, setMcpRegenConfirm] = useState(false)
  // 关于与许可：低频署名信息收进页脚折叠，默认不挂载零增高。
  // 不持久化：每次关面板重置，下次打开回到收起态（高度预算按收起态算）。
  const [aboutOpen, setAboutOpen] = useState(false)
  useEffect(() => {
    if (!open) setAboutOpen(false)
  }, [open])
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

  // 右列开关行描述：错误/不支持替换描述落同一行（单行 ellipsis + title 全文），
  // 条件错误行零增高——右列行高完全确定，一屏守卫不靠余量赌文案长度。
  const autoStartDesc = autoStart.error
    ? t('settings.autoStartError', { error: autoStart.error })
    : !autoStart.supported
      ? t('settings.autoStartUnsupported')
      : t('settings.autoStartDesc')
  const autoStartDescAlert = Boolean(autoStart.error) || !autoStart.supported
  const hotkeyDesc =
    hotkey.enabled && hotkey.error
      ? t('settings.hotkeyError', { error: hotkey.error })
      : hotkey.enabled
        ? t('settings.hotkeyOn', { accelerator: hotkey.accelerator })
        : t('settings.hotkeyOff')
  const hotkeyDescAlert = Boolean(hotkey.enabled && hotkey.error)

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
      // 备份状态行随面板关闭清空：反馈是瞬时的，重开回到干净态，
      // 长计数文案不会在下次打开时撑高备份区（一屏守卫量的是干净态）。
      setBackupStatus(null)
      setBackupError(null)
      setAutoBackupError(null)
      // 手风琴随面板关闭收起：重开回到收起态，一屏守卫量的永远是收起态。
      // 列表缓存保留供收起态计数；展开时重读防幽灵行。
      setAutoBackupOpen(false)
    }
    return () => {
      if (mcpNoticeTimer.current) {
        clearTimeout(mcpNoticeTimer.current)
        mcpNoticeTimer.current = null
      }
    }
  }, [open])

  // Esc 分层在单监听器内决策：浮层开着只关浮层，否则关面板。
  // 单监听器免掉跨监听器的相位/注册序复杂度；CDP 真按键实测：
  // 浮层开时 Esc 只关浮层、面板存活（trace 探针四阶段日志确认）。
  useEffect(() => {
    if (!open || paletteOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (aboutOpen) {
        setAboutOpen(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, paletteOpen, onClose, aboutOpen])

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

  const loadAutoBackups = async () => {
    setAutoBackupError(null)
    try {
      const result = await window.polaris.backups.list()
      if (result.ok && result.items) setAutoBackups(result.items)
      else setAutoBackupError(t('settings.autoBackupLoadFailed', { error: result.error ?? '' }))
    } catch (error) {
      setAutoBackupError(t('settings.autoBackupLoadFailed', { error: String(error) }))
    }
  }

  // 先取列表再展开：本地 IPC 毫秒级，避免「先撑开空壳、行随后弹出」的
  // 两段式跳高。每次展开都重读——目录可能被外部改动（数据目录里删文件、
  // 新一轮自动备份），拿旧缓存会渲染幽灵行；缓存只供收起态计数展示。
  const toggleAutoBackup = async () => {
    if (autoBackupOpen) {
      setAutoBackupOpen(false)
      return
    }
    await loadAutoBackups()
    setAutoBackupOpen(true)
  }

  // 与 handleImport 完全同语义：合并非破坏，计数进同一条状态行，刷新两个存储。
  const handleAutoBackupImport = async (name: string) => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.backups.import(name)
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
        await useTaskStore.getState().load()
        await useTaskStore.getState().loadTrash()
      } else if (result.error) {
        setBackupError(t('settings.importFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.importFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  const handleAutoBackupSaveAs = async (name: string) => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.backups.saveAs(name)
      if (result.saved) setBackupStatus(t('settings.autoBackupSavedAs'))
      else if (result.error) setBackupError(t('settings.exportFailed', { error: result.error }))
    } catch (error) {
      setBackupError(t('settings.exportFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  const handleOpenDataDir = async () => {
    setBackupError(null)
    try {
      const result = await window.polaris.backups.openDataDir()
      // harness 门控返回 opened:false 且无 error——不是失败，不弹文案。
      if (!result.opened && result.error) {
        setBackupError(t('settings.openDataDirFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.openDataDirFailed', { error: String(error) }))
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
            onMouseDown={(event) => {
              event.stopPropagation()
              // 点浮层外（不含开关本身）收起关于；开关自己的 onClick 负责切换。
              const target = event.target as HTMLElement
              if (aboutOpen && !target.closest('.settings-about') && !target.closest('.settings-about-toggle')) {
                setAboutOpen(false)
              }
            }}
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

            <div className="settings-section settings-section--theme">
              <div className="settings-theme-head">
                <div className="settings-row-title" title={t('settings.themeDesc')}>
                  {t('settings.theme')}
                </div>
                <span title={t('settings.languageDesc')}>
                  <LanguageSelect />
                </span>
              </div>
              {/* 色样横条：六枚 swatch 一排，与标题同行（header 左 / theme 右），
                  名字+气质描述进 title 提示。旧 2×3 卡片网格吃 156~210px，
                  是设置页超帽滚动的最大一块；横条零额外行，一屏守卫各档
                  才吞得下 MCP 令牌块。 */}
              <div
                className="theme-picker"
                role="group"
                aria-label={t('settings.theme')}
                title={t('settings.themeDesc')}
              >
                {THEME_ORDER.map((id) => {
                  const meta = THEME_META[id]
                  const selected = theme === id
                  const label = themeLabel(locale, id)
                  return (
                    <button
                      key={id}
                      type="button"
                      data-theme-option={id}
                      aria-pressed={selected}
                      aria-label={label}
                      title={`${label} · ${themeDesc(locale, id)}`}
                      className={`theme-option ${selected ? 'selected' : ''}`}
                      onClick={() => setTheme(id)}
                    >
                      <span className="theme-swatch" aria-hidden="true" style={{ background: meta.swatch[0] }}>
                        <span className="theme-swatch-surface" style={{ background: meta.swatch[1] }} />
                        <span className="theme-swatch-dot" style={{ background: meta.swatch[2] }} />
                      </span>
                      {selected && (
                        <span className="theme-option-check" aria-hidden="true">
                          <Check size={9} strokeWidth={2.6} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

            </div>

            {/* 左列「数据备份」：唯一会变高的组（手风琴/状态行）。两列档里
                contain:size + stretch 让展开高度被卡框吸收、列表卡内滚动，
                行高由右列固定内容决定——展开/收起外几何逐像素不变。 */}
            <div className="settings-section settings-section--backup">
              {/* 折叠开关进标题行右侧：收起态零增高，一屏守卫的高度预算不动。 */}
              <div className="settings-group-label settings-group-label--split">
                <span>{t('settings.backup')}</span>
                <button
                  className="auto-backup-toggle"
                  aria-expanded={autoBackupOpen}
                  title={t('settings.autoBackupDesc')}
                  onClick={() => void toggleAutoBackup()}
                >
                  <span>
                    {t('settings.autoBackup')}
                    {autoBackups !== null && ` · ${t('settings.autoBackupCount', { count: autoBackups.length })}`}
                  </span>
                  <ChevronDown
                    size={12}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className={`settings-about-chev${autoBackupOpen ? ' open' : ''}`}
                  />
                </button>
              </div>
              <div className="settings-row-desc" title={t('settings.backupDesc')}>
                {t('settings.backupDesc')}
              </div>
              <div className="backup-actions">
                <button className="backup-btn backup-btn--primary" onClick={() => void handleExport()} disabled={backupBusy}>
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
                <button className="backup-btn" onClick={() => void handleOpenDataDir()} disabled={backupBusy}>
                  {t('settings.openDataDir')}
                </button>
              </div>
              {backupStatus && (
                <div className="settings-hint" role="status">{backupStatus}</div>
              )}
              {backupError && (
                <div className="settings-error" role="alert">{backupError}</div>
              )}
              {/* 自动备份手风琴：开关在标题行，这里收起时什么都不渲染。
                  24h/21 份/合并语义的说明进开关 title 提示——展开态卡内
                  余高要留给列表首行（576 档卡高 207px，说明占行会把首行
                  挤出卡外，settingsBackupNoShift 的首行免滚断言钉死）。 */}
              <AnimatePresence initial={false}>
                {autoBackupOpen && (
                  <motion.div
                    className="auto-backup-body"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                  >
                    {autoBackupError && (
                      <div className="settings-error" role="alert">{autoBackupError}</div>
                    )}
                    {autoBackups !== null && autoBackups.length === 0 && (
                      <div className="settings-hint">{t('settings.autoBackupEmpty')}</div>
                    )}
                    {autoBackups !== null && autoBackups.length > 0 && (
                      <ul className="auto-backup-list">
                        {autoBackups.map((item) => (
                          <li key={item.name} className="auto-backup-row" data-backup-name={item.name}>
                            <span className="auto-backup-when">{formatBackupWhen(item.mtimeMs, locale)}</span>
                            <span className="auto-backup-size">{formatBackupSize(item.sizeBytes)}</span>
                            <span className="auto-backup-row-actions">
                              <button
                                className="backup-btn backup-btn--small"
                                disabled={backupBusy}
                                onClick={() => void handleAutoBackupImport(item.name)}
                              >
                                {t('settings.autoBackupImport')}
                              </button>
                              <button
                                className="backup-btn backup-btn--small"
                                disabled={backupBusy}
                                onClick={() => void handleAutoBackupSaveAs(item.name)}
                              >
                                {t('settings.autoBackupSaveAs')}
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="settings-side">
            <div className="settings-section settings-section--mcp">
              {/* 组名即开关行标题：省掉冗余标题行（「本地 MCP 服务」+「启用服务」
                  两行说一件事）。换位后右列 MCP+常规叠卡，这一行把行高预算
                  压回换位前水平，一屏守卫各档不 regress。 */}
              {/* 错误替换描述落同一行（单行 ellipsis + title 全文）：条件错误行
                  零增高，右列行高完全确定，一屏守卫不靠余量赌文案长度。 */}
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.mcp')}</div>
                  <div
                    className={`settings-row-desc ${mcp.enabled && mcp.error ? 'is-error' : ''}`}
                    role={mcp.enabled && mcp.error ? 'alert' : undefined}
                    title={
                      mcp.enabled && mcp.error
                        ? t('settings.mcpError', { error: mcp.error })
                        : mcp.enabled
                          ? mcp.endpoint
                          : t('settings.mcpOff')
                    }
                  >
                    {mcp.enabled && mcp.error
                      ? t('settings.mcpError', { error: mcp.error })
                      : mcp.enabled
                        ? mcp.endpoint
                        : t('settings.mcpOff')}
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
              {/* 令牌独占整行：明文全量上屏（用户拍板不再掩码），67 字符在半宽
                  卡里 break-all 折两行、整宽时一行，盒宽吃满卡宽。复制/重新生成
                  退第二行右对齐。仅启用时渲染，默认零增高。
                  用法说明住进常驻反馈槽（无提示时显示说明，提示来了替换 2.6s），
                  说明与提示都是一行，槽高恒定——省掉独立说明行的 16~33px。 */}
              {mcp.enabled && mcpToken && (
                <div className="mcp-token">
                  <code
                    className="mcp-token-box"
                    aria-label={t('settings.mcpToken')}
                    title={t('settings.mcpTokenDescFull')}
                  >
                    {mcpToken}
                  </code>
                  <div className="mcp-token-actions">
                    <button className="backup-btn" onClick={() => void copyMcpToken()}>
                      {t('settings.mcpTokenCopy')}
                    </button>
                    <button
                      className="backup-btn backup-btn--danger"
                      onClick={() => setMcpRegenConfirm(true)}
                      disabled={mcpTokenBusy}
                    >
                      {t('settings.mcpTokenRegenerate')}
                    </button>
                  </div>
                  {/* 反馈行常驻占位：默认落用法说明，复制/重新生成的 2.6s 提示
                      替换进槽再还原，不来回撑面板高度。 */}
                  <div
                    className={`mcp-token-slot ${mcpTokenNotice?.error ? 'settings-error' : 'settings-hint'}`}
                    role={mcpTokenNotice?.error ? 'alert' : 'status'}
                    title={mcpTokenNotice?.text ?? t('settings.mcpTokenDesc')}
                  >
                    {mcpTokenNotice?.text ?? t('settings.mcpTokenDesc')}
                  </div>
                </div>
              )}
            </div>

            {/* 右列下半「常规设置」：三开关内容固定，与 MCP 一起钉死行高，
                左列备份卡展开时这里纹丝不动。 */}
            <div className="settings-section settings-section--behavior">
              <div className="settings-group-label">{t('settings.behaviorGroup')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.autoStart')}</div>
                  <div
                    className={`settings-row-desc ${autoStartDescAlert ? 'is-error' : ''}`}
                    role={autoStartDescAlert ? 'alert' : undefined}
                    title={autoStartDesc}
                  >
                    {autoStartDesc}
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
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">{t('settings.hotkey')}</div>
                  <div
                    className={`settings-row-desc ${hotkeyDescAlert ? 'is-error' : ''}`}
                    role={hotkeyDescAlert ? 'alert' : undefined}
                    title={hotkeyDesc}
                  >
                    {hotkeyDesc}
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
            </div>
            </div>

            {/* 更新入口收进页脚：状态行常驻占位一行，检查过或有动静才落字，
                高度不随状态变化，面板不重新居中抖动。
                关于与许可是页脚上方的浮层（绝对定位）：展开不增高、不改滚动状态，
                滚动容器 clamp 跳视的根因从构造上消失。 */}
            <div className="settings-footer">
              <AnimatePresence initial={false}>
                {aboutOpen && (
                  <motion.div
                    className="settings-about"
                    role="region"
                    aria-label={t('settings.aboutToggle')}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                  >
                    {/* 版本号常驻页脚，浮层只留许可署名，不重复报版本。 */}
                    <div className="settings-row-desc">{t('settings.versionOnly')}</div>
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
                  </motion.div>
                )}
              </AnimatePresence>
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
              {version ? ' · ' : ''}
              <button
                className="update-footer-btn settings-about-toggle"
                aria-expanded={aboutOpen}
                onClick={() => setAboutOpen((v) => !v)}
              >
                {t('settings.aboutToggle')}
                <ChevronDown
                  size={12}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className={`settings-about-chev${aboutOpen ? ' open' : ''}`}
                />
              </button>
            </div>
            <div
              className={`settings-hint update-footer-status${updateErrorDetail ? ' is-error' : ''}`}
              role={updateErrorDetail ? 'alert' : 'status'}
              title={updateErrorDetail ?? (updateStatusVisible && update ? updateStatusText(update, t) : '')}
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
