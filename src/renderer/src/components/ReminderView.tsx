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

  const snooze = async (minutes: number) => {
    if (!task) return
    try {
      await updateTask(task.id, {
        remindAt: new Date(Date.now() + minutes * 60 * 1000).toISOString()
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
            <div className="reminder-meta">
              <span>{formatDue(task.dueAt, locale)}</span>
              {project && (
                <span className="meta-project">
                  <span className="meta-dot" style={{ background: project.color }} />
                  <span className="meta-project-name">{project.name}</span>
                </span>
              )}
            </div>
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