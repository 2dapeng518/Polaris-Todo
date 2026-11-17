import { memo, useRef } from 'react'
import { motion } from 'motion/react'
import { Bell, Check, Flag, ListChecks, Repeat2, Trash2 } from './Icon'
import type { Task } from '@shared/types'
import { recurrenceLabel } from '@shared/recurrence'
import { useTaskStore } from '../stores/useTaskStore'
import { formatCompletedAt, formatDue, isOverdue } from '../lib/dates'
import { useLocale, useT } from '../stores/useLocaleStore'

// memo：列表里任何一行的乐观更新都会替换 tasks 数组，但 store 只替换被改的
// 那个任务对象，其余行引用不变——memo 让无关行跳过重渲染。
// 唯一 prop 是 task 对象；行内回调不进 props，无需 useCallback。
export const TaskItem = memo(function TaskItem({ task }: { task: Task }) {
  const t = useT()
  const locale = useLocale()
  const toggleTask = useTaskStore((state) => state.toggleTask)
  const removeTask = useTaskStore((state) => state.removeTask)
  const selectTask = useTaskStore((state) => state.selectTask)
  // 布尔 selector：订阅 selectedTaskId 整值会让每次选中切换重渲染所有行；
  // 只有「本行是否被选中」翻转的那两行需要重渲染。
  const selected = useTaskStore((state) => state.selectedTaskId === task.id)
  // 只取本行需要的项目对象：订阅整个 projects 数组会让项目编辑波及每一行。
  const project = useTaskStore((state) =>
    task.projectId ? state.projects.find((candidate) => candidate.id === task.projectId) : undefined
  )
  const overdue = !task.completed && isOverdue(task.dueAt)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const handleDelete = async () => {
    const row = rowRef.current
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling
    const target = sibling?.querySelector<HTMLElement>('.task-open')

    await removeTask(task.id)
    requestAnimationFrame(() => {
      // 落点兜底链：邻行 → 快速添加框 → 主区域。已完成视图不挂快速添加，
      // 展开态删掉最后一条已完成行时整区卸载，没有 .main 兜底焦点会丢到 body。
      const fallback =
        document.querySelector<HTMLElement>('.quick-add input') ??
        document.querySelector<HTMLElement>('.main')
      ;(target ?? fallback)?.focus()
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
        aria-label={task.completed ? t('views.item.markIncomplete') : t('views.item.markComplete')}
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
          {task.completed && task.completedAt && (
            <span className="meta-completed meta-time" title={t('views.item.completedAtTitle')}>
              <Check size={10} strokeWidth={1.8} className="meta-completed-icon" aria-hidden="true" />
              {t('views.item.completedAt', { time: formatCompletedAt(task.completedAt, locale) })}
            </span>
          )}
          {task.dueAt && (
            <span className={`meta-time ${overdue ? 'meta-overdue' : ''}`}>
              {formatDue(task.dueAt, locale)}
            </span>
          )}
          {task.remindAt && (
            <span className="meta-reminder meta-time" title={t('views.item.reminderTitle')}>
              <Bell
                size={10}
                strokeWidth={1.8}
                className="meta-reminder-icon"
                aria-hidden="true"
              />
              {formatDue(task.remindAt, locale)}
            </span>
          )}
          {project && (
            <span className="meta-project">
              <span className="meta-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {task.tags.length > 0 && (
            <span className="meta-tags" aria-label={t('views.item.tags', { tags: task.tags.map((tag) => tag.name).join(locale === 'en' ? ', ' : '、') })}>
              {task.tags.slice(0, 3).map((tag) => (
                <span key={tag.id} className="meta-tag" data-tag-name={tag.name}>
                  #{tag.name}
                </span>
              ))}
              {task.tags.length > 3 && (
                <span
                  className="meta-tag meta-tag-more"
                  title={task.tags.slice(3).map((tag) => `#${tag.name}`).join(' ')}
                >
                  +{task.tags.length - 3}
                </span>
              )}
            </span>
          )}
          {task.recurrenceRule && (
            <span className="meta-recurrence" title={t('views.item.recurrence', { label: recurrenceLabel(task.recurrenceRule, locale) })}>
              <Repeat2 size={10} strokeWidth={1.8} aria-hidden="true" />
              {recurrenceLabel(task.recurrenceRule, locale)}
            </span>
          )}
          {task.subtaskTotal > 0 && (
            <span
              className="meta-subtasks"
              data-subtask-badge
              title={t('views.item.checklist', { done: task.subtaskDone, total: task.subtaskTotal })}
            >
              <ListChecks size={10} strokeWidth={1.8} aria-hidden="true" />
              {task.subtaskDone}/{task.subtaskTotal}
            </span>
          )}
          {task.priority >= 2 && (
            <span
              className={`meta-priority ${task.priority === 3 ? 'meta-priority-high' : ''}`}
            >
              <Flag size={10} strokeWidth={2} aria-hidden="true" />
              {task.priority === 3 ? t('views.item.high') : t('views.item.medium')}
            </span>
          )}
        </span>
      </button>

      <button
        className="task-delete"
        onClick={() => void handleDelete()}
        aria-label={t('views.item.delete')}
      >
        <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </motion.div>
  )
})