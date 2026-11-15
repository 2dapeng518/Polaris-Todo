import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from 'react'
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Repeat2,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Task } from '@shared/types'
import { RECURRENCE_PRESETS, buildCustomRecurrence, nextOccurrence, parseCustomRecurrence, recurrenceLabel, type CustomRecurrence } from '@shared/recurrence'
import { useTaskStore } from '../stores/useTaskStore'
import { formatCompletedAt, formatDue, todayAt, tomorrowAt } from '../lib/dates'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useMediaQuery } from '../lib/useMediaQuery'
import { DateTimePicker } from './DateTimePicker'

type TaskPatch = Partial<
  Pick<
    Task,
    'title' | 'notes' | 'completed' | 'dueAt' | 'remindAt' | 'recurrenceRule' | 'projectId' | 'priority'
  >
>

type ScheduleKind = 'due' | 'reminder' | 'repeat'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type PopoverState = {
  kind: ScheduleKind
  top: number
  left: number
  anchorTop: number
  anchorBottom: number
} | null

const PRIORITIES = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' }
]

function priorityLabel(value: number): string {
  if (value === 3) return '高优先级'
  if (value === 2) return '中优先级'
  if (value === 1) return '低优先级'
  return '无优先级'
}

function relativeTime(value: string | null): string {
  if (!value) return ''
  try {
    return formatDistanceToNowStrict(new Date(value), {
      locale: zhCN,
      addSuffix: true
    })
  } catch {
    return ''
  }
}

function defaultReminderAt(task: Task): string {
  const now = Date.now()
  if (task.dueAt) {
    const due = new Date(task.dueAt).getTime()
    const before = due - 10 * 60 * 1000
    if (before > now + 60 * 1000) return new Date(before).toISOString()
    if (due > now + 60 * 1000) {
      return new Date(Math.min(now + 60 * 1000, due - 60 * 1000)).toISOString()
    }
  }
  return new Date(now + 60 * 60 * 1000).toISOString()
}

function reminderSummary(task: Task): string {
  if (!task.remindAt) return ''
  if (!task.dueAt) return formatDue(task.remindAt)
  const minutes = Math.round(
    (new Date(task.dueAt).getTime() - new Date(task.remindAt).getTime()) / 60000
  )
  if (minutes === 0) return '到期时'
  // Beyond the inheritance window a relative offset is meaningless to read.
  if (minutes > 7 * 24 * 60) return formatDue(task.remindAt)
  if (minutes > 0 && minutes % 60 === 0) return `提前 ${minutes / 60} 小时`
  if (minutes > 0) return `提前 ${minutes} 分钟`
  return formatDue(task.remindAt)
}

function quickDuePreset(): { label: string; value: string } {
  const now = Date.now()
  const minLead = 15 * 60 * 1000

  const evening = todayAt(18, 0)
  if (new Date(evening).getTime() >= now + minLead) {
    return { label: '今天 18:00', value: evening }
  }

  const tonight = todayAt(20, 0)
  if (new Date(tonight).getTime() >= now + minLead) {
    return { label: '今晚 20:00', value: tonight }
  }

  return { label: '明天 09:00', value: tomorrowAt(9, 0) }
}

function duePresets(): Array<{ label: string; value: string }> {
  const items = [
    { label: '1 小时后', value: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    quickDuePreset(),
    { label: '明天 09:00', value: tomorrowAt(9, 0) }
  ]
  const seen = new Set<string>()
  return items
    .filter((item) => {
      if (seen.has(item.value)) return false
      seen.add(item.value)
      return true
    })
    .sort((a, b) => new Date(a.value).getTime() - new Date(b.value).getTime())
}

function reminderPresets(task: Task): Array<{ label: string; value: string }> {
  const now = Date.now()
  const items: Array<{ label: string; value: string }> = []

  if (task.dueAt) {
    const due = new Date(task.dueAt).getTime()
    if (due > now + 60 * 1000) {
      items.push({ label: '到期时', value: task.dueAt })
    }
    const before10 = due - 10 * 60 * 1000
    if (before10 > now + 60 * 1000) {
      items.push({ label: '提前 10 分钟', value: new Date(before10).toISOString() })
    }
    const before60 = due - 60 * 60 * 1000
    if (before60 > now + 60 * 1000) {
      items.push({ label: '提前 1 小时', value: new Date(before60).toISOString() })
    }
  }

  items.push({ label: '1 小时后', value: new Date(now + 60 * 60 * 1000).toISOString() })

  const tomorrow = tomorrowAt(9, 0)
  if (new Date(tomorrow).getTime() > now + 60 * 1000) {
    items.push({ label: '明天 09:00', value: tomorrow })
  }

  const seen = new Set<string>()
  return items
    .filter((item) => {
      if (seen.has(item.value)) return false
      seen.add(item.value)
      return true
    })
    .sort((a, b) => new Date(a.value).getTime() - new Date(b.value).getTime())
}

function popoverLabel(kind: ScheduleKind): string {
  if (kind === 'due') return '截止时间'
  if (kind === 'reminder') return '提醒'
  return '重复'
}

export function TaskDetail() {
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  const tasks = useTaskStore((state) => state.tasks)
  const selectTask = useTaskStore((state) => state.selectTask)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const wide = useMediaQuery('(min-width: 1180px)')
  const paneRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const closeRef = useRef<() => void>(() => {})
  const task = tasks.find((candidate) => candidate.id === selectedTaskId) ?? null

  useFocusTrap(paneRef, !wide && Boolean(task) && !paletteOpen, titleRef)

  useEffect(() => {
    if (paletteOpen && selectedTaskId) selectTask(null)
  }, [paletteOpen, selectedTaskId, selectTask])

  if (!task) return null

  return (
    <>
      {!wide && task && (
        <div
          className="detail-scrim"
          aria-hidden="true"
          onClick={() => closeRef.current()}
        />
      )}
      <aside
        ref={paneRef}
        className={`detail-pane ${wide ? 'detail-pane-wide' : 'detail-pane-overlay'}`}
        tabIndex={-1}
        role={wide ? 'region' : 'dialog'}
        aria-modal={wide ? undefined : true}
        aria-labelledby="task-detail-heading"
      >
        <TaskDetailBody
          key={task.id}
          task={task}
          titleRef={titleRef}
          closeRef={closeRef}
        />
      </aside>
    </>
  )
}

type BodyProps = {
  task: Task
  titleRef: RefObject<HTMLTextAreaElement | null>
  closeRef: RefObject<() => void>
}

function TaskDetailBody({ task, titleRef, closeRef }: BodyProps) {
  const projects = useTaskStore((state) => state.projects)
  const selectTask = useTaskStore((state) => state.selectTask)
  const updateTask = useTaskStore((state) => state.updateTask)
  const toggleTask = useTaskStore((state) => state.toggleTask)
  const removeTask = useTaskStore((state) => state.removeTask)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [popover, setPopover] = useState<PopoverState>(null)
  // Effects below key on the KIND, not the object: repositioning produces a new
  // object, and re-arming the initial-focus timer would steal focus back from
  // the minute field or the confirm-clear cancel button.
  const popoverKind = popover?.kind ?? null
  const [completedNext, setCompletedNext] = useState<string | null>(null)
  const [titleComposing, setTitleComposing] = useState(false)
  const [notesComposing, setNotesComposing] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const idleTimer = useRef<number | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const flushedRef = useRef(false)
  const flushRef = useRef<() => Promise<boolean>>(async () => true)

  const project = task.projectId
    ? projects.find((candidate) => candidate.id === task.projectId)
    : undefined
  const nextRecurrence = task.recurrenceRule
    ? nextOccurrence(task.dueAt, task.recurrenceRule)
    : null

  const markSaved = useCallback(() => {
    setSaveStatus('saved')
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setSaveStatus('idle'), 1600)
  }, [])

  const persist = useCallback(
    (patch: TaskPatch): Promise<boolean> => {
      const run = saveQueue.current.then(async () => {
        setSaveStatus('saving')
        try {
          await updateTask(task.id, patch)
          markSaved()
          return true
        } catch (error) {
          console.error('Failed to update task:', error)
          setSaveStatus('error')
          return false
        }
      })
      saveQueue.current = run.then(() => undefined)
      return run
    },
    [markSaved, task.id, updateTask]
  )

  const flushAll = useCallback(async (): Promise<boolean> => {
    const cleanTitle = title.replace(/\r?\n/g, ' ').trim()
    const jobs: Array<Promise<boolean>> = []

    if (!cleanTitle) {
      setTitle(task.title)
    } else if (cleanTitle !== task.title) {
      jobs.push(persist({ title: cleanTitle }))
    }

    if (notes !== task.notes) jobs.push(persist({ notes }))
    if (jobs.length === 0) return true

    const results = await Promise.all(jobs)
    return results.every(Boolean)
  }, [notes, persist, task.notes, task.title, title])

  useEffect(() => {
    flushRef.current = flushAll
  }, [flushAll])

  useEffect(() => {
    const value = title.replace(/\r?\n/g, ' ').trim()
    if (!value || value === task.title || titleComposing) return
    const timer = window.setTimeout(() => {
      void persist({ title: value })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [persist, task.title, title, titleComposing])

  useEffect(() => {
    if (notes === task.notes || notesComposing) return
    const timer = window.setTimeout(() => {
      void persist({ notes })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [notes, notesComposing, persist, task.notes])

  useEffect(() => {
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
      if (!flushedRef.current) void flushRef.current()
    }
  }, [])

  useEffect(() => {
    const element = titleRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 62)}px`
  }, [title, titleRef])

  useEffect(() => {
    const element = notesRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.4)}px`
  }, [notes])

  const close = useCallback(async () => {
    const ok = await flushAll()
    if (!ok) return

    flushedRef.current = true
    const taskId = task.id
    selectTask(null)
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-task-id="${taskId}"] .task-open`)
        ?.focus()
    })
  }, [flushAll, selectTask, task.id])

  useEffect(() => {
    closeRef.current = () => {
      void close()
    }
  }, [close, closeRef])

  const closePopover = useCallback((restoreFocus = false) => {
    setPopover(null)
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

  const openPopover = useCallback(
    (kind: ScheduleKind, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (popover?.kind === kind) {
        closePopover(true)
        return
      }

      triggerRef.current = event.currentTarget
      const rect = event.currentTarget.getBoundingClientRect()
      const width = 280
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
      const estimated = kind === 'due' ? 372 : kind === 'reminder' ? 406 : 220
      const below = rect.bottom + 6
      const top =
        below + estimated > window.innerHeight - 12
          ? Math.max(56, rect.top - estimated - 6)
          : below

      setPopover({ kind, top, left, anchorTop: rect.top, anchorBottom: rect.bottom })
    },
    [closePopover, popover]
  )

  // Re-place the popover once its real height is known, and keep it placed when
  // the confirm-clear panel changes that height. offsetHeight, not the rect:
  // the pop-in scale would otherwise pollute the measurement.
  useLayoutEffect(() => {
    if (!popover) return
    const element = popoverRef.current
    if (!element) return
    const { anchorTop, anchorBottom } = popover
    const place = (): void => {
      const height = element.offsetHeight
      const below = anchorBottom + 6
      const above = anchorTop - height - 6
      const preferred = below + height <= window.innerHeight - 12 ? below : above
      const next = Math.max(56, Math.min(preferred, window.innerHeight - 12 - height))
      setPopover((prev) => (prev && Math.abs(prev.top - next) > 0.5 ? { ...prev, top: next } : prev))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    return () => observer.disconnect()
  }, [popover?.kind, popover?.anchorTop, popover?.anchorBottom])

  useEffect(() => {
    if (!popoverKind) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (popoverRef.current?.contains(target)) return
      if (target?.closest('[data-detail-row]')) return
      closePopover()
    }
    const onResize = () => closePopover()
    const onScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return
      closePopover()
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [closePopover, popoverKind])

  useEffect(() => {
    if (!popoverKind) return
    const timer = window.setTimeout(() => {
      const root = popoverRef.current
      if (!root) return
      const preferred = root.querySelector<HTMLElement>('[data-popover-focus="true"]')
      const fallback = root.querySelector<HTMLElement>(
        'input, .detail-chip, .dp-day[tabindex="0"], .detail-popover-clear'
      )
      ;(preferred ?? fallback)?.focus()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [popoverKind])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || paletteOpen) return
      event.preventDefault()
      if (popoverKind) {
        closePopover(true)
        return
      }
      void close()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, closePopover, paletteOpen, popoverKind])

  const handleToggle = async () => {
    const wasRecurring = !task.completed && Boolean(task.recurrenceRule && task.dueAt)
    const next =
      wasRecurring && task.recurrenceRule && task.dueAt
        ? nextOccurrence(task.dueAt, task.recurrenceRule)
        : null

    await toggleTask(task.id)

    if (wasRecurring && next) {
      setCompletedNext(formatDue(next.toISOString()))
    } else if (!wasRecurring) {
      setCompletedNext(null)
    }
  }

  const handleDelete = async () => {
    const row = document.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`)
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling
    const target = sibling?.querySelector<HTMLElement>('.task-open')

    flushedRef.current = true
    await removeTask(task.id)
    requestAnimationFrame(() => {
      ;(target ?? document.querySelector<HTMLElement>('.quick-add input'))?.focus()
    })
  }

  const quickDue = quickDuePreset()
  const summary = [
    task.dueAt ? formatDue(task.dueAt) : '无截止时间',
    task.priority ? priorityLabel(task.priority) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className="detail-header">
        <span className={`detail-header-project ${project ? '' : 'muted'}`}>
          {project && <span className="meta-dot" style={{ background: project.color }} />}
          {project?.name ?? '无项目'}
        </span>
        <div className="detail-header-right">
          <span
            className={`detail-save-status ${saveStatus}`}
            role="status"
            // Discrete commits mean one save per keystroke; announcing each one
            // would talk over the spinbutton readings. Errors still speak.
            aria-live={saveStatus === 'error' ? 'assertive' : 'off'}
          >
            {saveStatus === 'saving'
              ? '保存中…'
              : saveStatus === 'saved'
                ? '已保存'
                : saveStatus === 'error'
                  ? '保存失败'
                  : ''}
            {saveStatus === 'error' && (
              <button
                className="detail-retry"
                onClick={() => {
                  void flushAll()
                }}
              >
                重试
              </button>
            )}
          </span>
          <button className="detail-close" onClick={() => void close()} aria-label="关闭详情">
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="detail-body">
        <h2 className="sr-only" id="task-detail-heading">
          {title.trim() || task.title || '任务详情'}
        </h2>

        <textarea
          ref={titleRef}
          className="detail-title"
          rows={1}
          value={title}
          placeholder="任务标题"
          aria-label="任务标题"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            void flushAll()
          }}
          onCompositionStart={() => setTitleComposing(true)}
          onCompositionEnd={() => setTitleComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />

        <div className="detail-summary">{summary}</div>

        <div className="detail-actions">
          <button
            className={`detail-action detail-action-primary ${task.completed ? 'is-done' : ''}`}
            onClick={() => void handleToggle()}
            aria-pressed={task.completed}
          >
            {task.completed ? (
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Check size={13} strokeWidth={2.4} aria-hidden="true" />
            )}
            {task.completed ? '已完成 · 撤销' : '完成'}
          </button>
          <button
            className="detail-action"
            onClick={() => {
              void persist({ dueAt: quickDue.value })
            }}
          >
            <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
            {quickDue.label}
          </button>
          <button
            className="detail-action"
            aria-haspopup={task.remindAt ? 'dialog' : undefined}
            aria-expanded={task.remindAt ? popover?.kind === 'reminder' : undefined}
            onClick={(event) => {
              if (task.remindAt) {
                openPopover('reminder', event)
                return
              }
              void persist({ remindAt: defaultReminderAt(task) })
            }}
          >
            <Bell size={13} strokeWidth={1.8} aria-hidden="true" />
            {task.remindAt ? '已提醒' : '提醒'}
          </button>
        </div>

        {task.completed && (
          <div className="detail-completed-at">
            <Check size={12} strokeWidth={2} aria-hidden="true" />
            {task.completedAt ? `完成于 ${formatCompletedAt(task.completedAt)}` : '完成时间未记录'}
          </div>
        )}

        <div className="detail-notes-wrap">
          <textarea
            ref={notesRef}
            className="detail-notes"
            rows={1}
            value={notes}
            placeholder="添加备注…"
            aria-label="任务备注"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => {
              void flushAll()
            }}
            onCompositionStart={() => setNotesComposing(true)}
            onCompositionEnd={() => setNotesComposing(false)}
          />
        </div>

        <div className="detail-schedule">
          <ScheduleRow
            label="截止"
            value={task.dueAt ? formatDue(task.dueAt) : '添加截止时间'}
            relative={task.dueAt ? relativeTime(task.dueAt) : undefined}
            muted={!task.dueAt}
            expanded={popover?.kind === 'due'}
            onOpen={(event) => openPopover('due', event)}
          />
          <ScheduleRow
            label="提醒"
            value={task.remindAt ? reminderSummary(task) : '添加提醒'}
            relative={task.remindAt ? relativeTime(task.remindAt) : undefined}
            muted={!task.remindAt}
            expanded={popover?.kind === 'reminder'}
            onOpen={(event) => openPopover('reminder', event)}
          />
          <ScheduleRow
            label="重复"
            value={task.recurrenceRule ? recurrenceLabel(task.recurrenceRule) : '不重复'}
            relative={
              task.recurrenceRule && nextRecurrence
                ? `下次 ${formatDue(nextRecurrence.toISOString())}`
                : undefined
            }
            muted={!task.recurrenceRule}
            expanded={popover?.kind === 'repeat'}
            onOpen={(event) => openPopover('repeat', event)}
          />
        </div>

        {task.completed && completedNext && (
          <div className="detail-next" role="status">
            <Repeat2 size={12} strokeWidth={1.8} aria-hidden="true" />
            下一次已创建 · {completedNext}
          </div>
        )}

        <div className="detail-divider" />

        <div className="detail-organize">
          <div>
            <div className="detail-group-label">项目</div>
            <div className="detail-chips" role="group" aria-label="项目">
              <button
                className={`detail-chip ${task.projectId ? '' : 'active'}`}
                aria-pressed={!task.projectId}
                onClick={() => {
                  void persist({ projectId: null })
                }}
              >
                无项目
              </button>
              {projects.map((item) => (
                <button
                  key={item.id}
                  className={`detail-chip ${task.projectId === item.id ? 'active' : ''}`}
                  aria-pressed={task.projectId === item.id}
                  onClick={() => {
                    void persist({ projectId: item.id })
                  }}
                >
                  <span className="meta-dot" style={{ background: item.color }} />
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="detail-group-label">优先级</div>
            <div className="detail-priority" role="group" aria-label="优先级">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority.value}
                  data-priority={priority.value}
                  className={task.priority === priority.value ? 'active' : ''}
                  aria-pressed={task.priority === priority.value}
                  onClick={() => {
                    void persist({ priority: priority.value })
                  }}
                >
                  {priority.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="detail-footer">
        <button className="detail-delete" onClick={() => void handleDelete()}>
          <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
          删除任务
        </button>
        <span className="detail-esc">
          <kbd>Esc</kbd> 收起
        </span>
      </div>

      {popover && (
        <div
          ref={popoverRef}
          className="detail-popover"
          style={{ top: popover.top, left: popover.left }}
          role="dialog"
          aria-label={popoverLabel(popover.kind)}
        >
          {popover.kind === 'due' && (
            <DuePopover
              task={task}
              onPatch={(patch) => {
                void persist(patch)
              }}
              onClose={() => closePopover(true)}
            />
          )}
          {popover.kind === 'reminder' && (
            <ReminderPopover
              task={task}
              onPatch={(patch) => {
                void persist(patch)
              }}
              onClose={() => closePopover(true)}
            />
          )}
          {popover.kind === 'repeat' && (
            <RepeatPopover
              task={task}
              nextRecurrence={nextRecurrence}
              onPatch={(patch) => {
                void persist(patch)
              }}
            />
          )}
        </div>
      )}
    </>
  )
}

type ScheduleRowProps = {
  label: string
  value: string
  relative?: string
  muted?: boolean
  expanded: boolean
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

function ScheduleRow({ label, value, relative, muted, expanded, onOpen }: ScheduleRowProps) {
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

type PopoverProps = {
  task: Task
  onPatch: (patch: TaskPatch) => void
  onClose: () => void
}

function DuePopover({ task, onPatch, onClose }: PopoverProps) {
  const [confirmClear, setConfirmClear] = useState(false)
  // Only the seed is frozen; the presets themselves keep recomputing so the
  // relative ones stay honest.
  const [fallback] = useState(() => quickDuePreset().value)
  const presets = duePresets()
  const clearRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const wasConfirming = useRef(false)

  useEffect(() => {
    if (confirmClear) {
      wasConfirming.current = true
      cancelRef.current?.focus()
      return
    }
    if (wasConfirming.current) {
      wasConfirming.current = false
      clearRef.current?.focus()
    }
  }, [confirmClear])

  // Move the reminder with the deadline, keeping its offset. Otherwise a due
  // date pushed far out silently drops the reminder on the next recurrence.
  const patchDue = (iso: string): void => {
    if (task.dueAt && task.remindAt) {
      const offset = new Date(task.dueAt).getTime() - new Date(task.remindAt).getTime()
      if (offset >= 0) {
        onPatch({
          dueAt: iso,
          remindAt: new Date(new Date(iso).getTime() - offset).toISOString()
        })
        return
      }
    }
    onPatch({ dueAt: iso })
  }

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>截止时间</span>
        <span className="detail-popover-readout">
          {task.dueAt ? formatDue(task.dueAt) : '未设置'}
        </span>
      </div>
      <div className="detail-chips detail-popover-quick" role="group" aria-label="快捷截止时间">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`detail-chip ${task.dueAt === preset.value ? 'active' : ''}`}
            onClick={() => {
              patchDue(preset.value)
              onClose()
            }}
          >
            {preset.label}
            {task.dueAt === preset.value && <Check size={12} strokeWidth={2} aria-hidden="true" />}
          </button>
        ))}
      </div>

      <DateTimePicker
        value={task.dueAt}
        fallback={fallback}
        label="截止时间"
        onChange={patchDue}
        onDone={onClose}
      />

      {confirmClear ? (
        <div
          className="detail-clear-warning"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            // React dispatches at the root, ahead of the window listener, so
            // this unwinds one level instead of closing the whole inspector.
            event.preventDefault()
            event.stopPropagation()
            setConfirmClear(false)
          }}
        >
          清除日期会同时移除重复规则
          <div className="detail-popover-actions">
            <button
              className="detail-popover-action detail-popover-danger"
              onClick={() => {
                onPatch({ dueAt: null, recurrenceRule: null })
                onClose()
              }}
            >
              清除两者
            </button>
            <button
              ref={cancelRef}
              className="detail-popover-action"
              onClick={() => setConfirmClear(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={clearRef}
          className="detail-popover-clear"
          onClick={() => {
            if (task.recurrenceRule) {
              setConfirmClear(true)
              return
            }
            onPatch({ dueAt: null })
            onClose()
          }}
        >
          清除截止时间
        </button>
      )}
    </>
  )
}

function ReminderPopover({ task, onPatch, onClose }: PopoverProps) {
  const [fallback] = useState(() => defaultReminderAt(task))
  const presets = reminderPresets(task)

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>提醒</span>
        <span className="detail-popover-readout">
          {task.remindAt ? formatDue(task.remindAt) : '未设置'}
        </span>
      </div>
      <div className="detail-chips detail-popover-quick" role="group" aria-label="快捷提醒">
        {presets.map((preset) => (
          // Key on the label: relative presets change value every render, and
          // keying on it would remount the button and drop focus to <body>.
          <button
            key={preset.label}
            type="button"
            className={`detail-chip ${task.remindAt === preset.value ? 'active' : ''}`}
            onClick={() => {
              onPatch({ remindAt: preset.value })
              onClose()
            }}
          >
            {preset.label}
            {task.remindAt === preset.value && (
              <Check size={12} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <DateTimePicker
        value={task.remindAt}
        fallback={fallback}
        label="提醒时间"
        onChange={(iso) => onPatch({ remindAt: iso })}
        onDone={onClose}
      />

      <div className="detail-popover-foot">
        <div className="detail-popover-note">提醒需要 Polaris 保持运行</div>
        {task.remindAt && (
          <button
            className="detail-popover-clear"
            onClick={() => {
              onPatch({ remindAt: null })
              onClose()
            }}
          >
            移除提醒
          </button>
        )}
      </div>
    </>
  )
}

type RepeatPopoverProps = {
  task: Task
  nextRecurrence: Date | null
  onPatch: (patch: TaskPatch) => void
}

const FREQ_OPTIONS: Array<{ freq: CustomRecurrence['freq']; label: string; unit: string }> = [
  { freq: 'DAILY', label: '天', unit: '天' },
  { freq: 'WEEKLY', label: '周', unit: '周' },
  { freq: 'MONTHLY', label: '月', unit: '月' },
  { freq: 'YEARLY', label: '年', unit: '年' }
]

const WEEKDAY_OPTIONS = [
  { code: 'MO', label: '一' },
  { code: 'TU', label: '二' },
  { code: 'WE', label: '三' },
  { code: 'TH', label: '四' },
  { code: 'FR', label: '五' },
  { code: 'SA', label: '六' },
  { code: 'SU', label: '日' }
]

function RepeatPopover({ task, nextRecurrence, onPatch }: RepeatPopoverProps) {
  const isCustomRule = recurrenceLabel(task.recurrenceRule) === '自定义'
  const [customEditing, setCustomEditing] = useState(isCustomRule)
  const parsed = parseCustomRecurrence(task.recurrenceRule)
  const showEditor = customEditing || isCustomRule
  const freq = parsed?.freq ?? 'DAILY'
  const interval = parsed?.interval ?? 2
  const weekdays = parsed?.weekdays ?? []
  const unit = FREQ_OPTIONS.find((option) => option.freq === freq)?.unit ?? '天'

  // 规则是唯一真源：控件改动即时构建 RRULE 落库，回显再从规则解析，避免双状态失同步。
  const applyCustom = (next: Partial<CustomRecurrence>) => {
    onPatch({
      recurrenceRule: buildCustomRecurrence({
        freq: next.freq ?? freq,
        interval: next.interval ?? interval,
        weekdays: next.weekdays ?? weekdays
      })
    })
  }

  const toggleWeekday = (code: string) => {
    applyCustom({
      weekdays: weekdays.includes(code)
        ? weekdays.filter((day) => day !== code)
        : [...weekdays, code]
    })
  }

  return (
    <>
      <div className="detail-popover-title detail-popover-head">
        <span>重复</span>
        <span className="detail-popover-readout">
          {task.recurrenceRule ? recurrenceLabel(task.recurrenceRule) : '不重复'}
        </span>
      </div>
      <div className="detail-chips" role="group" aria-label="重复">
        {RECURRENCE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className={`detail-chip ${task.recurrenceRule === preset.rule && !customEditing ? 'active' : ''}`}
            data-popover-focus={task.recurrenceRule === preset.rule && !customEditing}
            disabled={!task.dueAt && preset.rule !== null}
            aria-pressed={task.recurrenceRule === preset.rule && !customEditing}
            onClick={() => {
              setCustomEditing(false)
              onPatch({ recurrenceRule: preset.rule })
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          className={`detail-chip ${showEditor ? 'active' : ''}`}
          disabled={!task.dueAt}
          aria-pressed={showEditor}
          onClick={() => {
            setCustomEditing(true)
            if (!task.recurrenceRule) onPatch({ recurrenceRule: 'FREQ=DAILY;INTERVAL=2' })
          }}
        >
          自定义
        </button>
      </div>

      {showEditor && task.dueAt && (
        <div className="repeat-custom">
          <div className="repeat-field">
            <span className="repeat-field-label">频率</span>
            <div className="detail-chips" role="group" aria-label="重复频率">
              {FREQ_OPTIONS.map((option) => (
                <button
                  key={option.freq}
                  className={`detail-chip ${freq === option.freq ? 'active' : ''}`}
                  aria-pressed={freq === option.freq}
                  onClick={() => applyCustom({ freq: option.freq })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="repeat-field">
            <span className="repeat-field-label">间隔</span>
            <div className="repeat-interval">
              <span className="repeat-field-label">每</span>
              <button
                className="repeat-step"
                onClick={() => applyCustom({ interval: Math.max(1, interval - 1) })}
                disabled={interval <= 1}
                aria-label="减少间隔"
              >
                −
              </button>
              <span className="repeat-interval-value" aria-live="polite">{interval}</span>
              <button
                className="repeat-step"
                onClick={() => applyCustom({ interval: Math.min(99, interval + 1) })}
                disabled={interval >= 99}
                aria-label="增加间隔"
              >
                +
              </button>
              <span className="repeat-field-label">{unit}</span>
            </div>
          </div>
          {freq === 'WEEKLY' && (
            <div className="repeat-field">
              <span className="repeat-field-label">星期</span>
              <div className="detail-chips" role="group" aria-label="重复星期">
                {WEEKDAY_OPTIONS.map((option) => (
                  <button
                    key={option.code}
                    className={`detail-chip ${weekdays.includes(option.code) ? 'active' : ''}`}
                    aria-pressed={weekdays.includes(option.code)}
                    onClick={() => toggleWeekday(option.code)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {task.recurrenceRule && (
        <div className="detail-popover-note">
          {nextRecurrence ? `下次：${formatDue(nextRecurrence.toISOString())}` : '没有下一次'}
        </div>
      )}
      {!task.dueAt && (
        <div className="detail-popover-note">先设置截止时间，才能重复</div>
      )}
    </>
  )
}