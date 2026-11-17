import type { MouseEvent as ReactMouseEvent } from 'react'
import { ChevronRight } from '../Icon'

type ScheduleRowProps = {
  label: string
  value: string
  relative?: string
  muted?: boolean
  expanded: boolean
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

// 截止/提醒/重复的触发行。data-detail-row 是外点白名单的锚：点行本身
// 不算「点在外面」，否则开弹层的同一次 pointerdown 会立刻把它关掉。
export function ScheduleRow({ label, value, relative, muted, expanded, onOpen }: ScheduleRowProps) {
  return (
    <button
      type="button"
      className="detail-row"
      data-detail-row
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={relative ? `${value} · ${relative}` : value}
    >
      <span className="detail-row-label">{label}</span>
      <span className={`detail-row-value ${muted ? 'muted' : ''}`}>
        <span className="detail-row-main">{value}</span>
        {relative && <span className="detail-row-relative">{relative}</span>}
      </span>
      <ChevronRight
        size={12}
        strokeWidth={1.8}
        className="detail-row-chevron"
        aria-hidden="true"
      />
    </button>
  )
}