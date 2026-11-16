import { useEffect, useMemo, useState } from 'react'
import { useTaskStore } from '../stores/useTaskStore'
import { useT } from '../stores/useLocaleStore'
import { isTodayOrOverdue } from '../lib/dates'
import { TaskItem } from './TaskItem'

// 派生规则：重要 = priority >= 2（中/高）；紧急 = 今天到期或已逾期，
// 无截止视为不紧急。只统计未完成任务；已完成不进矩阵。
const QUADRANTS = [
  { id: 'do', labelKey: 'matrix.do', hintKey: 'matrix.doHint', important: true, urgent: true },
  { id: 'plan', labelKey: 'matrix.plan', hintKey: 'matrix.planHint', important: true, urgent: false },
  { id: 'quick', labelKey: 'matrix.quick', hintKey: 'matrix.quickHint', important: false, urgent: true },
  { id: 'later', labelKey: 'matrix.later', hintKey: 'matrix.laterHint', important: false, urgent: false }
] as const

export function MatrixView() {
  const t = useT()
  const tasks = useTaskStore((state) => state.tasks)
  // 矩阵可能长时间开着：跨过午夜后「紧急」的判定不能还是昨天。
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const groups = useMemo(() => {
    const active = tasks.filter((task) => !task.completed)
    return QUADRANTS.map((quadrant) => ({
      ...quadrant,
      items: active.filter((task) => {
        const important = task.priority >= 2
        const urgent = isTodayOrOverdue(task.dueAt)
        return important === quadrant.important && urgent === quadrant.urgent
      })
    }))
  }, [tasks, now])

  return (
    <div className="matrix-view" role="group" aria-label={t('matrix.groupAria')}>
      {groups.map((group) => (
        <section
          key={group.id}
          className="matrix-quadrant"
          data-quadrant={group.id}
          aria-label={t('matrix.sectionAria', {
            label: t(group.labelKey),
            hint: t(group.hintKey)
          })}
        >
          <div className="matrix-quadrant-head">
            <span className="matrix-quadrant-title">{t(group.labelKey)}</span>
            <span className="matrix-quadrant-hint">{t(group.hintKey)}</span>
            <span className="matrix-quadrant-count" data-quadrant-count>
              {group.items.length}
            </span>
          </div>
          {group.items.length > 0 ? (
            <div className="matrix-quadrant-list">
              {group.items.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <p className="matrix-quadrant-empty">{t('matrix.empty')}</p>
          )}
        </section>
      ))}
    </div>
  )
}
