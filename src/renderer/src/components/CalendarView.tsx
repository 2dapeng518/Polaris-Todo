import { useEffect, useMemo, useState } from 'react'
import { startOfMonth } from 'date-fns'
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

// 日历套件外壳（日历套件 P1）：工具栏（视图切换器 + 翻月 + 年月下拉 + 今天
// + 迷你月历开关）+ 左侧迷你月历栏 + 按子视图模式渲染内容。P1 上线
// 月 / 列表 / 看板；周 / 多周 / 日 / 多日时间轴在 P2 接入同一套路由。
// 锚点日住 useCalendarStore（跨子视图/会话持久），切换视图不丢月份。

// P1 送到切换器上的模式；周系时间轴（P2）就绪后在此追加。
const SWITCHER_MODES = ['month', 'list', 'board'] as const

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

  // 工具栏翻月只动可见月；锚点在离开日历视图时统一写回（见下），避免键盘
  // 跨月时锚点被夹带改写、焦点被锚点跟随效应拽回钳制日。
  const shiftMonth = (delta: number) => {
    setMonth((current) => addMonthsClamped(current, delta))
  }

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
  // 日历时还在用户翻到的那个月（切换不丢月份锚点）。
  useEffect(() => {
    return () => {
      useCalendarStore.getState().setAnchor(clampToMonth(month, anchorDay.getDate()))
    }
  }, [month, anchorDay])

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
              onClick={() => setMode(candidate)}
            >
              {t(`calendar.mode.${candidate}`)}
            </button>
          ))}
        </div>
        {mode === 'month' && (
          <>
            <button
              className="calendar-nav"
              onClick={() => shiftMonth(-1)}
              aria-label={t('calendar.prevMonth')}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            {/* 翻月播报复用可见的月份标签本身（标签是年月下拉的触发按钮）。 */}
            <MonthJumpMenu month={month} onPick={jumpToMonth} />
            <button
              className="calendar-nav"
              onClick={() => shiftMonth(1)}
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
          {mode === 'list' && <CalendarListView tasks={tasks} now={now} />}
          {mode === 'board' && <CalendarBoardView tasks={tasks} now={now} />}
        </div>
      </div>
    </div>
  )
}

// 月位移工具：月份循环由 Date 构造器自动进位（13 月 = 次年 1 月）。
function addMonthsClamped(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1)
}
