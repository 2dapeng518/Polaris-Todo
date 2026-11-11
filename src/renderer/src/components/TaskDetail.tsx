import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Check, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Task } from '@shared/types'
import { RECURRENCE_PRESETS, nextOccurrence } from '@shared/recurrence'
import { useTaskStore } from '../stores/useTaskStore'
import { formatDue, todayAt, tomorrowAt } from '../lib/dates'
import { useFocusTrap } from '../lib/useFocusTrap'

type TaskPatch = Partial<
  Pick<
    Task,
    'title' | 'notes' | 'completed' | 'dueAt' | 'remindAt' | 'recurrenceRule' | 'projectId' | 'priority'
  >
>

const PRIORITIES = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' }
]

function toLocalInput(value: string | null): string {
  if (!value) return ''
  return format(new Date(value), "yyyy-MM-dd'T'HH:mm")
}

function defaultReminderAt(task: Task): string | null {
  const now = Date.now()
  if (!task.dueAt) return new Date(now + 60 * 60 * 1000).toISOString()

  const due = new Date(task.dueAt).getTime()
  const beforeDue = due - 10 * 60 * 1000
  if (beforeDue > now + 60 * 1000) return new Date(beforeDue).toISOString()
  if (due > now + 60 * 1000) return new Date(now + 60 * 1000).toISOString()
  return null
}

export function TaskDetail() {
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  const tasks = useTaskStore((state) => state.tasks)
  const selectTask = useTaskStore((state) => state.selectTask)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const drawerRef = useRef<HTMLElement | null>(null)
  const task = tasks.find((candidate) => candidate.id === selectedTaskId) ?? null

  useFocusTrap(drawerRef, Boolean(task) && !paletteOpen, drawerRef)

  return (
    <AnimatePresence>
      {task && (
        <motion.div
          key="detail-scrim"
          className="detail-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => selectTask(null)}
        />
      )}
      {task && (
        <motion.aside
          key={task.id}
          className="detail-drawer"
          ref={drawerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="任务详情"
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        >
          <TaskDetailBody task={task} />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function TaskDetailBody({ task }: { task: Task }) {
  const projects = useTaskStore((state) => state.projects)
  const selectTask = useTaskStore((state) => state.selectTask)
  const updateTask = useTaskStore((state) => state.updateTask)
  const toggleTask = useTaskStore((state) => state.toggleTask)
  const removeTask = useTaskStore((state) => state.removeTask)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const nextRecurrence = task.recurrenceRule
    ? nextOccurrence(task.dueAt, task.recurrenceRule)
    : null

  useEffect(() => {
    if (paletteOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selectTask(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, selectTask])

  const patchTask = (patch: TaskPatch) => {
    void updateTask(task.id, patch).catch((error) => {
      console.error('Failed to update task:', error)
    })
  }

  const saveTitle = () => {
    const value = title.trim()
    if (!value) {
      setTitle(task.title)
      return
    }
    if (value !== task.title) patchTask({ title: value })
  }

  const saveNotes = () => {
    if (notes !== task.notes) patchTask({ notes })
  }

  return (
    <>
      <div className="detail-header">
        <div className="detail-header-meta">
          <span className="detail-eyebrow">任务详情</span>
          <span className="detail-save">自动保存</span>
        </div>
        <button className="detail-close" onClick={() => selectTask(null)} aria-label="关闭详情">
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-complete-row">
          <button
            className={`task-check ${task.completed ? 'done' : ''}`}
            onClick={() => void toggleTask(task.id)}
            aria-label={task.completed ? '标记为未完成' : '标记为完成'}
            aria-pressed={task.completed}
          >
            {task.completed && (
              <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <Check
                  size={12}
                  strokeWidth={2.6}
                  aria-hidden="true"
                  style={{ stroke: 'var(--check-mark)' }}
                />
              </motion.span>
            )}
          </button>
          <button
            className={`detail-complete-label ${task.completed ? 'done' : ''}`}
            onClick={() => void toggleTask(task.id)}
          >
            {task.completed ? '已完成' : '标记为完成'}
          </button>
        </div>

        <input
          className="detail-title"
          name="task-title"
          autoComplete="off"
          spellCheck={false}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              setTitle(task.title)
              event.currentTarget.blur()
            }
          }}
          placeholder="任务标题"
          aria-label="任务标题"
        />

        <textarea
          className="detail-notes"
          name="task-notes"
          autoComplete="off"
          spellCheck={false}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={saveNotes}
          placeholder="添加备注…"
          aria-label="任务备注"
        />

        <section className="detail-section">
          <div className="detail-label">截止时间</div>
          <input
            type="datetime-local"
            name="due-at"
            className="detail-date-input"
            value={toLocalInput(task.dueAt)}
            onChange={(event) => {
              const dueAt = event.target.value
                ? new Date(event.target.value).toISOString()
                : null
              patchTask(dueAt ? { dueAt } : { dueAt: null, recurrenceRule: null })
            }}
            aria-label="截止时间"
          />
          <div className="detail-quick">
            <button onClick={() => patchTask({ dueAt: todayAt(18, 0) })}>今天 18:00</button>
            <button onClick={() => patchTask({ dueAt: tomorrowAt(9, 0) })}>明天 09:00</button>
            <button onClick={() => patchTask({ dueAt: null, recurrenceRule: null })}>
              清除
            </button>
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-label">提醒</div>
          <div className="detail-reminder-row">
            <button
              className={`detail-reminder-toggle ${task.remindAt ? 'active' : ''}`}
              onClick={() => {
                if (task.remindAt) {
                  patchTask({ remindAt: null })
                  return
                }
                const value = defaultReminderAt(task)
                if (value) patchTask({ remindAt: value })
              }}
            >
              <Bell size={13} strokeWidth={1.8} aria-hidden="true" />
              {task.remindAt ? '已设置提醒' : '添加提醒'}
            </button>
            {task.remindAt && (
              <span className="detail-reminder-time">{formatDue(task.remindAt)}</span>
            )}
          </div>
          {task.remindAt && (
            <>
              <input
                type="datetime-local"
                name="remind-at"
                className="detail-date-input detail-reminder-input"
                value={toLocalInput(task.remindAt)}
                onChange={(event) => {
                  patchTask({
                    remindAt: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : null
                  })
                }}
                aria-label="提醒时间"
              />
              <div className="detail-quick">
                <button
                  onClick={() =>
                    patchTask({
                      remindAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
                    })
                  }
                >
                  1 小时后
                </button>
                <button onClick={() => patchTask({ remindAt: tomorrowAt(9, 0) })}>
                  明天 09:00
                </button>
                <button onClick={() => patchTask({ remindAt: null })}>清除</button>
              </div>
            </>
          )}
        </section>

        <section className="detail-section">
          <div className="detail-label">重复</div>
          <div
            className="detail-chips"
            role="group"
            aria-label="重复"
            aria-describedby={!task.dueAt ? 'recurrence-hint' : undefined}
          >
            {RECURRENCE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={`detail-chip ${task.recurrenceRule === preset.rule ? 'active' : ''}`}
                disabled={!task.dueAt && preset.rule !== null}
                aria-pressed={task.recurrenceRule === preset.rule}
                onClick={() => patchTask({ recurrenceRule: preset.rule })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {task.recurrenceRule && (
            <div className="detail-recurrence-summary">
              {nextRecurrence
                ? `下次：${formatDue(nextRecurrence.toISOString())}`
                : '没有下一次'}
            </div>
          )}
          {!task.dueAt && (
            <div className="detail-hint" id="recurrence-hint">
              先设置截止时间，才能重复
            </div>
          )}
        </section>

        <section className="detail-section">
          <div className="detail-label">项目</div>
          <div className="detail-chips" role="group" aria-label="项目">
            <button
              className={`detail-chip ${task.projectId ? '' : 'active'}`}
              aria-pressed={!task.projectId}
              onClick={() => patchTask({ projectId: null })}
            >
              无项目
            </button>
            {projects.map((project) => (
              <button
                key={project.id}
                className={`detail-chip ${task.projectId === project.id ? 'active' : ''}`}
                aria-pressed={task.projectId === project.id}
                onClick={() => patchTask({ projectId: project.id })}
              >
                <span className="meta-dot" style={{ background: project.color }} />
                {project.name}
              </button>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-label">优先级</div>
          <div className="detail-priority" role="group" aria-label="优先级">
            {PRIORITIES.map((priority) => (
              <button
                key={priority.value}
                data-priority={priority.value}
                className={task.priority === priority.value ? 'active' : ''}
                aria-pressed={task.priority === priority.value}
                onClick={() => patchTask({ priority: priority.value })}
              >
                {priority.label}
              </button>
            ))}
          </div>
        </section>

        <div className="detail-footer">
          <div className="detail-meta">
            <div>创建于 {format(new Date(task.createdAt), 'M月d日 HH:mm', { locale: zhCN })}</div>
            <div>更新于 {format(new Date(task.updatedAt), 'M月d日 HH:mm', { locale: zhCN })}</div>
          </div>
          <button className="detail-delete" onClick={() => void removeTask(task.id)}>
            <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
            删除
          </button>
        </div>
      </div>
    </>
  )
}