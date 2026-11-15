import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { Search, Trash2 } from './Icon'
import type { AppView, Task } from '@shared/types'
import { TRASH_RETENTION_DAYS } from '@shared/retention'
import { useTaskStore } from '../stores/useTaskStore'
import { useAppVersion } from '../stores/useAppVersion'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { ProgressRing } from './ProgressRing'
import { QuickAdd } from './QuickAdd'
import { TaskItem } from './TaskItem'
import { TrashItem } from './TrashItem'
import { formatHeaderDate, isTodayOrOverdue, isUpcoming } from '../lib/dates'

const VIEW_TITLES: Record<AppView, string> = {
  today: '今天',
  upcoming: '即将到来',
  all: '全部任务',
  completed: '已完成',
  trash: '回收站'
}

function viewEyebrow(view: AppView): string {
  if (view === 'today') return formatHeaderDate()
  if (view === 'upcoming') return '接下来几天的安排'
  if (view === 'completed') return '已经完成的事项'
  if (view === 'trash') return `删除的任务保留 ${TRASH_RETENTION_DAYS} 天`
  return '所有未完成的事项'
}

export function TaskView() {
  const tasks = useTaskStore((state) => state.tasks)
  const trashedTasks = useTaskStore((state) => state.trashedTasks)
  const projects = useTaskStore((state) => state.projects)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)
  const setView = useTaskStore((state) => state.setView)
  const setPaletteOpen = useTaskStore((state) => state.setPaletteOpen)
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const trashConfirm = useTaskStore((state) => state.trashConfirm)
  const setTrashConfirm = useTaskStore((state) => state.setTrashConfirm)
  const deleteForever = useTaskStore((state) => state.deleteForever)
  const emptyTrash = useTaskStore((state) => state.emptyTrash)
  // 页脚常驻，挂载即取；与设置面板共用同一份版本号。
  const version = useAppVersion()

  const quickAddRef = useRef<HTMLInputElement>(null)
  // 确认后的焦点落点：undefined = 取消（trap 自己还焦点），null = 主区域，
  // 元素 = 邻行。等对话框退场完成再落，避免和 trap 的清理抢焦点。
  const focusAfterExit = useRef<HTMLElement | null | undefined>(undefined)

  useEffect(() => {
    const focusQuickAdd = () => {
      // 确认弹窗开着时不路由：模态期间背景视图不该被切走。
      if (trashConfirm) return
      if (quickAddRef.current) {
        quickAddRef.current.focus()
        return
      }
      // 回收站不挂输入框：路由回「今天」再聚焦。N、面板「新建任务」和
      // footer 提示都走这一条事件路径，提示不是假 affordance。
      if (view === 'trash') {
        setView('today')
        requestAnimationFrame(() => quickAddRef.current?.focus())
      }
    }
    window.addEventListener('polaris:quick-add', focusQuickAdd)
    return () => window.removeEventListener('polaris:quick-add', focusQuickAdd)
  }, [view, setView, trashConfirm])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (
        !typing &&
        !selectedTaskId &&
        !paletteOpen &&
        !trashConfirm &&
        event.key.toLowerCase() === 'n'
      ) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('polaris:quick-add'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedTaskId, paletteOpen, trashConfirm])

  const { visible, completed, totalToday, doneToday } = useMemo(() => {
    const inProject = (task: Task) => !projectFilter || task.projectId === projectFilter

    const active = tasks.filter((task) => !task.completed && inProject(task))
    const completedTasks = tasks.filter((task) => task.completed && inProject(task))

    const todayActive = tasks.filter((task) => !task.completed && isTodayOrOverdue(task.dueAt))
    const todayDone = tasks.filter(
      (task) => task.completed && task.dueAt && isTodayOrOverdue(task.dueAt)
    )

    let filtered: Task[]
    if (view === 'trash') {
      filtered = trashedTasks
    } else if (view === 'completed') {
      filtered = []
    } else if (view === 'today') {
      filtered = active.filter((task) => isTodayOrOverdue(task.dueAt))
    } else if (view === 'upcoming') {
      filtered = active.filter((task) => isUpcoming(task.dueAt))
    } else {
      filtered = active
    }

    const completedForView =
      view === 'trash'
        ? []
        : view === 'today'
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
  }, [tasks, trashedTasks, view, projectFilter])

  const projectName = projectFilter
    ? projects.find((project) => project.id === projectFilter)?.name
    : undefined
  const title = projectName ?? VIEW_TITLES[view]
  const subtitle = projectFilter ? `${visible.length} 项未完成` : viewEyebrow(view)
  const progress = totalToday === 0 ? 0 : doneToday / totalToday

  const confirmMessage = trashConfirm
    ? trashConfirm.kind === 'purge'
      ? `彻底删除「${trashConfirm.task.title}」？此操作无法撤销。`
      : `清空回收站？将彻底删除 ${trashedTasks.length} 个任务，此操作无法撤销。`
    : ''

  const runConfirm = () => {
    if (!trashConfirm) return
    if (trashConfirm.kind === 'empty') {
      // 清空后触发按钮变禁用，接不住还焦点；落回主区域。
      focusAfterExit.current = null
      setTrashConfirm(null)
      void emptyTrash()
      return
    }
    const id = trashConfirm.task.id
    const row = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling
    focusAfterExit.current = sibling?.querySelector<HTMLElement>('.trash-restore') ?? null
    setTrashConfirm(null)
    void deleteForever(id)
  }

  const handleConfirmExitComplete = () => {
    const target = focusAfterExit.current
    focusAfterExit.current = undefined
    if (target === undefined) return
    requestAnimationFrame(() => {
      // 退场期间又开了新对话框的话，别把焦点从新触发者手里抢走。
      if (document.querySelector('.confirm-panel')) return
      // 邻行可能已随退场卸载（reduced-motion 下立即卸载），聚焦它会丢到 body。
      const live = target?.isConnected ? target : document.querySelector<HTMLElement>('.main')
      live?.focus()
    })
  }

  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <div className="main-inner">
        <header className="view-header">
          <div>
            <div className="view-eyebrow">{subtitle}</div>
            <h1 className="view-title">{title}</h1>
          </div>
          <div className="header-actions">
            {view === 'trash' ? (
              <button
                className="trash-empty-trigger"
                disabled={trashedTasks.length === 0}
                onClick={() => setTrashConfirm({ kind: 'empty' })}
              >
                <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>清空回收站</span>
              </button>
            ) : (
              <>
                <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
                  <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span>搜索</span>
                  <kbd>Ctrl K</kbd>
                </button>
                <ProgressRing value={progress} label={`${doneToday}/${totalToday}`} />
              </>
            )}
          </div>
        </header>

        {view !== 'completed' && view !== 'trash' && <QuickAdd inputRef={quickAddRef} />}

        {visible.length === 0 && completed.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          <div className="task-sections">
            {visible.length > 0 && (
              <section className="task-section">
                <div className="section-label">
                  <span>
                    {view === 'today'
                      ? '今天要做'
                      : view === 'upcoming'
                        ? '接下来'
                        : view === 'trash'
                          ? '已删除'
                          : '待办'}
                  </span>
                  <span className="section-count">{visible.length}</span>
                </div>
                <div className="task-list">
                  <AnimatePresence initial={false}>
                    {visible.map((task) =>
                      view === 'trash' ? (
                        <TrashItem
                          key={task.id}
                          task={task}
                          onAskPurge={(target) => setTrashConfirm({ kind: 'purge', task: target })}
                        />
                      ) : (
                        <TaskItem key={task.id} task={task} />
                      )
                    )}
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
          <span className="footer-brand">
            Polaris
            {version && (
              <>
                {' '}
                <span className="footer-version">{version}</span>
              </>
            )}
          </span>
        </div>
      </div>

      <AnimatePresence onExitComplete={handleConfirmExitComplete}>
        {trashConfirm && (
          <ConfirmDialog
            message={confirmMessage}
            confirmLabel={trashConfirm.kind === 'empty' ? '确认清空' : '彻底删除'}
            onConfirm={runConfirm}
            onClose={() => setTrashConfirm(null)}
          />
        )}
      </AnimatePresence>
    </main>
  )
}