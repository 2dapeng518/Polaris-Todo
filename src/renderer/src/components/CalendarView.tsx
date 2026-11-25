import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameMonth, startOfMonth } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import type { Task } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { useCalendarStore, parseDayKey } from '../stores/useCalendarStore'
import { clampToMonth, dayKey } from '../lib/dateTime'
import { ChevronLeft, ChevronRight, PanelLeftOpen } from './Icon'
import { MonthGrid } from './calendar/MonthGrid'
import { MiniMonth } from './calendar/MiniMonth'
import { MonthJumpMenu } from './calendar/MonthJumpMenu'
import { CalendarListView } from './calendar/CalendarListView'
import { CalendarBoardView } from './calendar/CalendarBoardView'
import { TimeGridView, visibleDaysFor, type TimeMode } from './calendar/TimeGridView'

// 日历套件外壳：工具栏（视图切换器 + 翻页 + 年月下拉 + 今天 + 迷你月历开关）
// + 左侧迷你月历栏 + 按子视图模式渲染内容（月 / 列表 / 看板 / 周 / 多周 /
// 日 / 多日）。锚点日住 useCalendarStore（跨子视图/会话持久），切换视图不丢
// 锚点；月视图另有本地「可见月」状态（键盘跨月），离开日历时写回锚点。

// 切换器顺序 = 主流待办应用的阅读顺序：月 / 周 / 多周 / 日 / 多日 / 列表 / 看板。
const SWITCHER_MODES = ['month', 'week', 'multiweek', 'day', 'multiday', 'list', 'board'] as const
type SwitcherMode = (typeof SWITCHER_MODES)[number]

const TIME_MODES: readonly TimeMode[] = ['week', 'multiweek', 'day', 'multiday']

const firstOfMonth = (date: Date): Date => {
  const copy = new Date(date)
  copy.setDate(1)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function CalendarView() {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const selectTask = useTaskStore((state) => state.selectTask)
  const mode = useCalendarStore((state) => state.mode)
  const anchorKey = useCalendarStore((state) => state.anchor)
  const miniOpen = useCalendarStore((state) => state.miniOpen)
  const setMode = useCalendarStore((state) => state.setMode)
  const setAnchor = useCalendarStore((state) => state.setAnchor)
  const toggleMini = useCalendarStore((state) => state.toggleMini)

  // 日历可能长时间开着：跨过午夜后「今天」的高亮不能还是昨天。
  const [now, setNow] = useState(() => new Date())
  // 月视图的可见月：本地状态（键盘跨月会改它），进入组件/锚点跨月时从锚点回填。
  const [month, setMonth] = useState(() => firstOfMonth(parseDayKey(anchorKey)))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const anchorDay = useMemo(() => parseDayKey(anchorKey), [anchorKey])
  const en = locale === 'en'
  const timeMode = TIME_MODES.includes(mode as TimeMode) ? (mode as TimeMode) : null

  // 任务归属日：dueAt 优先、计划开始兜底（与列表/看板同一套 calendarDay 规则），
  // 月格与迷你月历的点标记共用这一份桶。
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) {
      const source = task.dueAt ?? task.startAt
      if (!source) continue
      const key = dayKey(new Date(source))
      const list = map.get(key) ?? []
      list.push(task)
      map.set(key, list)
    }
    return map
  }, [tasks])
  const markedDays = useMemo(() => new Set(byDay.keys()), [byDay])

  // 工具栏翻页：月视图翻「月」，时间轴翻一个可见窗（周/日/多日/两周）。
  // 都只动各自的本地/锚点状态，不做夹带同步。
  const shiftMonth = (delta: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }
  const shiftAnchor = (delta: number) => {
    setAnchor(addDays(anchorDay, delta))
  }
  const shiftStep = timeMode
    ? timeMode === 'week'
      ? 7
      : timeMode === 'multiweek'
        ? 14
        : timeMode === 'multiday'
          ? 3
          : 1
    : 1

  const goToday = () => {
    const today = new Date()
    setAnchor(today)
    setMonth(firstOfMonth(today))
  }

  // 年月下拉换月：保持锚点日的「几号」，月末自动钳制。
  const jumpToMonth = (target: Date) => {
    setMonth(firstOfMonth(target))
    setAnchor(clampToMonth(target, anchorDay.getDate()))
  }

  // 离开日历视图（切到其他 AppView / 组件卸载）时把可见月写回锚点——再回到
  // 日历时还在用户翻到的那个月（切换不丢月份锚点）。cleanup 只允许在真卸载
  // 时跑：useEffect 的清理函数在依赖每次变化时都会执行，若把 month 放进依赖，
  // 翻月的旧闭包会把上个月写回锚点，mode-sync effect 再把可见月拽回去——
  // 「今天」按钮按下去标签弹回原月的摇摆就是这么来的。经 ref 读最新值。
  const monthRef = useRef(month)
  monthRef.current = month
  const anchorDayRef = useRef(anchorDay)
  anchorDayRef.current = anchorDay
  useEffect(() => {
    return () => {
      useCalendarStore.getState().setAnchor(clampToMonth(monthRef.current, anchorDayRef.current.getDate()))
    }
  }, [])

  // 回到月视图时可见月跟锚点对齐：在时间轴/迷你月历里锚点可能已移到别的月。
  useEffect(() => {
    if (mode !== 'month') return
    if (!isSameMonth(anchorDay, month)) setMonth(firstOfMonth(anchorDay))
  }, [mode, anchorKey])

  // 时间轴模式的范围标签（月份标签位置显示它，仍是年月下拉的触发器）。
  const rangeLabel = useMemo(() => {
    if (!timeMode) return ''
    const days = visibleDaysFor(timeMode, anchorDay)
    const first = days[0]
    const last = days[days.length - 1]
    return en
      ? `${format(first, 'MMM d', { locale: enUS })} – ${format(last, 'MMM d', { locale: enUS })}`
      : `${format(first, 'M月d日', { locale: zhCN })} – ${format(last, 'M月d日', { locale: zhCN })}`
  }, [timeMode, anchorDay, en])

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-modes" role="tablist" aria-label={t('calendar.modeAria')}>
          {SWITCHER_MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={mode === candidate}
              className={`calendar-mode ${mode === candidate ? 'is-active' : ''}`}
              data-calendar-mode-tab={candidate}
              onClick={() => setMode(candidate as SwitcherMode)}
            >
              {t(`calendar.mode.${candidate}`)}
            </button>
          ))}
        </div>
        {(mode === 'month' || timeMode) && (
          <>
            <button
              className="calendar-nav"
              onClick={() => (timeMode ? shiftAnchor(-shiftStep) : shiftMonth(-1))}
              aria-label={t('calendar.prevMonth')}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            {/* 翻页播报复用可见的标签本身（标签是年月下拉的触发按钮）。 */}
            <MonthJumpMenu
              month={timeMode ? firstOfMonth(anchorDay) : month}
              onPick={jumpToMonth}
              label={timeMode ? rangeLabel : undefined}
            />
            <button
              className="calendar-nav"
              onClick={() => (timeMode ? shiftAnchor(shiftStep) : shiftMonth(1))}
              aria-label={t('calendar.nextMonth')}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </>
        )}
        <div className="calendar-toolbar-right">
          <button
            type="button"
            className={`calendar-mini-toggle ${miniOpen ? 'is-active' : ''}`}
            aria-pressed={miniOpen}
            aria-label={t('calendar.mini.toggle')}
            title={t('calendar.mini.toggle')}
            onClick={toggleMini}
          >
            <PanelLeftOpen size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button className="calendar-today" onClick={goToday}>
            {t('calendar.today')}
          </button>
        </div>
      </div>

      <div className="calendar-body">
        {miniOpen && mode !== 'month' && (
          <aside className="calendar-mini">
            <MiniMonth
              anchor={anchorDay}
              now={now}
              locale={locale}
              markedDays={markedDays}
              onSelect={setAnchor}
              prevMonthAria={t('calendar.prevMonth')}
              nextMonthAria={t('calendar.nextMonth')}
              gridAria={t('calendar.mini.toggle')}
            />
          </aside>
        )}

        <div className="calendar-content">
          {mode === 'month' && (
            <MonthGrid
              month={month}
              anchorKey={anchorKey}
              now={now}
              locale={locale}
              byDay={byDay}
              onSelectTask={selectTask}
              onMonthChange={setMonth}
            />
          )}
          {timeMode && (
            <TimeGridView
              mode={timeMode}
              tasks={tasks}
              now={now}
              anchorKey={anchorKey}
              onAnchorChange={setAnchor}
              parseDayKey={parseDayKey}
            />
          )}
          {mode === 'list' && <CalendarListView tasks={tasks} now={now} />}
          {mode === 'board' && <CalendarBoardView tasks={tasks} now={now} />}
        </div>
      </div>
    </div>
  )
}
