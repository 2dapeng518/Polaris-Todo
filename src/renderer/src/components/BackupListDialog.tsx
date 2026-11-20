import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import type { AutoBackupItem } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useT, useLocale } from '../stores/useLocaleStore'

/** 备份行时间戳跟随界面语言；大小给人类可读单位，列表不解析文件内容。
    设置页网盘状态行与本对话框共用，导出复用不造第二份。 */
export function formatBackupWhen(mtimeMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(mtimeMs)
}

export function formatBackupSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type BackupListDialogProps = {
  /** 打开前已由设置页重读 backups:list（newest first）；null 只在读取失败时出现。 */
  items: AutoBackupItem[] | null
  loadError: string | null
  busy: boolean
  /** 导入/另存为的反馈：与备份卡共用同一份状态，落对话框常驻槽可见。 */
  status: string | null
  error: string | null
  onImport: (name: string) => void
  onSaveAs: (name: string) => void
  onClose: () => void
}

// 自动备份管理对话框（用户拍板：列表从内联手风琴改模态，根除展开撑高抖动）。
// 复用 ConfirmDialog/UpdateDialog 范式：confirm-overlay 盖设置面板（80 > 70）、
// 焦点陷阱、Esc 在 React 根停传播只关自己、点外关闭。列表对话框内滚动不裁切，
// 设置面板几何全程不动。导入/另存语义不变（additive 合并 / 原生保存对话框），
// 文件名门禁仍由主进程 isAutoBackupFileName 把守。
export function BackupListDialog({
  items,
  loadError,
  busy,
  status,
  error,
  onImport,
  onSaveAs,
  onClose
}: BackupListDialogProps) {
  const t = useT()
  const locale = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  // 默认焦点落「关闭」：Enter 不会直接触发导入。
  useFocusTrap(panelRef, !paletteOpen, closeRef)

  // Ctrl+K 不触发 pointerdown，命令面板抢占时对话框自己让位。
  useEffect(() => {
    if (paletteOpen) onClose()
  }, [paletteOpen, onClose])

  const title = t('settings.autoBackupDialogTitle', { count: items?.length ?? 0 })
  // 反馈槽常驻占位：默认落合并语义说明（单行 ellipsis + title 全文），
  // 导入/另存为的结果替换进槽——对话框高度恒定，反馈不撑出第二段跳高。
  const slotText = error ?? status ?? t('settings.autoBackupDesc')

  return (
    <motion.div
      className="confirm-overlay backup-dialog-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={onClose}
    >
      <motion.div
        className="confirm-panel backup-dialog-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // React 在 root 分发，先于 window 监听器：在这里停住，
          // 设置面板的 window Esc 就不会抢去整面板关闭。
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <div className="backup-dialog-title">{title}</div>

        {loadError && (
          <div className="settings-error" role="alert">{loadError}</div>
        )}
        {items !== null && items.length === 0 && (
          <div className="settings-hint backup-dialog-empty">{t('settings.autoBackupEmpty')}</div>
        )}
        {items !== null && items.length > 0 && (
          <ul className="auto-backup-list backup-dialog-list">
            {items.map((item) => (
              <li key={item.name} className="auto-backup-row" data-backup-name={item.name}>
                <span className="auto-backup-when" title={item.name}>
                  {formatBackupWhen(item.mtimeMs, locale)}
                </span>
                <span className="auto-backup-size">{formatBackupSize(item.sizeBytes)}</span>
                <span className="auto-backup-row-actions">
                  <button
                    className="backup-btn backup-btn--small"
                    disabled={busy}
                    onClick={() => onImport(item.name)}
                  >
                    {t('settings.autoBackupImport')}
                  </button>
                  <button
                    className="backup-btn backup-btn--small"
                    disabled={busy}
                    onClick={() => onSaveAs(item.name)}
                  >
                    {t('settings.autoBackupSaveAs')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div
          className={`backup-dialog-slot ${error ? 'settings-error' : 'settings-hint'}`}
          role={error ? 'alert' : 'status'}
          title={slotText}
        >
          {slotText}
        </div>

        <div className="confirm-actions">
          <button ref={closeRef} className="detail-popover-action" onClick={onClose}>
            {t('settings.autoBackupClose')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}