import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { addDays, addMonths, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import type { Task } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { clampToMonth, dayKey, monthLabel, monthMatrix, weekdayLabels } from '../lib/dateTime'
import { isOverdue } from '../lib/dates'
import { ChevronLeft, ChevronRight } from './Icon'

const MAX_CHIPS = 3

const firstOfMonth = (date: Date): Date => {
  const copy = new Date(date)
  copy.setDate(1)
  copy.setHours(0, 0, 0, 0)
  return copy
}

// 月历视图：复用选择器的 42 格月矩阵（周一起始），翻月高度恒定。
// 只展示有截止时间的任务；无截止不进日历。已完成任务弱化显示。
// 键盘导航照 DateTimePicker 的成熟模式：roving tabindex + 方向键/Home/End/
// PageUp/PageDown，跨月边界自动切月并把焦点落到对应日。
export function CalendarView() {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const selectTask = useTaskStore((state) => state.selectTask)
  const [month, setMonth] = useState(() => firstOfMonth(new Date()))
  // 日历可能长时间开着：跨过午夜后「今天」的高亮不能还是昨天。
  const [now, setNow] = useState(() => new Date())
  const [focusDay, setFocusDay] = useState(() => new Date())
  // 键盘焦点格用 :focus-visible 命中时的日期键：is-today 格聚焦时让位边框，
  // 避免 accent 边框 + accent 焦点环叠成双重点色边（同 .dp-day 的让位规则）。
  const [ringKey, setRingKey] = useState<string | null>(null)
  const focusRequest = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const cells = useMemo(() => monthMatrix(month), [month])
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) {
      if (!task.dueAt) continue
      const key = dayKey(new Date(task.dueAt))
      const list = map.get(key) ?? []
      list.push(task)
      map.set(key, list)
    }
    return map
  }, [tasks])
  const todayKey = dayKey(now)

  // 焦点日离开可见月（工具栏翻月）时，roving 落点回落到今天，再回落到月首
  // ——与 DateTimePicker 的 rovingDay 推导一致。
  const rovingDay = isSameMonth(focusDay, month)
    ? focusDay
    : isSameMonth(now, month)
      ? now
      : month

  // 方向键跨月会卸载聚焦的格子节点，焦点必须显式请求而非靠包含关系推断
  // （同 DateTimePicker 的 focusRequest 模式）。
  useLayoutEffect(() => {
    if (!focusRequest.current) return
    focusRequest.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${dayKey(rovingDay)}"]`)?.focus()
  }, [rovingDay, month])

  const shift = (delta: number) => {
    const target = addMonths(month, delta)
    // 焦点在格子里时翻月跟随焦点（日期号夹到目标月天数内）；焦点在工具栏
    // 按钮上时不抢焦点，只移动 roving 落点。
    if (gridRef.current?.contains(document.activeElement)) focusRequest.current = true
    setFocusDay(clampToMonth(target, rovingDay.getDate()))
    setMonth(target)
  }

  const goToday = () => {
    const today = new Date()
    if (gridRef.current?.contains(document.activeElement)) focusRequest.current = true
    setFocusDay(today)
    setMonth(firstOfMonth(today))
  }

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    // 只有格子本身响应导航键；chip 按钮上的 Enter/空格走原生点击，方向键
    // 不劫持（chip 是可点击控件，不是网格导航的一部分）。
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
      // 打开当天第一个任务（与 chip 点击同一条 selectTask 路径）；空日子不动作。
      const first = (byDay.get(dayKey(rovingDay)) ?? [])[0]
      if (first) selectTask(first.id)
    }
  }

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <button
          className="calendar-nav"
          onClick={() => shift(-1)}
          aria-label={t('calendar.prevMonth')}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        {/* 翻月播报复用可见的月份标签本身，不新增 i18n 键（选择器用独立
            live region，这里标签就在工具栏上，aria-live 即可）。 */}
        <span className="calendar-month" data-calendar-month aria-live="polite">
          {monthLabel(month, locale)}
        </span>
        <button
          className="calendar-nav"
          onClick={() => shift(1)}
          aria-label={t('calendar.nextMonth')}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button className="calendar-today" onClick={goToday}>
          {t('calendar.today')}
        </button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdayLabels(locale).map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        className="calendar-grid"
        role="grid"
        aria-label={t('calendar.gridAria', { month: monthLabel(month, locale) })}
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        onFocus={(event) => {
          const target = event.target as HTMLElement
          if (target.getAttribute('role') !== 'gridcell') return
          // 只在键盘焦点（:focus-visible）时让位 today 边框；鼠标点选格子
          // 不出现焦点环，today 标记必须原样保留。
          setRingKey(target.matches(':focus-visible') ? (target.dataset.date ?? null) : null)
        }}
        onBlur={() => setRingKey(null)}
      >
        {cells.map((day) => {
          const key = dayKey(day)
          const inMonth = day.getMonth() === month.getMonth()
          const isToday = key === todayKey
          const isRoving = isSameDay(day, rovingDay)
          const dayTasks = byDay.get(key) ?? []
          const shown = dayTasks.slice(0, MAX_CHIPS)
          const rest = dayTasks.length - shown.length
          return (
            <div
              key={key}
              className={`calendar-cell ${inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''}`}
              role="gridcell"
              data-date={key}
              tabIndex={isRoving ? 0 : -1}
              aria-current={isToday ? 'date' : undefined}
              // globals.css 本轮不可改，用内联样式实现「已有 accent 边框的
              // 控件聚焦时让位边框」的既有规则，避免双重 accent 边。
              style={isToday && ringKey === key ? { borderColor: 'transparent' } : undefined}
              aria-label={t('calendar.cellAria', {
                month: day.getMonth() + 1,
                day: day.getDate(),
                count: dayTasks.length
              })}
            >
              <span className="calendar-daynum">{day.getDate()}</span>
              <div className="calendar-chips">
                {shown.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`calendar-chip ${task.completed ? 'is-done' : ''} ${!task.completed && isOverdue(task.dueAt) ? 'is-overdue' : ''}`}
                    data-calendar-task={task.id}
                    title={task.title}
                    // ARIA grid 惯例：Tab 在复合控件间移动，不该穿过 42 格里
                    // 全部 chip。这里取混合式——只有 roving 格内的 chip 可 Tab
                    // （动线：格子 → 当天 chip → 出网格），其余格 chip tabindex=-1，
                    // 由方向键把 roving 带过去后再 Tab 进入。格子本身是 div 而非
                    // button：焦点陷阱的 FOCUSABLE 选择器数 button 不看 tabindex。
                    tabIndex={isRoving ? 0 : -1}
                    onClick={() => selectTask(task.id)}
                    aria-label={
                      task.completed
                        ? t('calendar.completedAria', { title: task.title })
                        : task.title
                    }
                  >
                    {task.priority >= 2 && <span className="calendar-chip-dot" aria-hidden="true" />}
                    <span className="calendar-chip-title">{task.title}</span>
                  </button>
                ))}
                {rest > 0 && <span className="calendar-more">+{rest}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}