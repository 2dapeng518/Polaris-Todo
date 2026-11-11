import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Repeat2, Trash2, X } from 'lucide-react'
import { useTaskStore } from '../stores/useTaskStore'
import { formatDue } from '../lib/dates'

const DISMISS_AFTER = 6000

export function UndoToast() {
  const pending = useTaskStore((state) => state.pendingDeletion)
  const notice = useTaskStore((state) => state.notice)
  const undoDelete = useTaskStore((state) => state.undoDelete)
  const clearPendingDeletion = useTaskStore((state) => state.clearPendingDeletion)
  const clearNotice = useTaskStore((state) => state.clearNotice)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    setPaused(false)
  }, [pending?.id])

  useEffect(() => {
    if (!pending || paused) return
    const timer = window.setTimeout(() => clearPendingDeletion(), DISMISS_AFTER)
    return () => window.clearTimeout(timer)
  }, [pending, paused, clearPendingDeletion])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => clearNotice(), DISMISS_AFTER)
    return () => window.clearTimeout(timer)
  }, [notice, clearNotice])

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      void undoDelete()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, undoDelete])

  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      <AnimatePresence mode="popLayout">
        {pending ? (
          <motion.div
            key={`undo-${pending.id}`}
            className="toast"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setPaused(false)
              }
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            <span className="toast-message">已删除「{pending.title}」</span>
            <kbd className="toast-key">Ctrl Z</kbd>
            <button className="toast-action" onClick={() => void undoDelete()}>
              撤销
            </button>
          </motion.div>
        ) : notice ? (
          <motion.div
            key={`notice-${notice.dueAt}`}
            className="toast"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <Repeat2 size={14} aria-hidden="true" />
            <span className="toast-message">
              已创建下一次 · {formatDue(notice.dueAt)}
            </span>
            <button
              className="toast-dismiss"
              onClick={clearNotice}
              aria-label="关闭提示"
            >
              <X size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}