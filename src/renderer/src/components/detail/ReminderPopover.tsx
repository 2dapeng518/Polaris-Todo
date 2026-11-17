import { useState } from 'react'
import { Check } from '../Icon'
import { formatDue } from '../../lib/dates'
import { useLocale, useT } from '../../stores/useLocaleStore'
import { DateTimePicker } from '../DateTimePicker'
import { defaultReminderAt, reminderPresets } from './presets'
import type { DetailPopoverProps } from './types'

// 首帧预估高度：标题行 + 快捷 chips（最多 5 个）+ 42 格月历 + 时间行 +
// 底部说明/移除按钮的实测经验值，源自旧 TaskDetail.openPopover 的魔法数 406。
export const REMINDER_ESTIMATED_HEIGHT = 406

export function ReminderPopover({ task, onPatch, onClose }: DetailPopoverProps) {
  const t = useT()
  const locale = useLocale()
  const [fallback] = useState(() => defaultReminderAt(task))
  const presets = reminderPresets(task, t)

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>{t('detail.popover.reminder')}</span>
        <span className="detail-popover-readout">
          {task.remindAt ? formatDue(task.remindAt, locale) : t('detail.notSet')}
        </span>
      </div>
      <div className="detail-chips detail-popover-quick" role="group" aria-label={t('detail.quickReminder')}>
        {presets.map((preset) => (
          // Key on the label: relative presets change value every render, and
          // keying on it would remount the button and drop focus to <body>.
          <button
            key={preset.label}
            type="button"
            className={`detail-chip ${task.remindAt === preset.value ? 'active' : ''}`}
            onClick={() => {
              onPatch({ remindAt: preset.value })
              onClose()
            }}
          >
            {preset.label}
            {task.remindAt === preset.value && (
              <Check size={12} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <DateTimePicker
        value={task.remindAt}
        fallback={fallback}
        label={t('detail.reminderLabel')}
        onChange={(iso) => onPatch({ remindAt: iso })}
        onDone={onClose}
      />

      <div className="detail-popover-foot">
        <div className="detail-popover-note">{t('detail.reminderRunning')}</div>
        {task.remindAt && (
          <button
            className="detail-popover-clear"
            onClick={() => {
              onPatch({ remindAt: null })
              onClose()
            }}
          >
            {t('detail.removeReminder')}
          </button>
        )}
      </div>
    </>
  )
}