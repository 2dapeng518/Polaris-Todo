import { useState } from 'react'
import { startOfDay } from 'date-fns'
import { withTime } from '../../lib/dateTime'
import { useT } from '../../stores/useLocaleStore'
import { DateTimePicker } from '../DateTimePicker'
import { Switch } from '../settings/SettingsRow'
import type { DetailPopoverProps } from './types'

// 首帧预估高度：标题行 + 全天行 + 开始/结束分段 + 42 格月历 + 时间行 +
// 清除按钮。useAnchoredPopover 用它在实测前决定朝上/朝下。
export const TIME_ESTIMATED_HEIGHT = 452

const HOUR_MS = 3600000
const MINIMUM_SLICE_MS = 15 * 60000

// 时间段弹层（日历套件 P0.3）：编辑 startAt / endAt / allDay。280px 宽的
// 弹层放不下两份 42 格月历，所以用「开始 | 结束」分段切换共用一个
// DateTimePicker；截止日（dueAt）仍是日历分组的锚点，这里只改计划时间段。
export function TimePopover({ task, onPatch, onClose }: DetailPopoverProps) {
  const t = useT()
  const [segment, setSegment] = useState<'start' | 'end'>('start')

  const startIso = task.startAt
  const endIso = task.endAt

  // 开始变更：已有结束时刻就保持时长整体平移，没有就不替用户造一个结束。
  const patchStart = (iso: string): void => {
    if (endIso && startIso) {
      const duration = new Date(endIso).getTime() - new Date(startIso).getTime()
      onPatch({
        startAt: iso,
        endAt: new Date(new Date(iso).getTime() + Math.max(0, duration)).toISOString()
      })
      return
    }
    onPatch({ startAt: iso })
  }

  // 结束变更：不许早于（或等于）开始，夹到开始 + 15 分钟——时间轴最小刻度。
  const patchEnd = (iso: string): void => {
    if (!startIso) {
      onPatch({ endAt: iso })
      return
    }
    const startMs = new Date(startIso).getTime()
    const next = new Date(iso).getTime() <= startMs ? startMs + MINIMUM_SLICE_MS : new Date(iso).getTime()
    onPatch({ endAt: new Date(next).toISOString() })
  }

  // 全天开关：纯粹的显示语义（视图忽略钟点），不改已存的时刻。唯一例外是
  // 还没有任何时刻时——先按截止日（无截止取今天）建一个全天锚点，让开关
  // 点下去永远有可见结果。
  const toggleAllDay = (): void => {
    if (!task.allDay && !startIso && !endIso) {
      const day = task.dueAt ? new Date(task.dueAt) : new Date()
      onPatch({
        allDay: true,
        startAt: startOfDay(day).toISOString(),
        endAt: withTime(day, 23, 59).toISOString()
      })
      return
    }
    onPatch({ allDay: !task.allDay })
  }

  const activeValue = segment === 'start' ? startIso : endIso
  // DateTimePicker 的兜底：开始取截止日（无截止取现在）；结束取开始 + 1 小时。
  const fallbackIso =
    segment === 'start'
      ? (task.dueAt ?? new Date().toISOString())
      : new Date((startIso ? new Date(startIso).getTime() : Date.now()) + HOUR_MS).toISOString()

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>{t('detail.popover.time')}</span>
        <span className="detail-popover-readout">
          {startIso || endIso ? undefined : t('detail.notSet')}
        </span>
      </div>

      <div className="detail-time-allday">
        <span className="detail-time-allday-label">{t('detail.time.allDay')}</span>
        <Switch checked={task.allDay} label={t('detail.time.allDay')} onToggle={toggleAllDay} />
      </div>

      <div className="detail-chips detail-popover-quick" role="group" aria-label={t('detail.popover.time')}>
        <button
          type="button"
          className={`detail-chip ${segment === 'start' ? 'active' : ''}`}
          aria-pressed={segment === 'start'}
          onClick={() => setSegment('start')}
        >
          {t('detail.time.start')}
        </button>
        <button
          type="button"
          className={`detail-chip ${segment === 'end' ? 'active' : ''}`}
          aria-pressed={segment === 'end'}
          onClick={() => setSegment('end')}
        >
          {t('detail.time.end')}
        </button>
      </div>

      <DateTimePicker
        key={segment}
        value={activeValue}
        fallback={fallbackIso}
        label={segment === 'start' ? t('detail.time.start') : t('detail.time.end')}
        onChange={segment === 'start' ? patchStart : patchEnd}
        onDone={onClose}
      />

      <button
        className="detail-popover-clear"
        onClick={() => {
          onPatch({ startAt: null, endAt: null, allDay: false })
          onClose()
        }}
      >
        {t('detail.clearTime')}
      </button>
    </>
  )
}
