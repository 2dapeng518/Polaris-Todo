import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { addDays, addMonths, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import type { Locale } from '@shared/i18n'
import { clampToMonth, dayKey, monthLabel, monthMatrix, weekdayLabels } from '../../lib/dateTime'
import { ChevronLeft, ChevronRight } from '../Icon'

// 迷你月历（日历套件 P1.5）：小月格点日期跳转，主视图锚点跟随。只在有任务
// 的日子画点。键盘导航照 CalendarView 的 roving 模式（单 Tab 停留点），格子
// 是 div[role=gridcell] 而非按钮——焦点陷阱的 FOCUSABLE 选择器数 button。
type MiniMonthProps = {
  anchor: Date
  now: Date
  locale: Locale
  markedDays: Set<string>
  onSelect: (day: Date) => void
  prevMonthAria: string
  nextMonthAria: string
  gridAria: string
}

export function MiniMonth({ anchor, now, locale, markedDays, onSelect, prevMonthAria, nextMonthAria, gridAria }: MiniMonthProps) {
  const [month, setMonth] = useState(() => startOfMonth(anchor))
  const [focusDay, setFocusDay] = useState(anchor)
  const focusRequest = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // 锚点被外部改了（迷你点日 / 主视图翻月 / 今天）：所在月不同就跟随。
  useEffect(() => {
    if (!isSameMonth(anchor, month)) setMonth(startOfMonth(anchor))
    setFocusDay(anchor)
    // month 只参与判定，不作为重置源，故不入依赖。
  }, [anchor])

  const cells = useMemo(() => monthMatrix(month), [month])
  const todayKey = dayKey(now)
  const rovingDay = isSameMonth(focusDay, month)
    ? focusDay
    : isSameMonth(now, month)
      ? now
      : month

  // 跨月方向键会卸载聚焦的格子节点，焦点必须显式落回（CalendarView 同款）。
  useLayoutEffect(() => {
    if (!focusRequest.current) return
    focusRequest.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-mini-date="${dayKey(rovingDay)}"]`)?.focus()
  }, [rovingDay, month])

  const shift = (delta: number) => {
    const target = addMonths(month, delta)
    if (gridRef.current?.contains(document.activeElement)) focusRequest.current = true
    setFocusDay(clampToMonth(target, rovingDay.getDate()))
    setMonth(target)
  }

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if ((event.target as HTMLElement).getAttribute('role') !== 'gridcell') return
    const key = event.key
    const move = (next: Date): void => {
      event.preventDefault()
      focusRequest.current = true
      setFocusDay(next)
      if (!isSameMonth(next, month)) setMonth(startOfMonth(next))
    }
    if (key === 'ArrowLeft') return move(addDays(rovingDay, -1))
    if (key === 'ArrowRight') return move(addDays(rovingDay, 1))
    if (key === 'ArrowUp') return move(addDays(rovingDay, -7))
    if (key === 'ArrowDown') return move(addDays(rovingDay, 7))
    if (key === 'Home') return move(startOfWeek(rovingDay, { weekStartsOn: 1 }))
    if (key === 'End') return move(addDays(startOfWeek(rovingDay, { weekStartsOn: 1 }), 6))
    if (key === 'PageUp' || key === 'PageDown') {
      event.preventDefault()
      const target = addMonths(month, (key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1))
      focusRequest.current = true
      setMonth(target)
      setFocusDay(clampToMonth(target, rovingDay.getDate()))
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      onSelect(rovingDay)
    }
  }

  return (
    <div className="mini-month">
      <div className="mini-month-head">
        <button type="button" className="mini-month-nav" onClick={() => shift(-1)} aria-label={prevMonthAria}>
          <ChevronLeft size={12} aria-hidden="true" />
        </button>
        <span className="mini-month-label">{monthLabel(month, locale)}</span>
        <button type="button" className="mini-month-nav" onClick={() => shift(1)} aria-label={nextMonthAria}>
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="mini-month-weekdays" aria-hidden="true">
        {weekdayLabels(locale).map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mini-month-grid" role="grid" aria-label={gridAria} ref={gridRef} onKeyDown={onGridKeyDown}>
        {cells.map((day) => {
          const key = dayKey(day)
          const inMonth = day.getMonth() === month.getMonth()
          const isToday = key === todayKey
          const isAnchor = isSameDay(day, anchor)
          const isRoving = isSameDay(day, rovingDay)
          return (
            <div
              key={key}
              className={`mini-month-cell ${inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''} ${isAnchor ? 'is-anchor' : ''}`}
              role="gridcell"
              data-mini-date={key}
              tabIndex={isRoving ? 0 : -1}
              aria-current={isToday ? 'date' : undefined}
              aria-label={key}
              onClick={() => onSelect(day)}
            >
              <span className="mini-month-daynum">{day.getDate()}</span>
              {markedDays.has(key) && <span className="mini-month-dot" aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
