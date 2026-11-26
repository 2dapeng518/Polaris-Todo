import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { AutoBackupItem, DataLocationState } from '@shared/types'
import { ConfirmDialog } from '../ConfirmDialog'
import { BackupListDialog } from '../BackupListDialog'
import { useT } from '../../stores/useLocaleStore'
import { SettingsRow } from './SettingsRow'

// 「数据与备份」：手动备份四钮 + 自动备份（管理入口开模态对话框）+ 数据存放位置。
// 设置还是主窗口里的浮层面板时，这一组为了塞进一屏有大量「零增高」契约
// （contain:size、单行状态槽）；独立窗口一页只放这一个分类，状态行按需出现即可。
// 导入是合并语义，数据落库后主窗口在下次获得焦点时经修订号门自动拉取——
// 设置窗口是另一个渲染进程，不在这里替它刷新 store。
export function DataSection() {
  const t = useT()
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  // 自动备份管理对话框：备份页只留固定一行「自动备份 · 共 N 份 [管理…]」，
  // 列表住对话框。每次打开重读列表（目录可能被外部改动），缓存只供计数展示。
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [autoBackups, setAutoBackups] = useState<AutoBackupItem[] | null>(null)
  const [autoBackupError, setAutoBackupError] = useState<string | null>(null)
  // 自动备份周期（小时；0 = 关闭）：打开对话框时从 meta 拉取，chips 即点即存。
  const [backupInterval, setBackupInterval] = useState(24)
  // 数据存放位置：offered 待确认（复制/采用二选一弹框）；pendingRestart 只存在到重启。
  const [dataLoc, setDataLoc] = useState<DataLocationState>({
    path: '',
    defaultPath: '',
    isCustom: false,
    pendingRestart: false
  })
  const [dataLocBusy, setDataLocBusy] = useState(false)
  const [dataLocConfirm, setDataLocConfirm] = useState<'copy' | 'adopt' | 'reset' | null>(null)
  // 卸载清理读最新值：离开本页时待确认的 offer 要撤销，闭包里的旧 state 不够新。
  const dataLocConfirmRef = useRef(dataLocConfirm)
  dataLocConfirmRef.current = dataLocConfirm

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

  useEffect(() => {
    // 固定行计数：进页面即取一次列表（廉价元数据 IPC），「共 N 份」第一时间上屏；
    // 失败静默（计数缺席不占行），打开对话框时会重读并报错误。
    void loadAutoBackups()

    window.polaris.dataLocation
      .getState()
      .then((value) => setDataLoc(value))
      .catch((error) => setDataLoc((current) => ({ ...current, error: String(error) })))

    return () => {
      // 离开本页（切分类/关窗口）时待确认的目录 offer 一并撤销，主进程不残留状态。
      if (dataLocConfirmRef.current) void window.polaris.dataLocation.cancel()
    }
  }, [])

  // 数据存放位置状态行：pendingRestart > 错误 > 路径（默认位置带前缀说明）。
  const dataLocDesc = dataLoc.pendingRestart
    ? t('settings.dataLocationPending')
    : dataLoc.error
      ? dataLoc.error
      : dataLoc.isCustom
        ? dataLoc.path
        : t('settings.dataLocationDefault', { path: dataLoc.path })

  const resetFeedback = () => {
    setBackupError(null)
    setBackupStatus(null)
  }

  const handleExport = async () => {
    setBackupBusy(true)
    resetFeedback()
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
    resetFeedback()
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
      } else if (!result.canceled && result.error) {
        setBackupError(t('settings.importFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.importFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  // CSV 导出：独立成钮（导入 CSV 功能已移除）；反馈落同一条状态行。
  const handleExportCsv = async () => {
    setBackupBusy(true)
    resetFeedback()
    try {
      const result = await window.polaris.data.exportCsv()
      if (result.saved) {
        setBackupStatus(t('settings.csvExported'))
      } else if (result.error) {
        setBackupError(t('settings.csvExportFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.csvExportFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  // ICS 导出（P4.2）：RFC 5545 日历单向出口；反馈同一条状态行。
  const handleExportIcs = async () => {
    setBackupBusy(true)
    resetFeedback()
    try {
      const result = await window.polaris.data.exportIcs()
      if (result.saved) {
        setBackupStatus(t('settings.icsExported'))
      } else if (result.error) {
        setBackupError(t('settings.icsExportFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.icsExportFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  // 载入示例任务：幂等合并（固定 ID 跳过已存在），反馈落到同一条状态行。
  const handleLoadSamples = async () => {
    setBackupBusy(true)
    resetFeedback()
    try {
      const result = await window.polaris.data.loadSamples()
      setBackupStatus(t('settings.samplesLoaded', { count: result.tasksAdded, skipped: result.tasksSkipped }))
    } catch (error) {
      setBackupError(t('settings.samplesLoadFailed', { error: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  // 先取列表再开模态：本地 IPC 毫秒级，对话框带着数据打开，没有「先开
  // 空壳、行随后弹出」的两段式跳高。每次打开都重读——目录可能被外部改动
  // （数据目录里删文件、新一轮自动备份），拿旧缓存会渲染幽灵行；缓存只供
  // 固定行计数展示。顺手清掉本页旧反馈，对话框反馈槽从干净态开始。
  const openBackupDialog = async () => {
    resetFeedback()
    await loadAutoBackups()
    void window.polaris.backups
      .getInterval()
      .then((hours) => setBackupInterval(hours))
      .catch(() => {})
    setBackupDialogOpen(true)
  }

  // 与 handleImport 完全同语义：合并非破坏，计数进同一条状态行。
  const handleAutoBackupImport = async (name: string) => {
    setBackupBusy(true)
    resetFeedback()
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
    resetFeedback()
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

  // 周期即点即存：meta 落库后回读生效值；运行期兜底定时器每次运行都重读
  // meta，无需额外通知主进程。
  const handleBackupIntervalChange = (hours: number) => {
    setBackupInterval(hours)
    void window.polaris.backups
      .setInterval(hours)
      .then((stored) => {
        setBackupInterval(stored)
        setBackupStatus(t('settings.autoBackupIntervalSaved'))
      })
      .catch((error) => setBackupError(t('settings.autoBackupIntervalFailed', { error: String(error) })))
  }

  // 删除是破坏性动作：确认框在对话框内二次把关，这里只做落盘与反馈；
  // 成功后重读列表（行数与固定行计数同步刷新）。
  const handleAutoBackupDelete = async (name: string) => {
    setBackupBusy(true)
    resetFeedback()
    try {
      const result = await window.polaris.backups.delete(name)
      if (result.deleted) {
        setBackupStatus(t('settings.autoBackupDeleted'))
        await loadAutoBackups()
      } else if (result.error) {
        setBackupError(t('settings.autoBackupDeleteFailed', { error: result.error }))
      }
    } catch (error) {
      setBackupError(t('settings.autoBackupDeleteFailed', { error: String(error) }))
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

  // 数据存放位置：set 只拿 offer（原生对话框），确认后 apply（迁移/采用 + 重启）。
  const chooseDataLocation = async () => {
    if (dataLocBusy) return
    setDataLocBusy(true)
    try {
      const next = await window.polaris.dataLocation.set()
      setDataLoc(next)
      if (next.offered) setDataLocConfirm(next.offeredAdopt ? 'adopt' : 'copy')
    } catch (error) {
      setDataLoc((current) => ({ ...current, error: String(error) }))
    } finally {
      setDataLocBusy(false)
    }
  }

  // 取消确认框：清空主进程 offer，不落任何盘。
  const cancelDataLocation = () => {
    setDataLocConfirm(null)
    void window.polaris.dataLocation.cancel().then((next) => setDataLoc(next))
  }

  const confirmDataLocation = async () => {
    setDataLocConfirm(null)
    setDataLocBusy(true)
    try {
      setDataLoc(await window.polaris.dataLocation.apply())
    } catch (error) {
      setDataLoc((current) => ({ ...current, error: String(error) }))
    } finally {
      setDataLocBusy(false)
    }
  }

  const confirmResetDataLocation = async () => {
    setDataLocConfirm(null)
    setDataLocBusy(true)
    try {
      setDataLoc(await window.polaris.dataLocation.reset())
    } catch (error) {
      setDataLoc((current) => ({ ...current, error: String(error) }))
    } finally {
      setDataLocBusy(false)
    }
  }

  const autoBackupTitle = `${t('settings.autoBackup')}${
    autoBackups !== null ? ` · ${t('settings.autoBackupCount', { count: autoBackups.length })}` : ''
  }`

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-label">{t('settings.backup')}</div>
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
          {/* 导出 CSV 独立成钮，占原导入 CSV 的网格 cell、同 32px 高。
              导出 ICS（P4.2）为第五钮：网格换行到 2×3，仍是同一套 32px 钮。 */}
          <button
            className="backup-btn"
            onClick={() => void handleExportCsv()}
            disabled={backupBusy}
            title={t('settings.csvExportTitle')}
          >
            {t('settings.csvExport')}
          </button>
          <button
            className="backup-btn"
            onClick={() => void handleExportIcs()}
            disabled={backupBusy}
            title={t('settings.icsExportTitle')}
          >
            {t('settings.icsExport')}
          </button>
          {/* 载入示例任务（幂等合并）：第六钮填满 2×3 网格。 */}
          <button
            className="backup-btn"
            onClick={() => void handleLoadSamples()}
            disabled={backupBusy}
            title={t('settings.samplesLoadTitle')}
          >
            {t('settings.samplesLoad')}
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
      </section>

      {/* 自动备份：固定一行（标题带份数 + 右侧「管理…」），列表住模态对话框。 */}
      <section className="settings-card">
        <SettingsRow title={autoBackupTitle} desc={t('settings.autoBackupDesc')}>
          <button
            className="backup-btn backup-btn--small auto-backup-manage"
            aria-haspopup="dialog"
            title={t('settings.autoBackupDesc')}
            onClick={() => void openBackupDialog()}
          >
            <span className="auto-backup-manage-cta">{t('settings.autoBackupManage')}</span>
          </button>
        </SettingsRow>
      </section>

      {/* 数据存放位置：标题 + 路径同排（路径占余宽 ellipsis），右侧小按钮。
          自定义位置时追加「恢复默认」，宽度变化不增行。 */}
      <section className="settings-card">
        <div className="settings-dataloc">
          <div className="settings-row">
            <div className="settings-dataloc-main">
              <span className="settings-dataloc-title" title={t('settings.dataLocationPrivacy')}>
                {t('settings.dataLocation')}
              </span>
              <span
                className={`settings-dataloc-path ${dataLoc.error && !dataLoc.pendingRestart ? 'is-error' : ''}`}
                role={dataLoc.error && !dataLoc.pendingRestart ? 'alert' : undefined}
                title={dataLocDesc}
              >
                {dataLocDesc}
              </span>
            </div>
            <div className="settings-row-actions">
              {dataLoc.isCustom && (
                <button
                  className="backup-btn backup-btn--small settings-row-btn-sm"
                  disabled={dataLocBusy}
                  onClick={() => setDataLocConfirm('reset')}
                >
                  {t('settings.dataLocationReset')}
                </button>
              )}
              <button
                className="backup-btn backup-btn--small settings-row-btn-sm"
                disabled={dataLocBusy || dataLoc.pendingRestart}
                title={t('settings.dataLocationChangeTitle')}
                onClick={() => void chooseDataLocation()}
              >
                {t('settings.dataLocationChange')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 自动备份管理对话框：列表/导入/另存为全住这里。导入/另存为复用本页
          同一套 handler 与状态行，语义不变。 */}
      <AnimatePresence>
        {backupDialogOpen && (
          <BackupListDialog
            items={autoBackups}
            loadError={autoBackupError}
            busy={backupBusy}
            status={backupStatus}
            error={backupError}
            intervalHours={backupInterval}
            onIntervalChange={handleBackupIntervalChange}
            onImport={(name) => void handleAutoBackupImport(name)}
            onSaveAs={(name) => void handleAutoBackupSaveAs(name)}
            onDelete={(name) => void handleAutoBackupDelete(name)}
            onClose={() => setBackupDialogOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* 数据存放位置的知情确认：复制（新目录）/ 采用（重装恢复）/ 恢复默认。
          确认即迁移并自动重启；取消清空主进程 offer，不落任何盘。 */}
      <AnimatePresence>
        {dataLocConfirm === 'copy' && dataLoc.offered && (
          <ConfirmDialog
            message={t('settings.dataLocationConfirmCopy', { path: dataLoc.offered })}
            confirmLabel={t('settings.dataLocationConfirmCopyLabel')}
            onConfirm={() => void confirmDataLocation()}
            onClose={cancelDataLocation}
          />
        )}
        {dataLocConfirm === 'adopt' && dataLoc.offered && (
          <ConfirmDialog
            message={t('settings.dataLocationConfirmAdopt')}
            confirmLabel={t('settings.dataLocationConfirmAdoptLabel')}
            onConfirm={() => void confirmDataLocation()}
            onClose={cancelDataLocation}
          />
        )}
        {dataLocConfirm === 'reset' && (
          <ConfirmDialog
            message={t('settings.dataLocationResetConfirm')}
            confirmLabel={t('settings.dataLocationReset')}
            onConfirm={() => void confirmResetDataLocation()}
            onClose={() => setDataLocConfirm(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
