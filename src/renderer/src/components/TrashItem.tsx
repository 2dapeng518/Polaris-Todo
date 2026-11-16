import { useRef } from 'react'
import { motion } from 'motion/react'
import type { Task } from '@shared/types'
import { TRASH_RETENTION_DAYS } from '@shared/retention'
import { useTaskStore } from '../stores/useTaskStore'
import { formatDeletedAt } from '../lib/dates'
import { useLocale, useT } from '../stores/useLocaleStore'

const DAY_MS = 24 * 60 * 60 * 1000

type TrashItemProps = {
  task: Task
  onAskPurge: (task: Task) => void
}

// 回收站行：软删任务对 update/toggle 会抛「任务不存在」，所以这里没有
// checkbox、也没有打开详情的入口——内容只是文本，动作只有恢复与彻底删除。
export function TrashItem({ task, onAskPurge }: TrashItemProps) {
  const t = useT()
  const locale = useLocale()
  const restoreFromTrash = useTaskStore((state) => state.restoreFromTrash)
  const projects = useTaskStore((state) => state.projects)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const project = task.projectId
    ? projects.find((candidate) => candidate.id === task.projectId)
    : undefined
  const remainingDays = task.deletedAt
    ? Math.ceil(
        (new Date(task.deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS - Date.now()) / DAY_MS
      )
    : null

  const handleRestore = async () => {
    const row = rowRef.current
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling
    const target = sibling?.querySelector<HTMLElement>('.trash-restore')

    await restoreFromTrash(task.id)
    requestAnimationFrame(() => {
      // 邻行可能正在退场（reduced-motion 下立即卸载），聚焦它会随卸载丢到 body。
      const live = target?.isConnected
        ? target
        : document.querySelector<HTMLElement>('.trash-restore')
      ;(live?.isConnected ? live : document.querySelector<HTMLElement>('.main'))?.focus()
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
      className="task-item trash-item"
    >
      <div className="task-content">
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {task.deletedAt && (
            <span className="meta-time">{t('views.trash.deletedAt', { time: formatDeletedAt(task.deletedAt, locale) })}</span>
          )}
          {remainingDays !== null && (
            <span className="meta-time">
              {remainingDays > 0 ? t('views.trash.remaining', { days: remainingDays }) : t('views.trash.soon')}
            </span>
          )}
          {project && (
            <span className="meta-project">
              <span className="meta-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
        </span>
      </div>

      {/* 动作常显：回收站是管理视图，不像主列表那样把删除藏在 hover 里。 */}
      <div className="trash-actions">
        <button className="trash-restore" onClick={() => void handleRestore()}>
          {t('views.trash.restore')}
        </button>
        <button className="trash-purge" onClick={() => onAskPurge(task)}>
          {t('views.trash.purge')}
        </button>
      </div>
    </motion.div>
  )
}