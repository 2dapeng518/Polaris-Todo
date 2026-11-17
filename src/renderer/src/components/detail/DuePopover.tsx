import { useEffect, useRef, useState } from 'react'
import { Check } from '../Icon'
import { formatDue } from '../../lib/dates'
import { useLocale, useT } from '../../stores/useLocaleStore'
import { DateTimePicker } from '../DateTimePicker'
import { duePresets, quickDuePreset } from './presets'
import type { DetailPopoverProps } from './types'

// 首帧预估高度：标题行 + 快捷 chips + 42 格月历 + 时间行 + 清除按钮的实测
// 经验值，源自旧 TaskDetail.openPopover 的魔法数 372。useAnchoredPopover 用
// 它在实测前决定朝上/朝下，ResizeObserver 随后按 offsetHeight 校正。
export const DUE_ESTIMATED_HEIGHT = 372

export function DuePopover({ task, onPatch, onClose }: DetailPopoverProps) {
  const t = useT()
  const locale = useLocale()
  const [confirmClear, setConfirmClear] = useState(false)
  // Only the seed is frozen; the presets themselves keep recomputing so the
  // relative ones stay honest.
  const [fallback] = useState(() => quickDuePreset(t).value)
  const presets = duePresets(t)
  const clearRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const wasConfirming = useRef(false)

  useEffect(() => {
    if (confirmClear) {
      wasConfirming.current = true
      cancelRef.current?.focus()
      return
    }
    if (wasConfirming.current) {
      wasConfirming.current = false
      clearRef.current?.focus()
    }
  }, [confirmClear])

  // Move the reminder with the deadline, keeping its offset. Otherwise a due
  // date pushed far out silently drops the reminder on the next recurrence.
  const patchDue = (iso: string): void => {
    if (task.dueAt && task.remindAt) {
      const offset = new Date(task.dueAt).getTime() - new Date(task.remindAt).getTime()
      if (offset >= 0) {
        onPatch({
          dueAt: iso,
          remindAt: new Date(new Date(iso).getTime() - offset).toISOString()
        })
        return
      }
    }
    onPatch({ dueAt: iso })
  }

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>{t('detail.popover.due')}</span>
        <span className="detail-popover-readout">
          {task.dueAt ? formatDue(task.dueAt, locale) : t('detail.notSet')}
        </span>
      </div>
      <div className="detail-chips detail-popover-quick" role="group" aria-label={t('detail.quickDue')}>
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`detail-chip ${task.dueAt === preset.value ? 'active' : ''}`}
            onClick={() => {
              patchDue(preset.value)
              onClose()
            }}
          >
            {preset.label}
            {task.dueAt === preset.value && <Check size={12} strokeWidth={2} aria-hidden="true" />}
          </button>
        ))}
      </div>

      <DateTimePicker
        value={task.dueAt}
        fallback={fallback}
        label={t('detail.popover.due')}
        onChange={patchDue}
        onDone={onClose}
      />

      {confirmClear ? (
        <div
          className="detail-clear-warning"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            // React dispatches at the root, ahead of the window listener, so
            // this unwinds one level instead of closing the whole inspector.
            event.preventDefault()
            event.stopPropagation()
            setConfirmClear(false)
          }}
        >
          {t('detail.clearWarning')}
          <div className="detail-popover-actions">
            <button
              className="detail-popover-action detail-popover-danger"
              onClick={() => {
                onPatch({ dueAt: null, recurrenceRule: null })
                onClose()
              }}
            >
              {t('detail.clearBoth')}
            </button>
            <button
              ref={cancelRef}
              className="detail-popover-action"
              onClick={() => setConfirmClear(false)}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={clearRef}
          className="detail-popover-clear"
          onClick={() => {
            if (task.recurrenceRule) {
              setConfirmClear(true)
              return
            }
            onPatch({ dueAt: null })
            onClose()
          }}
        >
          {t('detail.clearDue')}
        </button>
      )}
    </>
  )
}