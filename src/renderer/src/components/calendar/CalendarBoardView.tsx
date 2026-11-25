import { useMemo } from 'react'
import { Flag, ListChecks, Repeat2 } from '../Icon'
import type { Task } from '@shared/types'
import { recurrenceLabel } from '@shared/recurrence'
import { useTaskStore } from '../../stores/useTaskStore'
import { useT, useLocale } from '../../stores/useLocaleStore'
import { isOverdue } from '../../lib/dates'
import { buildBoardColumns } from './grouping'

// 日历看板视图（日历套件 P1.3）：无日期 / 已过期 / 今天起 7 天 / 更远 的
// 卡片泳道。卡片可拖拽跨列：日列 = 改归属日（保留原钟点），无日期列 =
// 清空日程，已过期/更远列不接收拖放（拖进「更远」没有明确的日期语义）。
// 原生 HTML5 DnD：Electron/Chromium 下拖拽图片默认预览可接受，不加 polyfill。

const DRAG_TYPE = 'text/polaris-task-id'

// 拖入日列时的新截止：保留原截止的钟点（拖动不改「几点做」，只改「哪天做」）；
// 没有截止的任务落到 09:00（全天任务保持全天：只挪日期、钟点保持 00:00）。
function dueAtForDay(task: Task, day: Date): string {
  const source = task.dueAt ? new Date(task.dueAt) : null
  const hours = source && !task.allDay ? source.getHours() : task.allDay ? 0 : 9
  const minutes = source && !task.allDay ? source.getMinutes() : 0
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).toISOString()
}

export function CalendarBoardView({ tasks, now }: { tasks: Task[]; now: Date }) {
  const t = useT()
  const locale = useLocale()
  const projects = useTaskStore((state) => state.projects)
  const updateTask = useTaskStore((state) => state.updateTask)
  const selectTask = useTaskStore((state) => state.selectTask)

  const labels = useMemo(
    () => ({
      overdue: t('calendar.group.overdue'),
      noDate: t('calendar.group.noDate'),
      today: t('calendar.today'),
      tomorrow: t('calendar.tomorrow'),
      far: t('calendar.group.far')
    }),
    [t]
  )

  const columns = useMemo(
    () => buildBoardColumns(tasks.filter((task) => !task.completed), now, locale, labels),
    [tasks, now, locale, labels]
  )

  const onDropTo = (column: { droppable: boolean; day: Date | null; kind: string }) => (
    event: React.DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    const id = event.dataTransfer.getData(DRAG_TYPE)
    if (!id || !column.droppable) return
    const task = tasks.find((candidate) => candidate.id === id)
    if (!task) return
    if (column.kind === 'noDate') {
      // 归入无日期 = 清空整套日程（截止 + 计划时间段一起退场）。
      void updateTask(id, { dueAt: null, startAt: null, endAt: null, allDay: false })
      return
    }
    if (column.day) {
      // 只动 dueAt（日历分组的锚点）；计划时间段原样保留，由详情/时间轴细调。
      void updateTask(id, { dueAt: dueAtForDay(task, column.day) })
    }
  }

  if (tasks.filter((task) => !task.completed).length === 0) {
    return (
      <div className="calendar-empty" data-calendar-board-empty>
        <div className="calendar-empty-title">{t('calendar.empty.board.title')}</div>
        <div className="calendar-empty-desc">{t('calendar.empty.board.desc')}</div>
      </div>
    )
  }

  return (
    <div className="calendar-board" data-calendar-board>
      {columns.map((column) => (
        <div
          key={column.key}
          className={`calendar-board-col is-${column.kind}`}
          data-board-col={column.key}
          onDragOver={(event) => {
            if (column.droppable) event.preventDefault()
          }}
          onDrop={onDropTo(column)}
        >
          <div className="calendar-board-head">
            <span className={column.kind === 'overdue' ? 'is-overdue' : ''}>{column.label}</span>
            <span className="calendar-board-count">{column.tasks.length}</span>
          </div>
          <div className="calendar-board-cards">
            {column.tasks.map((task) => {
              const project = task.projectId
                ? projects.find((candidate) => candidate.id === task.projectId)
                : undefined
              return (
                <div
                  key={task.id}
                  className="calendar-board-card"
                  draggable
                  data-board-card={task.id}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, task.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <button
                    type="button"
                    className="calendar-board-title"
                    onClick={() => selectTask(task.id)}
                  >
                    {task.priority >= 2 && (
                      <Flag size={11} strokeWidth={1.8} className="board-flag" aria-hidden="true" />
                    )}
                    <span>{task.title}</span>
                  </button>
                  <div className="calendar-board-meta">
                    {task.dueAt && !task.allDay && (
                      <span className={`board-time ${!task.completed && isOverdue(task.dueAt) ? 'is-overdue' : ''}`}>
                        {formatBoardTime(task.dueAt, locale === 'en')}
                      </span>
                    )}
                    {task.allDay && <span className="board-time">{t('detail.time.allDay')}</span>}
                    {task.recurrenceRule && (
                      <span className="board-chip" title={recurrenceLabel(task.recurrenceRule, locale)}>
                        <Repeat2 size={10} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                    )}
                    {task.subtaskTotal > 0 && (
                      <span className="board-chip">
                        <ListChecks size={10} strokeWidth={1.8} aria-hidden="true" />
                        {task.subtaskDone}/{task.subtaskTotal}
                      </span>
                    )}
                    {task.tags.map((tag) => (
                      <span key={tag.id} className="board-chip">#{tag.name}</span>
                    ))}
                    {project && (
                      <span className="board-chip board-project">
                        <span className="board-dot" style={{ background: project.color }} aria-hidden="true" />
                        {project.name}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {column.tasks.length === 0 && (
              <div className="calendar-board-blank">{column.droppable ? t('calendar.board.dropHere') : ''}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatBoardTime(iso: string, english: boolean): string {
  const date = new Date(iso)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return english ? `${date.getHours() % 12 || 12}:${mm} ${date.getHours() < 12 ? 'AM' : 'PM'}` : `${hh}:${mm}`
}
