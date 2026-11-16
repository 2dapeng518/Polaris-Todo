import { useEffect, useMemo, useState } from 'react'
import { useTaskStore } from '../stores/useTaskStore'
import { isTodayOrOverdue } from '../lib/dates'
import { TaskItem } from './TaskItem'

// 派生规则：重要 = priority >= 2（中/高）；紧急 = 今天到期或已逾期，
// 无截止视为不紧急。只统计未完成任务；已完成不进矩阵。
const QUADRANTS = [
  { id: 'do', label: '立即做', hint: '重要且紧急', important: true, urgent: true },
  { id: 'plan', label: '计划做', hint: '重要不紧急', important: true, urgent: false },
  { id: 'quick', label: '快速处理', hint: '紧急不重要', important: false, urgent: true },
  { id: 'later', label: '有余力再做', hint: '不紧急不重要', important: false, urgent: false }
] as const

export function MatrixView() {
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
    <div className="matrix-view" role="group" aria-label="四象限">
      {groups.map((group) => (
        <section
          key={group.id}
          className="matrix-quadrant"
          data-quadrant={group.id}
          aria-label={`${group.label}：${group.hint}`}
        >
          <div className="matrix-quadrant-head">
            <span className="matrix-quadrant-title">{group.label}</span>
            <span className="matrix-quadrant-hint">{group.hint}</span>
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
            <p className="matrix-quadrant-empty">暂时没有任务</p>
          )}
        </section>
      ))}
    </div>
  )
}
