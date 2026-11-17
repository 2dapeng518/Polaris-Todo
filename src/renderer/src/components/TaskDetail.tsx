import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from 'react'
import {
  Bell,
  CalendarDays,
  Check,
  Repeat2,
  RotateCcw,
  Trash2,
  X
} from './Icon'
import type { Task } from '@shared/types'
import { nextOccurrence, recurrenceLabel } from '@shared/recurrence'
import { useTaskStore } from '../stores/useTaskStore'
import { formatCompletedAt, formatDue } from '../lib/dates'
import { useAnchoredPopover } from '../lib/useAnchoredPopover'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useTaskDraft } from '../lib/useTaskDraft'
import { useLocale, useT } from '../stores/useLocaleStore'
import type { MessageKey } from '@shared/i18n'
import { SubtaskList } from './SubtaskList'
import { DuePopover, DUE_ESTIMATED_HEIGHT } from './detail/DuePopover'
import { ReminderPopover, REMINDER_ESTIMATED_HEIGHT } from './detail/ReminderPopover'
import { RepeatPopover, REPEAT_ESTIMATED_HEIGHT } from './detail/RepeatPopover'
import { ScheduleRow } from './detail/ScheduleRow'
import { TagEditor } from './detail/TagEditor'
import { defaultReminderAt, quickDuePreset } from './detail/presets'
import { PRIORITIES, popoverLabel, priorityLabel, relativeTime, reminderSummary } from './detail/summary'
import type { ScheduleKind, TaskPatch } from './detail/types'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function TaskDetail() {
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  // 单任务 selector：订阅整个 tasks 数组会让任何一行的变动都重渲染详情面板；
  // find 返回的是数组里的同一个对象引用，无关行变化时 selector 结果稳定。
  const task = useTaskStore(
    (state) => state.tasks.find((candidate) => candidate.id === state.selectedTaskId) ?? null
  )
  const selectTask = useTaskStore((state) => state.selectTask)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const wide = useMediaQuery('(min-width: 1180px)')
  const paneRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const closeRef = useRef<() => void>(() => {})

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
  const t = useT()
  const locale = useLocale()
  const projects = useTaskStore((state) => state.projects)
  const selectTask = useTaskStore((state) => state.selectTask)
  const updateTask = useTaskStore((state) => state.updateTask)
  const toggleTask = useTaskStore((state) => state.toggleTask)
  const removeTask = useTaskStore((state) => state.removeTask)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  // 弹层状态只存 kind；定位交给 useAnchoredPopover。Effects below key on the
  // KIND, not any position object: repositioning must never re-arm the
  // initial-focus timer, or it would steal focus back from the minute field
  // or the confirm-clear cancel button.
  const [popoverKind, setPopoverKind] = useState<ScheduleKind | null>(null)
  const [completedNext, setCompletedNext] = useState<string | null>(null)
  const notesRef = useRef<HTMLTextAreaElement | null>(null)
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

  // 草稿 + dirty + 防抖 + 外部同步都在 useTaskDraft 里：只有用户编辑才写回，
  // 外部修改（MCP 写入/备份导入/focus 重载）不再被旧草稿回声覆盖。
  const {
    title,
    notes,
    changeTitle,
    changeNotes,
    setTitleComposing,
    setNotesComposing,
    flushAll
  } = useTaskDraft({ title: task.title, notes: task.notes, persist })

  useEffect(() => {
    flushRef.current = flushAll
  }, [flushAll])

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
    setPopoverKind(null)
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

  const openPopover = useCallback(
    (kind: ScheduleKind, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (popoverKind === kind) {
        closePopover(true)
        return
      }

      triggerRef.current = event.currentTarget
      setPopoverKind(kind)
    },
    [closePopover, popoverKind]
  )

  // 定位 / 外点 / 滚动 / resize 收起都在公共 hook 里（与 ThemeMenu 同源）。
  // 280 = .detail-popover 宽度；56 = 顶部下界，避开标题栏；预估高度由各弹层
  // 文件导出（372/406/220 的魔法数随弹层搬走）。Esc 路由与 30ms 初始聚焦留在
  // 本组件：前者要看 paletteOpen 并决定收弹层还是收详情栏，后者不能被重定位
  // 重新武装（见 hook 头注释）。
  const { place: popoverPlace, popoverRef } = useAnchoredPopover({
    active: popoverKind !== null,
    anchorRef: triggerRef,
    width: 280,
    minTop: 56,
    estimatedHeight:
      popoverKind === 'due'
        ? DUE_ESTIMATED_HEIGHT
        : popoverKind === 'reminder'
          ? REMINDER_ESTIMATED_HEIGHT
          : REPEAT_ESTIMATED_HEIGHT,
    outsideIgnoreSelector: '[data-detail-row]',
    onDismiss: closePopover,
    resetKey: popoverKind
  })

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
    // 契约：ok = 写入是否成功；spawned = DB 权威返回的新生重复任务（无则 null）。
    const { ok, spawned } = await toggleTask(task.id)
    // 写入失败时 store 已回滚并弹错误 toast，这里不能再显示「已创建下次重复」的假成功。
    if (!ok) return

    if (wasRecurring) {
      // 只有真的生成了新任务才提示下次到期，日期用 DB 权威的 spawned.dueAt，
      // 不再用 nextOccurrence 本地推算（规则可能已到尽头，推算会撒谎）。
      setCompletedNext(spawned?.dueAt ? formatDue(spawned.dueAt, locale) : null)
    } else {
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

  const quickDue = quickDuePreset(t)
  const summary = [
    task.dueAt ? formatDue(task.dueAt, locale) : t('detail.noDue'),
    task.priority ? priorityLabel(task.priority, t) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className="detail-header">
        <span className={`detail-header-project ${project ? '' : 'muted'}`}>
          {project && <span className="meta-dot" style={{ background: project.color }} />}
          {project?.name ?? t('detail.noProject')}
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
              ? t('detail.saving')
              : saveStatus === 'saved'
                ? t('detail.saved')
                : saveStatus === 'error'
                  ? t('detail.saveFailed')
                  : ''}
            {saveStatus === 'error' && (
              <button
                className="detail-retry"
                onClick={() => {
                  void flushAll()
                }}
              >
                {t('common.retry')}
              </button>
            )}
          </span>
          <button className="detail-close" onClick={() => void close()} aria-label={t('detail.close')}>
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="detail-body">
        <h2 className="sr-only" id="task-detail-heading">
          {title.trim() || task.title || t('detail.taskDetails')}
        </h2>

        <textarea
          ref={titleRef}
          className="detail-title"
          rows={1}
          value={title}
          placeholder={t('detail.titlePlaceholder')}
          aria-label={t('detail.titleLabel')}
          onChange={(event) => changeTitle(event.target.value)}
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
            {task.completed ? t('detail.completedUndo') : t('detail.complete')}
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
            aria-expanded={task.remindAt ? popoverKind === 'reminder' : undefined}
            onClick={(event) => {
              if (task.remindAt) {
                openPopover('reminder', event)
                return
              }
              void persist({ remindAt: defaultReminderAt(task) })
            }}
          >
            <Bell size={13} strokeWidth={1.8} aria-hidden="true" />
            {task.remindAt ? t('detail.reminded') : t('detail.reminder')}
          </button>
        </div>

        {task.completed && (
          <div className="detail-completed-at">
            <Check size={12} strokeWidth={2} aria-hidden="true" />
            {task.completedAt
              ? t('detail.completedAt', { time: formatCompletedAt(task.completedAt, locale) })
              : t('detail.completedAtUnknown')}
          </div>
        )}

        <div className="detail-notes-wrap">
          <textarea
            ref={notesRef}
            className="detail-notes"
            rows={1}
            value={notes}
            placeholder={t('detail.notesPlaceholder')}
            aria-label={t('detail.notesLabel')}
            onChange={(event) => changeNotes(event.target.value)}
            onBlur={() => {
              void flushAll()
            }}
            onCompositionStart={() => setNotesComposing(true)}
            onCompositionEnd={() => setNotesComposing(false)}
          />
        </div>

        <SubtaskList taskId={task.id} total={task.subtaskTotal} done={task.subtaskDone} />

        <TagEditor task={task} persist={persist} />

        <div className="detail-schedule">
          <ScheduleRow
            label={t('detail.due')}
            value={task.dueAt ? formatDue(task.dueAt, locale) : t('detail.addDue')}
            relative={task.dueAt ? relativeTime(task.dueAt, locale) : undefined}
            muted={!task.dueAt}
            expanded={popoverKind === 'due'}
            onOpen={(event) => openPopover('due', event)}
          />
          <ScheduleRow
            label={t('detail.reminder')}
            value={task.remindAt ? reminderSummary(task, t, locale) : t('detail.addReminder')}
            relative={task.remindAt ? relativeTime(task.remindAt, locale) : undefined}
            muted={!task.remindAt}
            expanded={popoverKind === 'reminder'}
            onOpen={(event) => openPopover('reminder', event)}
          />
          <ScheduleRow
            label={t('detail.repeat')}
            value={task.recurrenceRule ? recurrenceLabel(task.recurrenceRule, locale) : t('detail.noRepeat')}
            relative={
              task.recurrenceRule && nextRecurrence
                ? t('detail.nextOccurrence', { date: formatDue(nextRecurrence.toISOString(), locale) })
                : undefined
            }
            muted={!task.recurrenceRule}
            expanded={popoverKind === 'repeat'}
            onOpen={(event) => openPopover('repeat', event)}
          />
        </div>

        {task.completed && completedNext && (
          <div className="detail-next" role="status">
            <Repeat2 size={12} strokeWidth={1.8} aria-hidden="true" />
            {t('detail.recurrenceCreated', { date: completedNext })}
          </div>
        )}

        <div className="detail-divider" />

        <div className="detail-organize">
          <div>
            <div className="detail-group-label">{t('detail.project')}</div>
            <div className="detail-chips" role="group" aria-label={t('detail.project')}>
              <button
                className={`detail-chip ${task.projectId ? '' : 'active'}`}
                aria-pressed={!task.projectId}
                onClick={() => {
                  void persist({ projectId: null })
                }}
              >
                {t('detail.noProject')}
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
            <div className="detail-group-label">{t('detail.priority')}</div>
            <div className="detail-priority" role="group" aria-label={t('detail.priority')}>
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  data-priority={priority}
                  className={task.priority === priority ? 'active' : ''}
                  aria-pressed={task.priority === priority}
                  onClick={() => {
                    void persist({ priority })
                  }}
                >
                  {t(`detail.priorityOption.${priority}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="detail-footer">
        <button className="detail-delete" onClick={() => void handleDelete()}>
          <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
          {t('detail.delete')}
        </button>
        <span className="detail-esc">
          <kbd>Esc</kbd> {t('detail.collapse')}
        </span>
      </div>

      {popoverKind && (
        <div
          ref={popoverRef}
          className="detail-popover"
          style={{ top: popoverPlace.top, left: popoverPlace.left }}
          role="dialog"
          aria-label={popoverLabel(popoverKind, t)}
        >
          {popoverKind === 'due' && (
            <DuePopover
              task={task}
              onPatch={(patch) => {
                void persist(patch)
              }}
              onClose={() => closePopover(true)}
            />
          )}
          {popoverKind === 'reminder' && (
            <ReminderPopover
              task={task}
              onPatch={(patch) => {
                void persist(patch)
              }}
              onClose={() => closePopover(true)}
            />
          )}
          {popoverKind === 'repeat' && (
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

