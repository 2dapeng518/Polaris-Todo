import { useRef } from 'react'
import { motion } from 'motion/react'
import { Bell, Check, Flag, Repeat2, Trash2 } from 'lucide-react'
import type { Task } from '@shared/types'
import { recurrenceLabel } from '@shared/recurrence'
import { useTaskStore } from '../stores/useTaskStore'
import { formatDue, isOverdue } from '../lib/dates'

export function TaskItem({ task }: { task: Task }) {
  const toggleTask = useTaskStore((state) => state.toggleTask)
  const removeTask = useTaskStore((state) => state.removeTask)
  const selectTask = useTaskStore((state) => state.selectTask)
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  const projects = useTaskStore((state) => state.projects)

  const project = task.projectId
    ? projects.find((candidate) => candidate.id === task.projectId)
    : undefined
  const overdue = !task.completed && isOverdue(task.dueAt)
  const selected = selectedTaskId === task.id
  const rowRef = useRef<HTMLDivElement | null>(null)

  const handleDelete = async () => {
    const row = rowRef.current
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling
    const target = sibling?.querySelector<HTMLElement>('.task-open')

    await removeTask(task.id)
    requestAnimationFrame(() => {
      ;(target ?? document.querySelector<HTMLElement>('.quick-add input'))?.focus()
    })
  }

  return (
    <motion.div
      ref={rowRef}
      data-task-id={task.id}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ type: 'spring', stiffness: 420, damping: 40 }}
      className={`task-item ${task.completed ? 'done' : ''} ${selected ? 'selected' : ''}`}
    >
      <button
        className={`task-check ${task.completed ? 'done' : ''}`}
        onClick={() => void toggleTask(task.id)}
        aria-label={task.completed ? '标记为未完成' : '标记为完成'}
        aria-pressed={task.completed}
      >
        {/* 不写 strokeWidth：它是 svg 的 presentation attribute，优先级低于
            .task-check .lucide 的 CSS，写了也不生效。粗细由 --icon-stroke-strong 决定。
            入场动画是 globals.css 的 check-draw，一次性描边。 */}
        {task.completed && (
          <Check
            size={12}
            aria-hidden="true"
            style={{ stroke: 'var(--check-mark)' }}
          />
        )}
      </button>

      <button
        type="button"
        className="task-content task-open"
        onClick={() => selectTask(task.id)}
      >
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {task.dueAt && (
            <span className={`meta-time ${overdue ? 'meta-overdue' : ''}`}>
              {formatDue(task.dueAt)}
            </span>
          )}
          {task.remindAt && (
            <span className="meta-reminder meta-time" title="已设置提醒">
              <Bell
                size={10}
                strokeWidth={1.8}
                className="meta-reminder-icon"
                aria-hidden="true"
              />
              {formatDue(task.remindAt)}
            </span>
          )}
          {project && (
            <span className="meta-project">
              <span className="meta-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {task.recurrenceRule && (
            <span className="meta-recurrence" title={`重复：${recurrenceLabel(task.recurrenceRule)}`}>
              <Repeat2 size={10} strokeWidth={1.8} aria-hidden="true" />
              {recurrenceLabel(task.recurrenceRule)}
            </span>
          )}
          {task.priority >= 2 && (
            <span
              className={`meta-priority ${task.priority === 3 ? 'meta-priority-high' : ''}`}
            >
              <Flag size={10} strokeWidth={2} aria-hidden="true" />
              {task.priority === 3 ? '高优先级' : '中优先级'}
            </span>
          )}
        </span>
      </button>

      <button
        className="task-delete"
        onClick={() => void handleDelete()}
        aria-label="删除任务"
      >
        <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </motion.div>
  )
}