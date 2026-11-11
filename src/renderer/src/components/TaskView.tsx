import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { Search } from 'lucide-react'
import type { AppView, Task } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { EmptyState } from './EmptyState'
import { ProgressRing } from './ProgressRing'
import { QuickAdd } from './QuickAdd'
import { TaskItem } from './TaskItem'
import { formatHeaderDate, isTodayOrOverdue, isUpcoming } from '../lib/dates'

const VIEW_TITLES: Record<AppView, string> = {
  today: '今天',
  upcoming: '即将到来',
  all: '全部任务',
  completed: '已完成'
}

function viewEyebrow(view: AppView): string {
  if (view === 'today') return formatHeaderDate()
  if (view === 'upcoming') return '接下来几天的安排'
  if (view === 'completed') return '已经完成的事项'
  return '所有未完成的事项'
}

export function TaskView() {
  const tasks = useTaskStore((state) => state.tasks)
  const projects = useTaskStore((state) => state.projects)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)
  const setPaletteOpen = useTaskStore((state) => state.setPaletteOpen)
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  const quickAddRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusQuickAdd = () => quickAddRef.current?.focus()
    window.addEventListener('polaris:quick-add', focusQuickAdd)
    return () => window.removeEventListener('polaris:quick-add', focusQuickAdd)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (!typing && !selectedTaskId && !paletteOpen && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        quickAddRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedTaskId, paletteOpen])

  const { visible, completed, totalToday, doneToday } = useMemo(() => {
    const inProject = (task: Task) => !projectFilter || task.projectId === projectFilter

    const active = tasks.filter((task) => !task.completed && inProject(task))
    const completedTasks = tasks.filter((task) => task.completed && inProject(task))

    const todayActive = tasks.filter((task) => !task.completed && isTodayOrOverdue(task.dueAt))
    const todayDone = tasks.filter(
      (task) => task.completed && task.dueAt && isTodayOrOverdue(task.dueAt)
    )

    let filtered: Task[]
    if (view === 'completed') {
      filtered = []
    } else if (view === 'today') {
      filtered = active.filter((task) => isTodayOrOverdue(task.dueAt))
    } else if (view === 'upcoming') {
      filtered = active.filter((task) => isUpcoming(task.dueAt))
    } else {
      filtered = active
    }

    const completedForView =
      view === 'today'
        ? completedTasks.filter((task) => task.dueAt && isTodayOrOverdue(task.dueAt))
        : view === 'upcoming'
          ? completedTasks.filter((task) => task.dueAt && isUpcoming(task.dueAt))
          : completedTasks

    return {
      visible: filtered,
      completed: completedForView,
      totalToday: todayActive.length + todayDone.length,
      doneToday: todayDone.length
    }
  }, [tasks, view, projectFilter])

  const projectName = projectFilter
    ? projects.find((project) => project.id === projectFilter)?.name
    : undefined
  const title = projectName ?? VIEW_TITLES[view]
  const subtitle = projectFilter ? `${visible.length} 项未完成` : viewEyebrow(view)
  const progress = totalToday === 0 ? 0 : doneToday / totalToday

  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <div className="main-inner">
        <header className="view-header">
          <div>
            <div className="view-eyebrow">{subtitle}</div>
            <h1 className="view-title">{title}</h1>
          </div>
          <div className="header-actions">
            <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>搜索</span>
              <kbd>Ctrl K</kbd>
            </button>
            <ProgressRing value={progress} label={`${doneToday}/${totalToday}`} />
          </div>
        </header>

        {view !== 'completed' && <QuickAdd inputRef={quickAddRef} />}

        {visible.length === 0 && completed.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          <div className="task-sections">
            {visible.length > 0 && (
              <section className="task-section">
                <div className="section-label">
                  <span>
                    {view === 'today' ? '今天要做' : view === 'upcoming' ? '接下来' : '待办'}
                  </span>
                  <span className="section-count">{visible.length}</span>
                </div>
                <div className="task-list">
                  <AnimatePresence initial={false}>
                    {visible.map((task) => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            {completed.length > 0 && (
              <section className="task-section completed-section">
                <div className="section-label">
                  <span>已完成</span>
                  <span className="section-count">{completed.length}</span>
                </div>
                <div className="task-list">
                  <AnimatePresence initial={false}>
                    {completed.map((task) => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}
          </div>
        )}

        <div className="view-footer">
          <span>
            <kbd>N</kbd> 新建任务
          </span>
          <span>
            <kbd>Ctrl K</kbd> 命令面板
          </span>
          <span className="footer-brand">Polaris 0.1</span>
        </div>
      </div>
    </main>
  )
}