import { useEffect, useId, useRef } from 'react'
import { motion } from 'motion/react'
import { useTaskStore } from '../stores/useTaskStore'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useOverlayClose } from '../lib/useOverlayClose'
import { useT } from '../stores/useLocaleStore'

type ConfirmDialogProps = {
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

// 破坏性操作的二次确认（彻底删除 / 清空回收站共用）。挂在 AnimatePresence
// 里按需挂载；关闭时 useFocusTrap 的清理把焦点还给触发者，不用定时器。
// 危险按钮沿用 detail-popover-action + detail-popover-danger 的 tint 语言，
// 全 app 没有实心危险填充，这里也不造。
export function ConfirmDialog({ message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const messageId = useId()

  // 默认焦点落在取消上：Enter 不会直接触发不可逆操作。
  useFocusTrap(panelRef, !paletteOpen, cancelRef)
  // 设置窗口的 Esc 兜底栈：焦点漏在对话框外时，窗口级 Esc 只关掉本对话框。
  useOverlayClose(!paletteOpen, onClose)

  // Ctrl+K 不会触发 pointerdown，面板打开时这里必须自己让位。
  useEffect(() => {
    if (paletteOpen) onClose()
  }, [paletteOpen, onClose])

  return (
    <motion.div
      className="confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={onClose}
    >
      <motion.div
        className="confirm-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('dialog.confirm')}
        aria-describedby={messageId}
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // React 在 root 分发，先于 window 监听器；在这里停住，
          // TaskDetail 的 window Esc 就不会抢去关闭检查器。
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <p className="confirm-message" id={messageId}>{message}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="detail-popover-action" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="detail-popover-action detail-popover-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}