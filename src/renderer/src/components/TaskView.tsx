import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronRight, Search, Trash2 } from './Icon'
import type { AppView, Task } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { TRASH_RETENTION_DAYS } from '@shared/retention'
import { useTaskStore } from '../stores/useTaskStore'
import { useShortcutKeys } from '../stores/useShortcutsStore'
import { displayKeys, eventMatchesKeys } from '../lib/shortcuts'
import { useAppVersion } from '../stores/useAppVersion'
import { useMinuteTick } from '../lib/useMinuteTick'
import { hasOpenOverlay } from '../lib/useOverlayClose'
import { useT, useLocale } from '../stores/useLocaleStore'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { ProgressRing } from './ProgressRing'
import { QuickAdd } from './QuickAdd'
import { StatsView } from './StatsView'
import { MatrixView } from './MatrixView'
import { CalendarView } from './CalendarView'
import { TaskItem } from './TaskItem'
import { TrashItem } from './TrashItem'
import { formatHeaderDate, isTodayOrOverdue, isUpcoming } from '../lib/dates'

const VIEW_TITLES: Record<AppView, MessageKey> = {
  today: 'nav.view.today',
  upcoming: 'nav.view.upcoming',
  calendar: 'nav.view.calendar',
  all: 'nav.view.all',
  completed: 'nav.view.completed',
  stats: 'nav.view.stats',
  matrix: 'nav.view.matrix',
  trash: 'nav.view.trash'
}

function viewEyebrow(view: AppView, locale: 'zh-CN' | 'en', t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (view === 'today') return formatHeaderDate(locale)
  if (view === 'upcoming') return t('views.eyebrow.upcoming')
  if (view === 'calendar') return t('views.eyebrow.calendar')
  if (view === 'completed') return t('views.eyebrow.completed')
  if (view === 'stats') return t('views.eyebrow.stats')
  if (view === 'matrix') return t('views.eyebrow.matrix')
  if (view === 'trash') return t('views.eyebrow.trash', { days: TRASH_RETENTION_DAYS })
  return t('views.eyebrow.all')
}

export function TaskView() {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const trashedTasks = useTaskStore((state) => state.trashedTasks)
  const projects = useTaskStore((state) => state.projects)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)
  const tagFilter = useTaskStore((state) => state.tagFilter)
  const tags = useTaskStore((state) => state.tags)
  const setView = useTaskStore((state) => state.setView)
  const setPaletteOpen = useTaskStore((state) => state.setPaletteOpen)
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const trashConfirm = useTaskStore((state) => state.trashConfirm)
  const setTrashConfirm = useTaskStore((state) => state.setTrashConfirm)
  const deleteForever = useTaskStore((state) => state.deleteForever)
  const emptyTrash = useTaskStore((state) => state.emptyTrash)

  // 钉底状态栏的条件渐隐带：仅「下面还有内容没滚完」时亮（scrollTop +
  // clientHeight < scrollHeight - 8），滚到底/短内容关闭——resting 态与
  // 归档不被染灰。scroll + ResizeObserver 双源（内容长高/视口变化都重算），
  // setState 同值自动 bail，零额外渲染。
  const mainRef = useRef<HTMLElement>(null)
  const [fadeBottom, setFadeBottom] = useState(false)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const update = () => setFadeBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 8)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [view])
  // 页脚常驻，挂载即取；与设置面板共用同一份版本号。
  const version = useAppVersion()

  // 已完成区默认折叠：组件内状态，不持久化——每次启动回到折叠。
  // 勾选完成不自动展开（防抢焦点）：行从活动区退场，只有计数 +1。
  const [completedExpanded, setCompletedExpanded] = useState(false)
  // 跨午夜重算「今天/即将到来」：常驻托盘整夜无写库时，focus 的修订号门控
  // 会跳过全量拉取，只有分钟 tick 能让派生列表重新判断日界。
  const nowTick = useMinuteTick()

  const quickAddRef = useRef<HTMLInputElement>(null)
  // 确认后的焦点落点：undefined = 取消（trap 自己还焦点），null = 主区域，
  // 元素 = 邻行。等对话框退场完成再落，避免和 trap 的清理抢焦点。
  const focusAfterExit = useRef<HTMLElement | null | undefined>(undefined)

  // 切视图 / 切项目或标签筛选时重置为折叠：展开是「当下想翻旧账」的临时
  // 意图，换个上下文就收回，避免带着上一个视图的展开态进入新列表。
  useEffect(() => {
    setCompletedExpanded(false)
  }, [view, projectFilter, tagFilter])

  useEffect(() => {
    const focusQuickAdd = (event: Event) => {
      // 确认弹窗或命令面板开着时不路由：模态期间背景视图不该被切走，
      // 更不能把焦点送到遮罩背后的输入框（全局热键也会派发这个事件）。
      // 必须读实时 store：命令面板的「新建任务」是先 setOpen(false) 再同步
      // 派发事件，闭包里的 paletteOpen 还是旧值，会把这条命令自己挡掉。
      const live = useTaskStore.getState()
      if (live.trashConfirm || live.paletteOpen || hasOpenOverlay()) return
      // 全局热键要求无论当前在哪个视图都回「今天」；N 键不带 detail，行为不变。
      const forceToday =
        (event as CustomEvent<{ forceToday?: boolean } | undefined>).detail?.forceToday === true
      if (forceToday && view !== 'today') {
        setView('today')
        requestAnimationFrame(() => quickAddRef.current?.focus())
        return
      }
      if (quickAddRef.current) {
        quickAddRef.current.focus()
        return
      }
      // 回收站/已完成与统计等派生页不挂输入框：路由回「今天」再聚焦。
      // N、面板「新建任务」和 footer 提示都走这一条事件路径，提示不是假 affordance。
      if (
        view === 'trash' ||
        view === 'completed' ||
        view === 'stats' ||
        view === 'matrix' ||
        view === 'calendar'
      ) {
        setView('today')
        requestAnimationFrame(() => quickAddRef.current?.focus())
      }
    }
    window.addEventListener('polaris:quick-add', focusQuickAdd)
    return () => window.removeEventListener('polaris:quick-add', focusQuickAdd)
  }, [view, setView, trashConfirm, paletteOpen])

  const quickAddKeys = useShortcutKeys('quick-add')
  const paletteKeys = useShortcutKeys('command-palette')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (
        !typing &&
        !selectedTaskId &&
        !paletteOpen &&
        !trashConfirm &&
        !hasOpenOverlay() &&
        eventMatchesKeys(event, quickAddKeys)
      ) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('polaris:quick-add'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedTaskId, paletteOpen, trashConfirm, quickAddKeys])

  const { visible, completed, totalToday, doneToday } = useMemo(() => {
    // 项目与标签筛选互斥（store 保证），双条件叠加让语义自洽。
    const inProject = (task: Task) =>
      (!projectFilter || task.projectId === projectFilter) &&
      (!tagFilter || task.tags.some((tag) => tag.id === tagFilter))

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
  }, [tasks, trashedTasks, view, projectFilter, tagFilter, nowTick])

  const projectName = projectFilter
    ? projects.find((project) => project.id === projectFilter)?.name
    : undefined
  const tagName = tagFilter ? tags.find((tag) => tag.id === tagFilter)?.name : undefined
  const title = projectName ?? (tagName ? `#${tagName}` : t(VIEW_TITLES[view]))
  const subtitle =
    projectFilter || tagFilter
      ? t('views.incompleteCount', { count: visible.length })
      : viewEyebrow(view, locale, t)
  const progress = totalToday === 0 ? 0 : doneToday / totalToday

  const confirmMessage = trashConfirm
    ? trashConfirm.kind === 'purge'
      ? t('views.purgeConfirm', { title: trashConfirm.task.title })
      : t('views.emptyConfirm', { count: trashedTasks.length })
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
    <main
      ref={mainRef}
      className={`main${fadeBottom ? ' can-scroll-down' : ''}`}
      id="main-content"
      tabIndex={-1}
    >
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
                <span>{t('views.emptyTrash')}</span>
              </button>
            ) : view === 'stats' || view === 'matrix' || view === 'calendar' ? (
              <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
                <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{t('common.search')}</span>
                <kbd>{displayKeys(paletteKeys)}</kbd>
              </button>
            ) : (
              <>
                <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
                  <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span>{t('common.search')}</span>
                  <kbd>{displayKeys(paletteKeys)}</kbd>
                </button>
                <ProgressRing value={progress} label={`${doneToday}/${totalToday}`} />
              </>
            )}
          </div>
        </header>

        {view !== 'completed' && view !== 'trash' && view !== 'stats' && view !== 'matrix' && view !== 'calendar' && (
          <QuickAdd inputRef={quickAddRef} />
        )}

        {view === 'stats' ? (
          <StatsView />
        ) : view === 'matrix' ? (
          <MatrixView />
        ) : view === 'calendar' ? (
          <CalendarView />
        ) : visible.length === 0 && completed.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          <div className="task-sections">
            {visible.length > 0 && (
              <section className="task-section">
                <div className="section-label">
                  <span>
                    {view === 'today'
                      ? t('views.section.today')
                      : view === 'upcoming'
                        ? t('views.section.upcoming')
                        : view === 'trash'
                          ? t('views.section.trash')
                          : t('views.section.todo')}
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
                {/* 折叠开关沿用区头视觉（.section-label），原生 button 自带
                    Enter/空格语义；chevron 随 aria-expanded 旋转指示方向。 */}
                <button
                  type="button"
                  className="section-label completed-toggle"
                  aria-expanded={completedExpanded}
                  aria-controls="completed-task-list"
                  onClick={() => setCompletedExpanded((value) => !value)}
                >
                  <ChevronRight size={12} className="completed-chevron" aria-hidden="true" />
                  <span className="completed-toggle-label">
                    {t('views.completedToggle', { count: completed.length })}
                  </span>
                </button>
                {/* 容器常驻（aria-controls 始终有落点），行随展开态条件挂载：
                    收起即卸载而非视觉隐藏，展开态下单行进出仍走 AnimatePresence。 */}
                <div className="task-list" id="completed-task-list" hidden={!completedExpanded}>
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
        )}

        <div className="view-footer">
          <span>
            <kbd>{displayKeys(quickAddKeys)}</kbd> {t('views.footer.newTask')}
          </span>
          <span>
            <kbd>{displayKeys(paletteKeys)}</kbd> {t('views.footer.palette')}
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
            confirmLabel={
              trashConfirm.kind === 'empty' ? t('views.emptyLabel') : t('views.purgeLabel')
            }
            onConfirm={runConfirm}
            onClose={() => setTrashConfirm(null)}
          />
        )}
      </AnimatePresence>
    </main>
  )
}