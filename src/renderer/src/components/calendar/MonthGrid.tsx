import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { addDays, getISOWeek, isSameDay, isSameMonth, startOfWeek } from 'date-fns'
import type { Task } from '@shared/types'
import type { Locale } from '@shared/i18n'
import { lunarLabel } from '@shared/lunarDay'
import { holidayOf } from '@shared/holidays'
import { useT } from '../../stores/useLocaleStore'
import { useTaskStore } from '../../stores/useTaskStore'
import { parseDayKey } from '../../stores/useCalendarStore'
import { clampToMonth, dayKey, dayLabel, monthLabel, monthMatrix, weekdayLabelsShort } from '../../lib/dateTime'
import { hexToRgba } from '../../lib/colors'
import { isOverdue } from '../../lib/dates'

const MAX_CHIPS = 3

// 月网格（日历套件 P1 重构 / P3 信息层）：42 格月矩阵（周一起始）、roving
// 键盘导航的原有实现原样保留（类名/属性是冒烟断言的面）。月份改为受控：
// 可见月由套件外壳持有（工具栏/年月下拉/迷你月历都能换月），本组件只管
// roving 焦点——外部换月时焦点日期号钳到新月，锚点日被点选时同月内焦点
// 跟随。P3 信息层：农历/节气副标签、节假日休/班角标、左侧周数列，全部由
// 显示开关控制（useCalendarStore 持久化），默认全关——默认态像素与旧版
// 一致（周数列关掉时网格结构与旧版逐类名等价）。
type MonthGridProps = {
  month: Date
  anchorKey: string
  now: Date
  locale: Locale
  byDay: Map<string, Task[]>
  showLunar: boolean
  showHolidays: boolean
  showWeekNumbers: boolean
  onSelectTask: (id: string) => void
  onMonthChange: (month: Date) => void
  onJumpToDay: (day: Date) => void
}

export function MonthGrid({
  month,
  anchorKey,
  now,
  locale,
  byDay,
  showLunar,
  showHolidays,
  showWeekNumbers,
  onSelectTask,
  onMonthChange,
  onJumpToDay
}: MonthGridProps) {
  const t = useT()
  const projects = useTaskStore((state) => state.projects)
  const anchorDay = useMemo(() => parseDayKey(anchorKey), [anchorKey])
  const [focusDay, setFocusDay] = useState(anchorDay)
  const lastAnchorKey = useRef(anchorKey)
  // 键盘焦点格用 :focus-visible 命中时的日期键：is-today 格聚焦时让位边框，
  // 避免 accent 边框 + accent 焦点环叠成双重点色边（同 .dp-day 的让位规则）。
  const [ringKey, setRingKey] = useState<string | null>(null)
  const focusRequest = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // 锚点日被外部改变（迷你月历点日 / 「今天」）：同月内焦点跟随锚点日；
  // 跨月的换月走下面的 month effect。
  useEffect(() => {
    if (anchorKey === lastAnchorKey.current) return
    lastAnchorKey.current = anchorKey
    if (isSameMonth(anchorDay, month)) {
      focusRequest.current = gridRef.current?.contains(document.activeElement) ?? false
      setFocusDay(anchorDay)
    }
  }, [anchorKey, anchorDay, month])

  // 受控 month 被换走（工具栏翻月 / 年月下拉 / 键盘跨月）：焦点日期号保持
  // 原「几号」，钳到目标月天数内——与旧版 shift() 的语义一致。
  useEffect(() => {
    if (isSameMonth(focusDay, month)) return
    focusRequest.current = gridRef.current?.contains(document.activeElement) ?? false
    setFocusDay(clampToMonth(month, focusDay.getDate()))
  }, [month, focusDay])

  const cells = useMemo(() => monthMatrix(month), [month])
  const todayKey = dayKey(now)

  // 焦点日离开可见月（外部换月的中间帧）时，roving 落点回落到今天，再回落
  // 到月首——与 DateTimePicker 的 rovingDay 推导一致。
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
      if (!isSameMonth(next, month)) onMonthChange(new Date(next.getFullYear(), next.getMonth(), 1))
    }

    if (key === 'ArrowLeft') return move(addDays(rovingDay, -1))
    if (key === 'ArrowRight') return move(addDays(rovingDay, 1))
    if (key === 'ArrowUp') return move(addDays(rovingDay, -7))
    if (key === 'ArrowDown') return move(addDays(rovingDay, 7))
    if (key === 'Home') return move(startOfWeek(rovingDay, { weekStartsOn: 1 }))
    if (key === 'End') return move(addDays(startOfWeek(rovingDay, { weekStartsOn: 1 }), 6))
    if (key === 'PageUp' || key === 'PageDown') {
      event.preventDefault()
      const target = new Date(
        month.getFullYear(),
        month.getMonth() + (key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1),
        1
      )
      focusRequest.current = true
      onMonthChange(target)
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      // 打开当天第一个任务（与 chip 点击同一条 selectTask 路径）；空日子不动作。
      const first = (byDay.get(dayKey(rovingDay)) ?? [])[0]
      if (first) onSelectTask(first.id)
    }
  }

  // 月格 chip 的项目着色：经 CSS 变量（--chip-tint / --chip-tint-strong）注入，
  // hover 用浓一档的项目色而非被内联背景覆盖；无项目任务不注入，回落原样式。
  // 必须定义在 return 之前——renderCell 在 return 的 JSX 里被调用，const 在
  // TDZ 里会被 renderCell 的首次调用撞出 ReferenceError（整树卸载，shot 黑帧）。
  const chipTint = (task: Task): React.CSSProperties => {
    const color = task.projectId
      ? projects.find((candidate) => candidate.id === task.projectId)?.color
      : null
    if (!color) return {}
    return {
      '--chip-tint': hexToRgba(color, 0.14),
      '--chip-tint-strong': hexToRgba(color, 0.26),
      borderLeft: `3px solid ${color}`
    } as React.CSSProperties
  }

  return (
    <>
      <div
        className={`calendar-weekdays ${showWeekNumbers ? 'has-weeknums' : ''}`}
        aria-hidden="true"
      >
        {showWeekNumbers && <span />}
        {weekdayLabelsShort(locale).map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        className={`calendar-grid ${showWeekNumbers ? 'has-weeknums' : ''}`}
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
        {cells.map((day, index) => {
          const weekCell =
            showWeekNumbers && index % 7 === 0 ? (
              <div key={`week-${dayKey(day)}`} className="calendar-weeknum" aria-hidden="true">
                {getISOWeek(day)}
              </div>
            ) : null
          const cell = renderCell(day)
          return weekCell ? [weekCell, cell] : [cell]
        })}
      </div>
    </>
  )

  // 单格渲染（信息层在此叠加）：农历/节气副标签与休/班角标都由显示开关控制。
  // 函数声明提升，故可在上方 return 的 JSX 里调用（chipTint 是 const，必须在
  // return 前完成初始化——见其注释）。
  function renderCell(day: Date) {
    const key = dayKey(day)
    const inMonth = day.getMonth() === month.getMonth()
    const isToday = key === todayKey
    const isRoving = isSameDay(day, rovingDay)
    const dayTasks = byDay.get(key) ?? []
    const shown = dayTasks.slice(0, MAX_CHIPS)
    const rest = dayTasks.length - shown.length
    const lunar = showLunar && inMonth ? lunarLabel(day) : null
    const holiday = showHolidays ? holidayOf(day) : null
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
        <div className="calendar-cell-head">
          {/* 日期号可点（钻取）：直接落到那天的日视图；格子其余
              区域仍是 roving 选格。tabIndex=-1 不进 Tab 动线（与 chip 一致）。 */}
          <button
            type="button"
            className="calendar-daynum"
            tabIndex={-1}
            aria-label={dayLabel(day, locale)}
            onClick={(event) => {
              event.stopPropagation()
              onJumpToDay(day)
            }}
          >
            {day.getDate()}
          </button>
          {lunar && <span className="calendar-lunar">{lunar}</span>}
          {holiday && (
            <span
              className={`calendar-holiday-badge ${holiday.kind === 'workday' ? 'is-workday' : 'is-holiday'}`}
              title={`${holiday.name}${holiday.kind === 'workday' ? ' · ' + t('calendar.badge.workday') : ' · ' + t('calendar.badge.holiday')}`}
            >
              {holiday.kind === 'workday' ? t('calendar.badge.workday') : t('calendar.badge.holiday')}
            </span>
          )}
        </div>
        <div className="calendar-chips">
          {shown.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`calendar-chip ${task.completed ? 'is-done' : ''} ${!task.completed && isOverdue(task.dueAt) ? 'is-overdue' : ''}`}
              data-calendar-task={task.id}
              title={task.title}
              style={chipTint(task)}
              // ARIA grid 惯例：Tab 在复合控件间移动，不该穿过 42 格里
              // 全部 chip。这里取混合式——只有 roving 格内的 chip 可 Tab
              // （动线：格子 → 当天 chip → 出网格），其余格 chip tabindex=-1，
              // 由方向键把 roving 带过去后再 Tab 进入。格子本身是 div 而非
              // button：焦点陷阱的 FOCUSABLE 选择器数 button 不看 tabindex。
              tabIndex={isRoving ? 0 : -1}
              onClick={() => onSelectTask(task.id)}
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
  }
}
