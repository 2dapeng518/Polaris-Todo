import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Grid2x2,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings2,
  Sun,
  Tag,
  Trash2
} from './Icon'
import { AnimatePresence, motion } from 'motion/react'
import type { AppView, Project } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { useTaskStore } from '../stores/useTaskStore'
import { useT } from '../stores/useLocaleStore'
import { isTodayOrOverdue, isUpcoming } from '../lib/dates'
import { useSidebarStore } from '../stores/useSidebarStore'
import { ConfirmDialog } from './ConfirmDialog'

/* 排序即工作流：时间轴（现在→接下来→俯瞰）→ 任务轴（分轻重→全集→归档）
   → 回顾（统计）→ 系统（回收站）。divider 把干活的与回顾的视觉分组。 */
const NAV_ITEMS: Array<{ view: AppView; label: MessageKey; icon: typeof Sun; divider?: boolean }> = [
  { view: 'today', label: 'nav.view.today', icon: Sun },
  { view: 'upcoming', label: 'nav.view.upcoming', icon: CalendarClock },
  { view: 'calendar', label: 'nav.view.calendar', icon: CalendarDays },
  { view: 'matrix', label: 'nav.view.matrix', icon: Grid2x2 },
  { view: 'all', label: 'nav.view.all', icon: ListTodo },
  { view: 'completed', label: 'nav.view.completed', icon: CheckCircle2 },
  { view: 'stats', label: 'nav.view.stats', icon: BarChart3, divider: true },
  { view: 'trash', label: 'nav.view.trash', icon: Trash2 }
]

const PROJECT_COLORS = ['#5EEAD4', '#A78BFA', '#F0ABFC', '#FBBF24', '#FB7185', '#60A5FA']

export function Sidebar() {
  const t = useT()
  const tasks = useTaskStore((state) => state.tasks)
  const trashedTasks = useTaskStore((state) => state.trashedTasks)
  const projects = useTaskStore((state) => state.projects)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)
  const setView = useTaskStore((state) => state.setView)
  const setProjectFilter = useTaskStore((state) => state.setProjectFilter)
  const tags = useTaskStore((state) => state.tags)
  const tagFilter = useTaskStore((state) => state.tagFilter)
  const setTagFilter = useTaskStore((state) => state.setTagFilter)
  const removeTag = useTaskStore((state) => state.removeTag)
  const createProject = useTaskStore((state) => state.createProject)
  const updateProject = useTaskStore((state) => state.updateProject)
  const deleteProject = useTaskStore((state) => state.deleteProject)

  const [addingProject, setAddingProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0])
  // 侧栏收起态：只剩图标，横向空间让给任务区（默认展开，选择记在 localStorage）。
  const collapsed = useSidebarStore((state) => state.collapsed)
  const setCollapsed = useSidebarStore((state) => state.setCollapsed)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(PROJECT_COLORS[0])
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)

  useEffect(() => {
    const openProjectForm = () => {
      // 收起态放不下项目表单：先展开侧栏再开表单。
      if (useSidebarStore.getState().collapsed) useSidebarStore.getState().setCollapsed(false)
      setAddingProject(true)
    }
    // 设置与关于住在独立的设置窗口里（主进程单例窗口，app:open-settings）：
    // 侧栏按钮与托盘「设置」开的是同一扇，这里不再有面板态需要同步。
    window.addEventListener('polaris:new-project', openProjectForm)
    return () => window.removeEventListener('polaris:new-project', openProjectForm)
  }, [])

  // 设置：独立的设置窗口（主窗口的子窗口）。「关于」不再放侧栏——版本/许可/
  // 检查更新只保留设置窗口内的唯一入口（2026-11-26 拍板，消除重复入口）。
  const openSettings = () => void window.polaris.app.openSettings()

  // 计数只在 tasks/trashedTasks 变化时重算：侧栏每次渲染（切视图、开设置、
  // 编辑项目表单的每次击键）都跑 8 次全表 filter 是白烧 CPU。
  const activeTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks])
  const counts = useMemo<Record<AppView, number>>(() => {
    const completedCount = tasks.length - activeTasks.length
    return {
      today: activeTasks.filter((task) => isTodayOrOverdue(task.dueAt)).length,
      upcoming: activeTasks.filter((task) => isUpcoming(task.dueAt)).length,
      calendar: activeTasks.filter((task) => task.dueAt).length,
      all: activeTasks.length,
      completed: completedCount,
      stats: completedCount,
      matrix: activeTasks.length,
      trash: trashedTasks.length
    }
  }, [tasks, activeTasks, trashedTasks])

  // 项目/标签计数各一趟遍历建 Map：原来是每个项目、每个标签各扫一遍全表，
  // 标签计数是 O(tags×tasks)，任务多时侧栏渲染被拖慢。
  const projectCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of activeTasks) {
      if (task.projectId) map.set(task.projectId, (map.get(task.projectId) ?? 0) + 1)
    }
    return map
  }, [activeTasks])
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of activeTasks) {
      for (const tag of task.tags) map.set(tag.id, (map.get(tag.id) ?? 0) + 1)
    }
    return map
  }, [activeTasks])

  const submitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) return

    try {
      const project = await createProject(name, projectColor)
      setProjectFilter(project.id)
      setProjectName('')
      setProjectColor(PROJECT_COLORS[0])
      setAddingProject(false)
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  const beginEdit = (project: Project) => {
    // 收起态放不下项目表单：先展开侧栏再开表单。
    if (collapsed) setCollapsed(false)
    setEditingProject(project)
    setEditName(project.name)
    setEditColor(project.color)
  }

  const cancelEdit = () => {
    setEditingProject(null)
    setEditName('')
  }

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingProject) return
    const name = editName.trim()
    if (!name) return
    try {
      await updateProject(editingProject.id, { name, color: editColor })
      setEditingProject(null)
      setEditName('')
    } catch (error) {
      console.error('Failed to update project:', error)
    }
  }

  const confirmDelete = async () => {
    if (!deletingProject) return
    const id = deletingProject.id
    setDeletingProject(null)
    try {
      await deleteProject(id)
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
      <nav className="nav-section" aria-label={t('nav.views')}>
        <div className="nav-label">
          <span className="nav-label-text">{t('nav.views')}</span>
          {/* 侧栏收起开关：贴在「视图」标签行右端；收起后这一行只剩它自己，居中。 */}
          <button
            className="sidebar-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen size={14} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={14} aria-hidden="true" />
            )}
          </button>
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.view && !projectFilter && !tagFilter
          return (
            <Fragment key={item.view}>
            {item.divider && <div className="nav-divider" role="separator" aria-hidden="true" />}
            <button
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => setView(item.view)}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? t(item.label) : undefined}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="nav-active-bg"
                  transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                />
              )}
              <Icon size={16} strokeWidth={1.8} className="nav-icon" aria-hidden="true" />
              <span className="nav-text">{t(item.label)}</span>
              {/* 统计与四象限不是任务列表：数字分别与「已完成」「全部任务」相同，并排显示一样的角标只会让人以为重复了。 */}
              {item.view !== 'stats' && item.view !== 'matrix' && <span className="nav-count">{counts[item.view]}</span>}
            </button>
            </Fragment>
          )
        })}
      </nav>

      <nav className="nav-section projects-section" aria-label={t('nav.projects')}>
        <div className="nav-label">
          <span className="nav-label-text">{t('nav.projects')}</span>
          <span className="nav-label-count">{projects.length}</span>
          <button
            className="project-add"
            onClick={() => {
              // 收起态放不下项目表单：点「+」先把侧栏展开再开表单。
              if (collapsed && !addingProject) setCollapsed(false)
              setAddingProject((value) => !value)
            }}
            aria-label={t('nav.newProject')}
            title={t('nav.newProject')}
          >
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {addingProject && (
          <form className="project-form" onSubmit={submitProject}>
            <input
              autoFocus
              name="project-name"
              autoComplete="off"
              spellCheck={false}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setAddingProject(false)
                  setProjectName('')
                }
              }}
              placeholder={t('nav.projectName')}
              maxLength={40}
              aria-label={t('nav.projectName')}
            />
            <div className="color-swatches">
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${projectColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setProjectColor(color)}
                  aria-label={t('nav.selectColor', { color })}
                />
              ))}
            </div>
            <div className="project-form-actions">
              <button
                type="button"
                onClick={() => {
                  setAddingProject(false)
                  setProjectName('')
                }}
              >
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={!projectName.trim()}>
                {t('common.add')}
              </button>
            </div>
          </form>
        )}

        {projects.map((project) => {
          const count = projectCounts.get(project.id) ?? 0
          const active = projectFilter === project.id

          if (editingProject?.id === project.id) {
            return (
              <form key={project.id} className="project-form" onSubmit={submitEdit}>
                <input
                  autoFocus
                  name="edit-project-name"
                  autoComplete="off"
                  spellCheck={false}
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      cancelEdit()
                    }
                  }}
                  placeholder={t('nav.projectName')}
                  maxLength={40}
                  aria-label={t('nav.projectName')}
                />
                <div className="color-swatches">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-swatch ${editColor === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => setEditColor(color)}
                      aria-label={t('nav.selectColor', { color })}
                    />
                  ))}
                </div>
                <div className="project-form-actions">
                  <button type="button" onClick={cancelEdit}>
                    {t('common.cancel')}
                  </button>
                  <button type="submit" disabled={!editName.trim()}>
                    {t('common.save')}
                  </button>
                </div>
              </form>
            )
          }

          return (
            <div
              key={project.id}
              className={`nav-item project-item ${active ? 'active' : ''}`}
              title={collapsed ? project.name : undefined}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="nav-active-bg"
                  transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                />
              )}
              <button
                className="project-select"
                onClick={() => setProjectFilter(project.id)}
                aria-pressed={active}
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span className="nav-text">{project.name}</span>
                <span className="nav-count">{count}</span>
              </button>
              <div className="project-actions">
                <button
                  className="project-action"
                  aria-label={t('nav.editProjectNamed', { name: project.name })}
                  title={t('nav.editProject')}
                  onClick={() => beginEdit(project)}
                >
                  <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button
                  className="project-action project-action-danger"
                  aria-label={t('nav.deleteProjectNamed', { name: project.name })}
                  title={t('nav.deleteProject')}
                  onClick={() => setDeletingProject(project)}
                >
                  <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>
          )
        })}
      </nav>

      {tags.length > 0 && (
        <nav className="nav-section tags-section" aria-label={t('nav.tags')}>
          <div className="nav-label">
            <span className="nav-label-text">{t('nav.tags')}</span>
            <span className="nav-label-count">{tags.length}</span>
          </div>
          {tags.map((tag) => {
            const count = tagCounts.get(tag.id) ?? 0
            const active = tagFilter === tag.id
            return (
              <div key={tag.id} className={`nav-item project-item tag-item ${active ? 'active' : ''}`}>
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="nav-active-bg"
                    transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                  />
                )}
                <button
                  className="project-select"
                  onClick={() => setTagFilter(tag.id)}
                  aria-pressed={active}
                >
                  <Tag size={13} strokeWidth={1.8} className="tag-nav-icon" aria-hidden="true" />
                  {/* 收起态用标签首字代替图标（多个标签才分得清）；展开态不显示。 */}
                  <span className="tag-initial" aria-hidden="true">
                    {tag.name.trim().charAt(0)}
                  </span>
                  <span className="nav-text">{tag.name}</span>
                  <span className="nav-count">{count}</span>
                </button>
                <div className="project-actions">
                  <button
                    className="project-action project-action-danger"
                    aria-label={t('nav.deleteTagNamed', { name: tag.name })}
                    title={t('nav.deleteTagNamed', { name: tag.name })}
                    onClick={() => void removeTag(tag.id)}
                  >
                    <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )
          })}
        </nav>
      )}

      <div className="sidebar-spacer" />
      </div>

      {/* 底部固定入口：设置（收起态只剩图标，文字进 title 提示）。「关于」只在
          设置窗口的导航里——版本/许可/检查更新的唯一入口。 */}
      <div className="sidebar-foot">
        <button
          className="nav-item settings-item"
          title={collapsed ? t('common.settings') : undefined}
          onClick={openSettings}
        >
          <Settings2 size={16} strokeWidth={1.8} className="nav-icon" aria-hidden="true" />
          <span className="nav-text">{t('common.settings')}</span>
        </button>
      </div>

      <AnimatePresence>
        {deletingProject && (
          <ConfirmDialog
            message={t('nav.deleteProjectConfirm', { name: deletingProject.name })}
            confirmLabel={t('nav.deleteProject')}
            onConfirm={confirmDelete}
            onClose={() => setDeletingProject(null)}
          />
        )}
      </AnimatePresence>
    </aside>
  )
}