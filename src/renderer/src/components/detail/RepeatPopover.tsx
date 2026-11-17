import { useState } from 'react'
import type { Task } from '@shared/types'
import {
  RECURRENCE_PRESETS,
  buildCustomRecurrence,
  isCustomRecurrence,
  parseCustomRecurrence,
  recurrenceLabel,
  type CustomRecurrence
} from '@shared/recurrence'
import type { MessageKey } from '@shared/i18n'
import { formatDue } from '../../lib/dates'
import { useLocale, useT } from '../../stores/useLocaleStore'
import type { TaskPatch } from './types'

// 首帧预估高度：标题行 + 预设 chips（不展开自定义编辑器时）的实测经验值，
// 源自旧 TaskDetail.openPopover 的魔法数 220。展开编辑器后由 ResizeObserver
// 按真实高度校正。
export const REPEAT_ESTIMATED_HEIGHT = 220

const FREQ_OPTIONS: Array<{ freq: CustomRecurrence['freq']; key: MessageKey }> = [
  { freq: 'DAILY', key: 'detail.unit.day' },
  { freq: 'WEEKLY', key: 'detail.unit.week' },
  { freq: 'MONTHLY', key: 'detail.unit.month' },
  { freq: 'YEARLY', key: 'detail.unit.year' }
]

const WEEKDAY_OPTIONS: Array<{ code: string; key: MessageKey }> = [
  { code: 'MO', key: 'detail.week.1' },
  { code: 'TU', key: 'detail.week.2' },
  { code: 'WE', key: 'detail.week.3' },
  { code: 'TH', key: 'detail.week.4' },
  { code: 'FR', key: 'detail.week.5' },
  { code: 'SA', key: 'detail.week.6' },
  { code: 'SU', key: 'detail.week.7' }
]

type RepeatPopoverProps = {
  task: Task
  nextRecurrence: Date | null
  onPatch: (patch: TaskPatch) => void
}

export function RepeatPopover({ task, nextRecurrence, onPatch }: RepeatPopoverProps) {
  const t = useT()
  const locale = useLocale()
  const isCustomRule = isCustomRecurrence(task.recurrenceRule)
  const [customEditing, setCustomEditing] = useState(isCustomRule)
  const parsed = parseCustomRecurrence(task.recurrenceRule)
  const showEditor = customEditing || isCustomRule
  const freq = parsed?.freq ?? 'DAILY'
  const interval = parsed?.interval ?? 2
  const weekdays = parsed?.weekdays ?? []
  const unit = t(FREQ_OPTIONS.find((option) => option.freq === freq)?.key ?? 'detail.unit.day')

  // 规则是唯一真源：控件改动即时构建 RRULE 落库，回显再从规则解析，避免双状态失同步。
  const applyCustom = (next: Partial<CustomRecurrence>) => {
    onPatch({
      recurrenceRule: buildCustomRecurrence({
        freq: next.freq ?? freq,
        interval: next.interval ?? interval,
        weekdays: next.weekdays ?? weekdays
      })
    })
  }

  const toggleWeekday = (code: string) => {
    applyCustom({
      weekdays: weekdays.includes(code)
        ? weekdays.filter((day) => day !== code)
        : [...weekdays, code]
    })
  }

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>{t('detail.popover.repeat')}</span>
        <span className="detail-popover-readout">
          {task.recurrenceRule ? recurrenceLabel(task.recurrenceRule, locale) : t('detail.noRepeat')}
        </span>
      </div>
      <div className="detail-chips" role="group" aria-label={t('detail.repeatAria')}>
        {RECURRENCE_PRESETS.map((preset) => (
          <button
            key={preset.rule ?? 'none'}
            className={`detail-chip ${task.recurrenceRule === preset.rule && !customEditing ? 'active' : ''}`}
            data-popover-focus={task.recurrenceRule === preset.rule && !customEditing}
            disabled={!task.dueAt && preset.rule !== null}
            aria-pressed={task.recurrenceRule === preset.rule && !customEditing}
            onClick={() => {
              setCustomEditing(false)
              onPatch({ recurrenceRule: preset.rule })
            }}
          >
            {recurrenceLabel(preset.rule, locale)}
          </button>
        ))}
        <button
          className={`detail-chip ${showEditor ? 'active' : ''}`}
          disabled={!task.dueAt}
          aria-pressed={showEditor}
          onClick={() => {
            setCustomEditing(true)
            if (!task.recurrenceRule) onPatch({ recurrenceRule: 'FREQ=DAILY;INTERVAL=2' })
          }}
        >
          {t('detail.custom')}
        </button>
      </div>

      {showEditor && task.dueAt && (
        <div className="repeat-custom">
          <div className="repeat-field">
            <span className="repeat-field-label">{t('detail.freq')}</span>
            <div className="detail-chips" role="group" aria-label={t('detail.freqAria')}>
              {FREQ_OPTIONS.map((option) => (
                <button
                  key={option.freq}
                  className={`detail-chip ${freq === option.freq ? 'active' : ''}`}
                  aria-pressed={freq === option.freq}
                  onClick={() => applyCustom({ freq: option.freq })}
                >
                  {t(option.key)}
                </button>
              ))}
            </div>
          </div>
          <div className="repeat-field">
            <span className="repeat-field-label">{t('detail.interval')}</span>
            <div className="repeat-interval">
              <span className="repeat-field-label">{t('detail.every')}</span>
              <button
                className="repeat-step"
                onClick={() => applyCustom({ interval: Math.max(1, interval - 1) })}
                disabled={interval <= 1}
                aria-label={t('detail.decreaseInterval')}
              >
                −
              </button>
              <span className="repeat-interval-value" aria-live="polite">{interval}</span>
              <button
                className="repeat-step"
                onClick={() => applyCustom({ interval: Math.min(99, interval + 1) })}
                disabled={interval >= 99}
                aria-label={t('detail.increaseInterval')}
              >
                +
              </button>
              <span className="repeat-field-label">{unit}</span>
            </div>
          </div>
          {freq === 'WEEKLY' && (
            <div className="repeat-field">
              <span className="repeat-field-label">{t('detail.weekday')}</span>
              <div className="detail-chips" role="group" aria-label={t('detail.weekdayAria')}>
                {WEEKDAY_OPTIONS.map((option) => (
                  <button
                    key={option.code}
                    className={`detail-chip ${weekdays.includes(option.code) ? 'active' : ''}`}
                    aria-pressed={weekdays.includes(option.code)}
                    onClick={() => toggleWeekday(option.code)}
                  >
                    {t(option.key)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {task.recurrenceRule && (
        <div className="detail-popover-note">
          {nextRecurrence
            ? t('detail.nextAt', { date: formatDue(nextRecurrence.toISOString(), locale) })
            : t('detail.noNext')}
        </div>
      )}
      {!task.dueAt && (
        <div className="detail-popover-note">{t('detail.dueRequired')}</div>
      )}
    </>
  )
}