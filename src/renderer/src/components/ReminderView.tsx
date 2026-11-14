import { useEffect } from 'react'
import { Bell, Check, Clock3, X } from 'lucide-react'
import { useTaskStore } from '../stores/useTaskStore'
import { formatDue } from '../lib/dates'
import { ThemeSync } from './ThemeSync'

export function ReminderView({ taskId }: { taskId: string }) {
  const tasks = useTaskStore((state) => state.tasks)
  const projects = useTaskStore((state) => state.projects)
  const loading = useTaskStore((state) => state.loading)
  const load = useTaskStore((state) => state.load)
  const updateTask = useTaskStore((state) => state.updateTask)

  useEffect(() => {
    void load()
  }, [load])

  const task = tasks.find((candidate) => candidate.id === taskId)
  const project = task?.projectId
    ? projects.find((candidate) => candidate.id === task.projectId)
    : undefined

  const dismiss = () => {
    void window.polaris.reminder.dismiss()
  }

  const complete = async () => {
    if (!task) return
    try {
      await updateTask(task.id, { completed: true })
      dismiss()
    } catch (error) {
      console.error('Failed to complete reminder task:', error)
      dismiss()
    }
  }

  const snooze = async () => {
    if (!task) return
    try {
      await updateTask(task.id, {
        remindAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })
      dismiss()
    } catch (error) {
      console.error('Failed to snooze reminder:', error)
      dismiss()
    }
  }

  return (
    <div className="reminder-shell">
      <ThemeSync />
      <div className="reminder-card">
        <div className="reminder-header">
          <div className="reminder-eyebrow">
            <Bell size={12} strokeWidth={1.9} aria-hidden="true" />
            <span>提醒{task?.remindAt ? ` · ${formatDue(task.remindAt)}` : ''}</span>
          </div>
          <button className="reminder-close" onClick={dismiss} aria-label="关闭提醒">
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="reminder-loading">正在载入提醒…</div>
        ) : task ? (
          <>
            <div className="reminder-title">{task.title}</div>
            <div className="reminder-meta">
              <span>{formatDue(task.dueAt)}</span>
              {project && (
                <span className="meta-project">
                  <span className="meta-dot" style={{ background: project.color }} />
                  <span className="meta-project-name">{project.name}</span>
                </span>
              )}
            </div>
            <div className="reminder-actions">
              <button className="reminder-primary" onClick={() => void complete()}>
                <Check size={14} aria-hidden="true" />
                完成
              </button>
              <button className="reminder-secondary" onClick={() => void snooze()}>
                <Clock3 size={14} strokeWidth={1.8} aria-hidden="true" />
                稍后 10 分钟
              </button>
            </div>
          </>
        ) : (
          <div className="reminder-empty">
            <div className="reminder-empty-title">任务已不存在</div>
            <div className="reminder-empty-desc">这条提醒对应的任务可能已被删除</div>
            <button className="reminder-secondary" onClick={dismiss}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  )
}