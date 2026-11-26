import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameMonth, startOfMonth } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import type { Task } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { useCalendarStore, parseDayKey } from '../stores/useCalendarStore'
import { useThemeStore } from '../stores/useThemeStore'
import { clampToMonth, dayKey } from '../lib/dateTime'
import { ChevronLeft, ChevronRight, PanelLeftOpen, Printer, Search } from './Icon'
import { MonthGrid } from './calendar/MonthGrid'
import { MiniMonth } from './calendar/MiniMonth'
import { MonthJumpMenu } from './calendar/MonthJumpMenu'
import { CalendarListView } from './calendar/CalendarListView'
import { CalendarBoardView } from './calendar/CalendarBoardView'
import { TimeGridView, visibleDaysFor, type TimeMode } from './calendar/TimeGridView'
import { CalendarDisplayMenu } from './calendar/CalendarDisplayMenu'
import { CalendarFilterMenu } from './calendar/CalendarFilterMenu'

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
  const showLunar = useCalendarStore((state) => state.showLunar)
  const showHolidays = useCalendarStore((state) => state.showHolidays)
  const showWeekNumbers = useCalendarStore((state) => state.showWeekNumbers)
  const calendarSearch = useCalendarStore((state) => state.calendarSearch)
  const calendarProjectFilter = useCalendarStore((state) => state.calendarProjectFilter)
  const calendarTagFilter = useCalendarStore((state) => state.calendarTagFilter)
  const setMode = useCalendarStore((state) => state.setMode)
  const setAnchor = useCalendarStore((state) => state.setAnchor)
  const toggleMini = useCalendarStore((state) => state.toggleMini)
  const setShowLunar = useCalendarStore((state) => state.setShowLunar)
  const setShowHolidays = useCalendarStore((state) => state.setShowHolidays)
  const setShowWeekNumbers = useCalendarStore((state) => state.setShowWeekNumbers)
  const setCalendarSearch = useCalendarStore((state) => state.setCalendarSearch)
  const setCalendarProjectFilter = useCalendarStore((state) => state.setCalendarProjectFilter)
  const setCalendarTagFilter = useCalendarStore((state) => state.setCalendarTagFilter)
  const projects = useTaskStore((state) => state.projects)
  const tags = useTaskStore((state) => state.tags)

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

  // 打印（P4.4）：打印前临时切昼白主题（深色主题纸面墨量不可接受），
  // 打印结束恢复。print() 在 Electron 里阻塞到预览关闭，afterprint 监听
  // 兜底覆盖异步完成的平台；restored 幂等防止两路都恢复。
  const printCalendar = (): void => {
    const previous = useThemeStore.getState().theme
    let restored = false
    const restore = (): void => {
      if (restored) return
      restored = true
      window.removeEventListener('afterprint', restore)
      useThemeStore.getState().setTheme(previous)
    }
    window.addEventListener('afterprint', restore)
    useThemeStore.getState().setTheme('light')
    try {
      window.print()
    } finally {
      // print() 返回时预览已关闭；延一帧给 afterprint 让路（幂等）。
      requestAnimationFrame(restore)
    }
  }

  // 日历内筛选（P3.5）：搜索（标题包含，不区分大小写）+ 项目/标签互斥。
  // 全部子视图吃同一份过滤结果；筛选是会话内的查询意图，不持久化。
  const calendarTasks = useMemo(() => {
    const needle = calendarSearch.trim().toLowerCase()
    return tasks.filter((task) => {
      if (needle && !task.title.toLowerCase().includes(needle)) return false
      if (calendarProjectFilter && task.projectId !== calendarProjectFilter) return false
      if (calendarTagFilter && !task.tags.some((tag) => tag.id === calendarTagFilter)) return false
      return true
    })
  }, [tasks, calendarSearch, calendarProjectFilter, calendarTagFilter])

  // 任务归属日：dueAt 优先、计划开始兜底（与列表/看板同一套 calendarDay 规则），
  // 月格与迷你月历的点标记共用这一份桶（点标记用全量任务，不受筛选影响）。
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of calendarTasks) {
      const source = task.dueAt ?? task.startAt
      if (!source) continue
      const key = dayKey(new Date(source))
      const list = map.get(key) ?? []
      list.push(task)
      map.set(key, list)
    }
    return map
  }, [calendarTasks])
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

  // 钻取（清单式）：点周视图表头的某天 / 月格的日期号，直接落到那天的
  // 日视图——锚点同步更新，切回周视图时该列仍在原位高亮。
  const jumpToDay = (day: Date) => {
    setAnchor(day)
    setMode('day')
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

  // 时间轴模式的标签（月份标签位置显示它，仍是年月下拉的触发器）。对齐
  // 主流待办应用：周/多周/多日只显示主体月份（跨月取中点日所在月，不写日期
  // 范围），单日显示完整日期——只有一天时只给月份信息量不足。
  const rangeLabel = useMemo(() => {
    if (!timeMode) return ''
    const days = visibleDaysFor(timeMode, anchorDay)
    if (timeMode === 'day') {
      return en
        ? format(days[0], 'MMM d', { locale: enUS })
        : format(days[0], 'M月d日', { locale: zhCN })
    }
    const mid = days[Math.floor((days.length - 1) / 2)]
    return en ? format(mid, 'MMMM', { locale: enUS }) : format(mid, 'M月', { locale: zhCN })
  }, [timeMode, anchorDay, en])

  return (
    // data-calendar-view：月/多周的「格子自适应视口、外层不出滚动条」高度链
    // 只按这两个模式生效（列表/看板依赖外层滚动，时间轴内部滚动）。
    <div className="calendar-view" data-calendar-view={mode}>
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
            className="calendar-tool-button"
            data-calendar-print
            aria-label={t('calendar.print')}
            title={t('calendar.print')}
            onClick={printCalendar}
          >
            <Printer size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <div className="calendar-search">
            <Search size={12} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="text"
              className="calendar-search-input"
              data-calendar-search
              value={calendarSearch}
              placeholder={t('calendar.search.placeholder')}
              aria-label={t('calendar.search.placeholder')}
              onChange={(event) => setCalendarSearch(event.target.value)}
            />
          </div>
          <CalendarFilterMenu
            projects={projects}
            tags={tags}
            projectFilter={calendarProjectFilter}
            tagFilter={calendarTagFilter}
            onProject={setCalendarProjectFilter}
            onTag={setCalendarTagFilter}
          />
          <CalendarDisplayMenu
            showLunar={showLunar}
            showHolidays={showHolidays}
            showWeekNumbers={showWeekNumbers}
            onLunar={setShowLunar}
            onHolidays={setShowHolidays}
            onWeekNumbers={setShowWeekNumbers}
          />
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
              showLunar={showLunar}
              showHolidays={showHolidays}
              showWeekNumbers={showWeekNumbers}
              onSelectTask={selectTask}
              onMonthChange={setMonth}
              onJumpToDay={jumpToDay}
            />
          )}
          {timeMode && (
            <TimeGridView
              mode={timeMode}
              tasks={calendarTasks}
              now={now}
              anchorKey={anchorKey}
              onAnchorChange={setAnchor}
              onJumpToDay={jumpToDay}
              parseDayKey={parseDayKey}
            />
          )}
          {mode === 'list' && <CalendarListView tasks={calendarTasks} now={now} />}
          {mode === 'board' && <CalendarBoardView tasks={calendarTasks} now={now} />}
        </div>
      </div>
    </div>
  )
}
