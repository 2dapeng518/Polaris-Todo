import { useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronRight } from '../Icon'
import type { Task } from '@shared/types'
import { useT, useLocale } from '../../stores/useLocaleStore'
import { buildListGroups } from './grouping'
import { TaskItem } from '../TaskItem'

// 日历列表视图（日历套件 P1.2）：按日分组的议程。已过期/今天/明天/周几相对
// 标签 + 无日期分区——无日期任务不再像月格那样被排除。行复用主列表的
// TaskItem（勾选/详情/删除/元信息全套行为一致）；已完成区默认折叠，
// 折叠开关与 TaskView 的区头同款（组件只挂在列表模式，切走即重置）。
export function CalendarListView({ tasks, now }: { tasks: Task[]; now: Date }) {
  const t = useT()
  const locale = useLocale()
  const [completedExpanded, setCompletedExpanded] = useState(false)

  const labels = useMemo(
    () => ({
      overdue: t('calendar.group.overdue'),
      noDate: t('calendar.group.noDate'),
      today: t('calendar.today'),
      tomorrow: t('calendar.tomorrow')
    }),
    [t]
  )

  const { groups, completed } = useMemo(() => {
    const active = tasks.filter((task) => !task.completed)
    return {
      groups: buildListGroups(active, now, locale, labels),
      completed: tasks.filter((task) => task.completed)
    }
  }, [tasks, now, locale, labels])

  if (groups.length === 0 && completed.length === 0) {
    return (
      <div className="calendar-empty" data-calendar-list-empty>
        <div className="calendar-empty-title">{t('calendar.empty.list.title')}</div>
        <div className="calendar-empty-desc">{t('calendar.empty.list.desc')}</div>
      </div>
    )
  }

  return (
    <div className="calendar-list" data-calendar-list>
      {groups.map((group) => (
        <section key={group.key} className="calendar-list-group">
          <div className="calendar-list-head">
            <span className={group.key === 'overdue' ? 'is-overdue' : ''}>{group.label}</span>
            <span className="section-count">{group.tasks.length}</span>
          </div>
          <div className="task-list">
            <AnimatePresence initial={false}>
              {group.tasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}

      {completed.length > 0 && (
        <section className="calendar-list-group completed-section">
          <button
            type="button"
            className="section-label completed-toggle"
            aria-expanded={completedExpanded}
            aria-controls="calendar-completed-list"
            onClick={() => setCompletedExpanded((value) => !value)}
          >
            <ChevronRight size={12} className="completed-chevron" aria-hidden="true" />
            <span className="completed-toggle-label">
              {t('views.completedToggle', { count: completed.length })}
            </span>
          </button>
          <div className="task-list" id="calendar-completed-list" hidden={!completedExpanded}>
            {completedExpanded && (
              <AnimatePresence initial={false}>
                {completed.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </AnimatePresence>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
