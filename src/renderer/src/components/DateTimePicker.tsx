import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject
} from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { addDays, addMonths, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import {
  WEEKDAY_LABELS,
  clampPart,
  clampToMonth,
  dayKey,
  dayLabel,
  dayPart,
  draftFrom,
  draftToIso,
  isComplete,
  laterToday,
  monthFor,
  monthLabel,
  monthMatrix,
  normalizeDigits,
  pad2,
  partMax,
  shiftMinutes,
  withTime,
  wrapPart,
  type Draft,
  type TimePart
} from '../lib/dateTime'

export type DateTimePickerProps = {
  value: string | null
  fallback: string
  label: string
  onChange: (iso: string) => void
  onDone: () => void
}

export function DateTimePicker({ value, fallback, label, onChange, onDone }: DateTimePickerProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(value, fallback))
  const [month, setMonth] = useState<Date>(() => monthFor(value))
  const [focusDay, setFocusDay] = useState<Date>(() => draftFrom(value, fallback).day)
  const [announce, setAnnounce] = useState('')

  const emitted = useRef<string | null>(value)
  const focusRequest = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const hourRef = useRef<HTMLInputElement | null>(null)
  const minuteRef = useRef<HTMLInputElement | null>(null)
  const monthId = useId()

  const today = new Date()
  const days = useMemo(() => monthMatrix(month), [month])
  // When the draft day leaves the visible month, the roving stop falls back to
  // today rather than to an adjacent-month cell.
  const rovingDay = isSameMonth(focusDay, month)
    ? focusDay
    : isSameMonth(today, month)
      ? today
      : startOfMonth(month)
  const selectedDay = value === null ? null : draft.day
  const previewDay = value === null ? draft.day : null
  const resetKey = draftToIso(draft)

  // Distinguish our own echo from a genuine external change: App reloads the
  // whole task list on window focus.
  useEffect(() => {
    if (value === emitted.current) return
    emitted.current = value
    const next = draftFrom(value, fallback)
    setDraft(next)
    setMonth(monthFor(value))
    setFocusDay(next.day)
  }, [value, fallback])

  // Clicking an adjacent-month cell unmounts the focused node, so focus has to
  // be requested explicitly rather than inferred from containment.
  useLayoutEffect(() => {
    if (!focusRequest.current) return
    focusRequest.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${dayKey(rovingDay)}"]`)?.focus()
  }, [rovingDay, month])

  // Single commit path. Reading the instant back keeps the display, the
  // spinbutton values and the stored row identical even across a DST gap.
  const commit = (next: Draft): Draft => {
    const iso = draftToIso(next)
    const actual = draftFrom(iso, fallback)
    emitted.current = iso
    setDraft(actual)
    if (dayKey(actual.day) !== dayKey(next.day)) {
      setFocusDay(actual.day)
      setMonth(startOfMonth(actual.day))
    }
    onChange(iso)
    return actual
  }

  const adjusted = (a: Draft, b: Draft): boolean =>
    a.hour !== b.hour || a.minute !== b.minute || dayKey(a.day) !== dayKey(b.day)

  const pickDay = (day: Date, focusTime: boolean): void => {
    const target = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    const now = new Date()
    let next: Draft = { ...draft, day: target }
    // Only switching TO today clamps a past time. Typing a time or picking a
    // past day is an explicit choice and is left alone.
    if (
      isSameDay(target, now) &&
      !isSameDay(draft.day, now) &&
      withTime(target, draft.hour, draft.minute).getTime() <= now.getTime()
    ) {
      next = laterToday(now)
    }
    setMonth(startOfMonth(next.day))
    setFocusDay(next.day)
    focusRequest.current = !focusTime
    const actual = commit(next)
    if (focusTime) {
      requestAnimationFrame(() => {
        hourRef.current?.focus()
        hourRef.current?.select()
      })
    }
    setAnnounce(
      `已选择 ${dayLabel(actual.day)} ${pad2(actual.hour)}:${pad2(actual.minute)}` +
        (adjusted(next, actual) ? '（该本地时间不存在，已调整）' : '')
    )
  }

  const commitTime = (next: Draft): void => {
    const actual = commit(next)
    if (adjusted(next, actual)) {
      setAnnounce(`该本地时间不存在，已调整为 ${pad2(actual.hour)}:${pad2(actual.minute)}`)
    }
  }

  const gotoMonth = (delta: number): void => {
    const target = addMonths(month, delta)
    if (gridRef.current?.contains(document.activeElement)) focusRequest.current = true
    setMonth(target)
    setFocusDay(clampToMonth(target, rovingDay.getDate()))
    setAnnounce(monthLabel(target))
  }

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    const key = event.key
    const move = (next: Date): void => {
      event.preventDefault()
      focusRequest.current = true
      setFocusDay(next)
      if (!isSameMonth(next, month)) {
        setMonth(startOfMonth(next))
        setAnnounce(monthLabel(next))
      }
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
      setAnnounce(monthLabel(target))
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      pickDay(rovingDay, true)
    }
  }

  return (
    <div className="dp">
      <div className="dp-head">
        <div className="dp-month" id={monthId}>
          <span className="dp-num">{month.getFullYear()}</span>
          <span className="dp-unit">年</span>
          <span className="dp-num">{month.getMonth() + 1}</span>
          <span className="dp-unit">月</span>
        </div>
        <button className="dp-today" type="button" onClick={() => pickDay(new Date(), false)}>
          今天
        </button>
        <button className="dp-nav" type="button" aria-label="上一月" onClick={() => gotoMonth(-1)}>
          <ChevronLeft size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button className="dp-nav" type="button" aria-label="下一月" onClick={() => gotoMonth(1)}>
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className="dp-week" aria-hidden="true">
        {WEEKDAY_LABELS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <MonthGrid
        month={month}
        days={days}
        rovingDay={rovingDay}
        today={today}
        selectedDay={selectedDay}
        previewDay={previewDay}
        labelId={monthId}
        gridRef={gridRef}
        onPick={(day) => pickDay(day, false)}
        onKeyDown={onGridKeyDown}
      />

      <TimeField
        draft={draft}
        empty={value === null}
        label={label}
        resetKey={resetKey}
        hourRef={hourRef}
        minuteRef={minuteRef}
        onCommit={commitTime}
        onDone={onDone}
      />

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </div>
  )
}

type MonthGridProps = {
  month: Date
  days: Date[]
  rovingDay: Date
  today: Date
  selectedDay: Date | null
  previewDay: Date | null
  labelId: string
  gridRef: RefObject<HTMLDivElement | null>
  onPick: (day: Date) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

function MonthGrid({
  month,
  days,
  rovingDay,
  today,
  selectedDay,
  previewDay,
  labelId,
  gridRef,
  onPick,
  onKeyDown
}: MonthGridProps) {
  return (
    <div
      className="dp-grid"
      role="grid"
      aria-labelledby={labelId}
      aria-multiselectable={false}
      ref={gridRef}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: 6 }, (_, row) => (
        <div className="dp-row" role="row" key={row}>
          {days.slice(row * 7, row * 7 + 7).map((day) => {
            const outside = !isSameMonth(day, month)
            const isToday = isSameDay(day, today)
            const isSelected = selectedDay !== null && isSameDay(day, selectedDay)
            const isPreview = previewDay !== null && isSameDay(day, previewDay)
            const isRoving = isSameDay(day, rovingDay)
            const className = [
              'dp-day',
              outside && 'is-outside',
              isToday && 'is-today',
              isSelected && 'is-selected',
              isPreview && 'is-preview'
            ]
              .filter(Boolean)
              .join(' ')
            const suffix = isToday ? '，今天' : outside ? (day < month ? '，上月' : '，下月') : ''
            return (
              <div
                key={dayKey(day)}
                role="gridcell"
                className={className}
                data-day={dayKey(day)}
                data-popover-focus={isRoving ? 'true' : undefined}
                tabIndex={isRoving ? 0 : -1}
                aria-selected={isSelected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${dayLabel(day)}${suffix}`}
                onClick={() => onPick(day)}
              >
                {day.getDate()}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

type TimeFieldProps = {
  draft: Draft
  empty: boolean
  label: string
  resetKey: string
  hourRef: RefObject<HTMLInputElement | null>
  minuteRef: RefObject<HTMLInputElement | null>
  onCommit: (next: Draft) => void
  onDone: () => void
}

function TimeField({
  draft,
  empty,
  label,
  resetKey,
  hourRef,
  minuteRef,
  onCommit,
  onDone
}: TimeFieldProps) {
  // null means "show the committed value". Typing keeps its own text until a
  // commit happens, so the field can never display one hour while storing another.
  const [hourText, setHourText] = useState<string | null>(null)
  const [minuteText, setMinuteText] = useState<string | null>(null)
  const composing = useRef(false)

  useEffect(() => {
    setHourText(null)
    setMinuteText(null)
  }, [resetKey])

  const setText = (part: TimePart, text: string | null): void => {
    if (part === 'hour') setHourText(text)
    else setMinuteText(text)
  }

  const withPart = (part: TimePart, value: number): Draft =>
    part === 'hour' ? { ...draft, hour: value } : { ...draft, minute: value }

  const apply = (part: TimePart, raw: string, advance: boolean): void => {
    const digits = normalizeDigits(raw)
    setText(part, digits)
    if (!digits) return
    // 完整性判据与失焦共用 isComplete，两处不能对「打完了没」各自解释。
    if (!isComplete(part, digits)) return
    onCommit(withPart(part, clampPart(part, Number(digits))))
    if (part === 'hour' && advance) {
      requestAnimationFrame(() => {
        minuteRef.current?.focus()
        minuteRef.current?.select()
      })
    }
  }

  const onPartKeyDown = (part: TimePart) => (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || composing.current) return
    const key = event.key

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault()
      const direction = key === 'ArrowUp' ? 1 : -1
      setHourText(null)
      setMinuteText(null)
      if (event.shiftKey) {
        onCommit(shiftMinutes(draft, direction * 15))
        return
      }
      onCommit(withPart(part, wrapPart(part, draft[part] + direction)))
      return
    }

    if (key === 'Home' || key === 'End') {
      event.preventDefault()
      setHourText(null)
      setMinuteText(null)
      onCommit(withPart(part, key === 'Home' ? 0 : partMax(part)))
      return
    }

    if (key === ':' && part === 'hour') {
      event.preventDefault()
      const digits = normalizeDigits(event.currentTarget.value)
      if (digits) onCommit(withPart('hour', clampPart('hour', Number(digits))))
      requestAnimationFrame(() => {
        minuteRef.current?.focus()
        minuteRef.current?.select()
      })
      return
    }

    if (key === 'Enter') {
      event.preventDefault()
      const digits = normalizeDigits(event.currentTarget.value)
      if (digits) {
        const value = clampPart(part, Number(digits))
        if (value !== draft[part]) onCommit(withPart(part, value))
      }
      setHourText(null)
      setMinuteText(null)
      onDone()
    }
  }

  const renderPart = (part: TimePart, ref: RefObject<HTMLInputElement | null>) => {
    const text = part === 'hour' ? hourText : minuteText
    const max = partMax(part)
    const unit = part === 'hour' ? '时' : '分'
    const name = part === 'hour' ? '小时' : '分钟'
    return (
      <input
        ref={ref}
        type="text"
        className="dp-part"
        inputMode="numeric"
        role="spinbutton"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} ${name}${empty ? '（未设置）' : ''}`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={draft[part]}
        aria-valuetext={`${draft[part]} ${unit}`}
        value={text ?? pad2(draft[part])}
        onFocus={(event) => {
          setText(part, pad2(draft[part]))
          event.currentTarget.select()
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          apply(part, event.currentTarget.value, true)
        }}
        onChange={(event) => {
          const raw = event.target.value
          if (composing.current) {
            setText(part, raw)
            return
          }
          apply(part, raw, true)
        }}
        onBlur={(event) => {
          const digits = normalizeDigits(event.target.value)
          setText(part, null)
          // 半截数字（小时的 '1'）打字时被判定为「还没打完」，失焦不能反过来把它
          // 定稿成 1 点：真实鼠标点 ±15 会先失焦，那样步进就基于错误的小时计算。
          // 丢弃即可，显示回落到已存储值。Enter 与 ':' 是显式确认，仍提交单个数字。
          if (!digits || !isComplete(part, digits)) return
          const value = clampPart(part, Number(digits))
          if (value !== draft[part]) onCommit(withPart(part, value))
        }}
        onKeyDown={onPartKeyDown(part)}
      />
    )
  }

  const step = (delta: number): void => {
    setHourText(null)
    setMinuteText(null)
    onCommit(shiftMinutes(draft, delta))
  }

  const total = draft.hour * 60 + draft.minute

  return (
    <div className="dp-time">
      <div className={`dp-clock${empty ? ' is-empty' : ''}`}>
        {renderPart('hour', hourRef)}
        <span className="dp-colon" aria-hidden="true">
          :
        </span>
        {renderPart('minute', minuteRef)}
        <span className="dp-meridiem" aria-hidden="true">
          {dayPart(draft.hour)}
        </span>
      </div>
      <button
        className="dp-step"
        type="button"
        aria-label="提前 15 分钟"
        aria-keyshortcuts="Shift+ArrowDown"
        title="提前 15 分钟"
        disabled={total === 0}
        onClick={() => step(-15)}
      >
        <Minus size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button
        className="dp-step"
        type="button"
        aria-label="推迟 15 分钟"
        aria-keyshortcuts="Shift+ArrowUp"
        title="推迟 15 分钟"
        disabled={total === 1439}
        onClick={() => step(15)}
      >
        <Plus size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  )
}