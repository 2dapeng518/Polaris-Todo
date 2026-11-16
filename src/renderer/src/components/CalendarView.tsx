import { useEffect, useMemo, useState } from 'react'
import type { Task } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { dayKey, monthLabel, monthMatrix, weekdayLabels } from '../lib/dateTime'
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
export function CalendarView() {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const selectTask = useTaskStore((state) => state.selectTask)
  const [month, setMonth] = useState(() => firstOfMonth(new Date()))
  // 日历可能长时间开着：跨过午夜后「今天」的高亮不能还是昨天。
  const [now, setNow] = useState(() => new Date())

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

  const shift = (delta: number) =>
    setMonth((current) => {
      const next = new Date(current)
      next.setMonth(next.getMonth() + delta)
      return next
    })

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
        <span className="calendar-month" data-calendar-month>
          {monthLabel(month, locale)}
        </span>
        <button
          className="calendar-nav"
          onClick={() => shift(1)}
          aria-label={t('calendar.nextMonth')}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button className="calendar-today" onClick={() => setMonth(firstOfMonth(new Date()))}>
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
      >
        {cells.map((day) => {
          const key = dayKey(day)
          const inMonth = day.getMonth() === month.getMonth()
          const dayTasks = byDay.get(key) ?? []
          const shown = dayTasks.slice(0, MAX_CHIPS)
          const rest = dayTasks.length - shown.length
          return (
            <div
              key={key}
              className={`calendar-cell ${inMonth ? '' : 'is-out'} ${key === todayKey ? 'is-today' : ''}`}
              role="gridcell"
              data-date={key}
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
