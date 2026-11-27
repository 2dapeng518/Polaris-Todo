import { useEffect, useState } from 'react'
import { Bell, Check, Clock3, X } from './Icon'
import { useTaskStore } from '../stores/useTaskStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { formatDue } from '../lib/dates'
import { ThemeSync } from './ThemeSync'

export function ReminderView({ taskId }: { taskId: string }) {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const projects = useTaskStore((state) => state.projects)
  const loading = useTaskStore((state) => state.loading)
  const load = useTaskStore((state) => state.load)
  const updateTask = useTaskStore((state) => state.updateTask)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  // 写失败必须留在窗内可见并允许重试；提醒窗不挂 UndoToast，静默关窗会让
  // 用户以为任务已完成，而 reminded_at 已写过，这次提醒也不会再弹。
  const [saveFailed, setSaveFailed] = useState(false)

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
    setSaveFailed(false)
    try {
      await updateTask(task.id, { completed: true })
      dismiss()
    } catch (error) {
      console.error('Failed to complete reminder task:', error)
      setSaveFailed(true)
    }
  }

  const snooze = async (minutes: number) => {
    if (!task) return
    setSaveFailed(false)
    try {
      await updateTask(task.id, {
        remindAt: new Date(Date.now() + minutes * 60 * 1000).toISOString()
      })
      dismiss()
    } catch (error) {
      console.error('Failed to snooze reminder:', error)
      setSaveFailed(true)
    }
  }

  return (
    <div className="reminder-shell">
      <ThemeSync />
      <div className="reminder-card">
        <div className="reminder-header">
          <div className="reminder-eyebrow">
            <Bell size={12} strokeWidth={1.9} aria-hidden="true" />
            <span>
              {t('reminder.title')}
              {task?.remindAt ? ` · ${formatDue(task.remindAt, locale)}` : ''}
            </span>
          </div>
          <button
            className="reminder-close"
            onClick={dismiss}
            aria-label={t('reminder.close')}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="reminder-loading">{t('reminder.loading')}</div>
        ) : task ? (
          <>
            <div className="reminder-title">{task.title}</div>
            {saveFailed ? (
              // 与 meta 同一行高，替换而不是追加：420×212 的窗口没有多余行预算。
              <div className="reminder-meta reminder-error" role="alert">
                {t('reminder.saveFailed')}
              </div>
            ) : (
              <div className="reminder-meta">
                <span>{formatDue(task.dueAt, locale)}</span>
                {project && (
                  <span className="meta-project">
                    <span className="meta-dot" style={{ background: project.color }} />
                    <span className="meta-project-name">{project.name}</span>
                  </span>
                )}
              </div>
            )}
            <div className="reminder-actions">
              {snoozeOpen ? (
                <>
                  {[10, 30, 60].map((minutes) => (
                    <button
                      key={minutes}
                      className="reminder-secondary reminder-snooze-tier"
                      onClick={() => void snooze(minutes)}
                    >
                      {t('reminder.minutes', { count: minutes })}
                    </button>
                  ))}
                  <button
                    className="reminder-snooze-cancel"
                    onClick={() => setSnoozeOpen(false)}
                    aria-label={t('reminder.snoozeCancel')}
                  >
                    <X size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <button className="reminder-primary" onClick={() => void complete()}>
                    <Check size={14} aria-hidden="true" />
                    {t('reminder.complete')}
                  </button>
                  <button
                    className="reminder-secondary"
                    onClick={() => setSnoozeOpen(true)}
                    aria-haspopup="true"
                    aria-expanded={snoozeOpen}
                  >
                    <Clock3 size={14} strokeWidth={1.8} aria-hidden="true" />
                    {t('reminder.snooze')}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="reminder-empty">
            <div className="reminder-empty-title">{t('reminder.missing')}</div>
            <div className="reminder-empty-desc">{t('reminder.missingDesc')}</div>
            <button className="reminder-secondary" onClick={dismiss}>
              {t('reminder.closeAction')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}