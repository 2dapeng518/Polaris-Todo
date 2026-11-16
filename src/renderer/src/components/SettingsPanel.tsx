import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from './Icon'
import type { AutoStartState, GlobalHotkeyState, McpState, UpdateState } from '@shared/types'
import { THEME_META, THEME_ORDER } from '@shared/themes'
import { useTaskStore } from '../stores/useTaskStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useAppVersion } from '../stores/useAppVersion'
import { useUpdateStore } from '../stores/useUpdateStore'
import { useFocusTrap } from '../lib/useFocusTrap'

/** 更新状态一行说清；错误细节另有 settings-error，这里不堆长文。 */
function updateStatusText(state: UpdateState | null): string {
  if (!state) return '从 GitHub Releases 获取新版本'
  switch (state.status) {
    case 'unsupported':
      return '当前环境不提供在线更新，打包安装后生效'
    case 'checking':
      return '正在检查更新…'
    case 'available':
      return `发现新版本 ${state.latestVersion}，准备下载`
    case 'downloading':
      return `正在下载 ${state.latestVersion} · ${state.percent ?? 0}%`
    case 'downloaded':
      return `${state.latestVersion} 已就绪，重启后安装`
    case 'up-to-date':
      return '已是最新版本'
    case 'error':
      return '检查更新失败'
    default:
      return '从 GitHub Releases 获取新版本'
  }
}

type SettingsPanelProps = {
  open: boolean
  onClose: () => void
  /** 侧栏存储卡片进来时直达备份区；普通入口为 null，停在顶部。 */
  scrollTo?: 'backup' | null
}

export function SettingsPanel({ open, onClose, scrollTo = null }: SettingsPanelProps) {
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
          `导入完成：任务 +${result.tasksImported ?? 0}（跳过 ${result.tasksSkipped ?? 0}），项目 +${result.projectsImported ?? 0}（跳过 ${result.projectsSkipped ?? 0}），子任务 +${result.subtasksImported ?? 0}（跳过 ${result.subtasksSkipped ?? 0}）`
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

  const handleImportCsv = async () => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupStatus(null)
    try {
      const result = await window.polaris.data.importCsv()
      if (result.ok) {
        const source = result.format === 'standard' ? 'Csv' : '主流待办应用'
        setBackupStatus(
          `${source} 导入完成：任务 +${result.tasksImported ?? 0}（跳过 ${result.tasksSkipped ?? 0}），项目 +${result.projectsImported ?? 0}，子任务 +${result.subtasksImported ?? 0}，标签 +${result.tagsImported ?? 0}`
        )
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
                    {closeToTray
                      ? '关闭主窗口不会退出，提醒与托盘常驻继续运行'
                      : '关闭主窗口将退出应用，提醒随之停止'}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={closeToTray}
                  aria-label="关闭窗口后驻留托盘"
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
                  <div className="settings-row-title">全局热键快速添加</div>
                  <div className="settings-row-desc">
                    {hotkey.enabled
                      ? `${hotkey.accelerator} · 任意窗口唤起并聚焦快速添加`
                      : '已关闭 · 窗口内仍可按 N 快速添加'}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={hotkey.enabled}
                  aria-label="全局热键快速添加"
                  className={`switch ${hotkey.enabled ? 'on' : ''}`}
                  onClick={() => void toggleHotkey()}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              {hotkey.enabled && hotkey.error && (
                <div className="settings-error" role="alert">
                  {hotkey.error}，关闭占用程序后可重新打开此开关
                </div>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-row-title">本地 MCP 服务</div>
                  <div className="settings-row-desc">
                    {mcp.enabled ? mcp.endpoint : '已关闭 · 开启后 AI 助手可在本机读写任务'}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={mcp.enabled}
                  aria-label="本地 MCP 服务"
                  className={`switch ${mcp.enabled ? 'on' : ''}`}
                  onClick={() => void toggleMcp()}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              {mcp.enabled && mcp.error && (
                <div className="settings-error" role="alert">
                  {mcp.error}，关闭占用程序后可重新打开此开关
                </div>
              )}
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
                <button
                  className="backup-btn"
                  onClick={() => void handleImportCsv()}
                  disabled={backupBusy}
                  title="支持主流待办应用 / Csv 的 CSV 导出，按表头自动识别"
                >
                  导入 CSV
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

            {/* 更新入口收进页脚：默认零增高，保住设置面板一屏；
                状态/错误行只在检查过或有动静时出现。 */}
            <div className="settings-footer">
              {version && (
                <>
                  版本 <span className="settings-version">{version}</span>
                  {' · '}
                </>
              )}
              {update?.status === 'downloaded' ? (
                <button className="update-footer-btn ready" onClick={openUpdateDialog}>
                  查看更新
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
                  检查更新
                </button>
              )}
            </div>
            {update &&
              (updateAsked ||
                ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error'].includes(
                  update.status
                )) && (
                <div className="settings-hint update-footer-status" role="status">
                  {updateStatusText(update)}
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
