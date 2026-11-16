import { useEffect, useState, type FormEvent } from 'react'
import { BarChart3, CalendarDays, CheckCircle2, Grid2x2, HardDrive, ListTodo, Pencil, Plus, Settings2, Sun, Tag, Trash2 } from './Icon'
import { AnimatePresence, motion } from 'motion/react'
import type { AppView, Project } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { isTodayOrOverdue, isUpcoming } from '../lib/dates'
import { SettingsPanel } from './SettingsPanel'
import { ConfirmDialog } from './ConfirmDialog'

const NAV_ITEMS: Array<{ view: AppView; label: string; icon: typeof Sun }> = [
  { view: 'today', label: '今天', icon: Sun },
  { view: 'upcoming', label: '即将到来', icon: CalendarDays },
  { view: 'all', label: '全部任务', icon: ListTodo },
  { view: 'completed', label: '已完成', icon: CheckCircle2 },
  { view: 'stats', label: '统计', icon: BarChart3 },
  { view: 'matrix', label: '四象限', icon: Grid2x2 },
  { view: 'trash', label: '回收站', icon: Trash2 }
]

const PROJECT_COLORS = ['#5EEAD4', '#A78BFA', '#F0ABFC', '#FBBF24', '#FB7185', '#60A5FA']

export function Sidebar() {
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(PROJECT_COLORS[0])
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)

  useEffect(() => {
    const openProjectForm = () => setAddingProject(true)
    window.addEventListener('polaris:new-project', openProjectForm)
    return () => window.removeEventListener('polaris:new-project', openProjectForm)
  }, [])

  const activeTasks = tasks.filter((task) => !task.completed)
  const counts: Record<AppView, number> = {
    today: activeTasks.filter((task) => isTodayOrOverdue(task.dueAt)).length,
    upcoming: activeTasks.filter((task) => isUpcoming(task.dueAt)).length,
    all: activeTasks.length,
    completed: tasks.filter((task) => task.completed).length,
    stats: tasks.filter((task) => task.completed).length,
    matrix: activeTasks.length,
    trash: trashedTasks.length
  }

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
      <nav className="nav-section" aria-label="视图">
        <div className="nav-label">视图</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.view && !projectFilter && !tagFilter
          return (
            <button
              key={item.view}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => setView(item.view)}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="nav-active-bg"
                  transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                />
              )}
              <Icon size={16} strokeWidth={1.8} className="nav-icon" aria-hidden="true" />
              <span className="nav-text">{item.label}</span>
              {/* 统计与四象限不是任务列表：数字分别与「已完成」「全部任务」相同，并排显示一样的角标只会让人以为重复了。 */}
              {item.view !== 'stats' && item.view !== 'matrix' && <span className="nav-count">{counts[item.view]}</span>}
            </button>
          )
        })}
      </nav>

      <nav className="nav-section projects-section" aria-label="项目">
        <div className="nav-label">
          <span>项目</span>
          <span className="nav-label-count">{projects.length}</span>
          <button
            className="project-add"
            onClick={() => setAddingProject((value) => !value)}
            aria-label="新建项目"
            title="新建项目"
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
              placeholder="项目名称"
              maxLength={40}
              aria-label="项目名称"
            />
            <div className="color-swatches">
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${projectColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setProjectColor(color)}
                  aria-label={`选择颜色 ${color}`}
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
                取消
              </button>
              <button type="submit" disabled={!projectName.trim()}>
                添加
              </button>
            </div>
          </form>
        )}

        {projects.map((project) => {
          const count = activeTasks.filter((task) => task.projectId === project.id).length
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
                  placeholder="项目名称"
                  maxLength={40}
                  aria-label="项目名称"
                />
                <div className="color-swatches">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-swatch ${editColor === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => setEditColor(color)}
                      aria-label={`选择颜色 ${color}`}
                    />
                  ))}
                </div>
                <div className="project-form-actions">
                  <button type="button" onClick={cancelEdit}>
                    取消
                  </button>
                  <button type="submit" disabled={!editName.trim()}>
                    保存
                  </button>
                </div>
              </form>
            )
          }

          return (
            <div key={project.id} className={`nav-item project-item ${active ? 'active' : ''}`}>
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
                  aria-label={`编辑项目 ${project.name}`}
                  title="编辑项目"
                  onClick={() => beginEdit(project)}
                >
                  <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button
                  className="project-action project-action-danger"
                  aria-label={`删除项目 ${project.name}`}
                  title="删除项目"
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
        <nav className="nav-section tags-section" aria-label="标签">
          <div className="nav-label">
            <span>标签</span>
            <span className="nav-label-count">{tags.length}</span>
          </div>
          {tags.map((tag) => {
            const count = activeTasks.filter((task) => task.tags.some((item) => item.id === tag.id)).length
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
                  <span className="nav-text">{tag.name}</span>
                  <span className="nav-count">{count}</span>
                </button>
                <div className="project-actions">
                  <button
                    className="project-action project-action-danger"
                    aria-label={`删除标签 ${tag.name}`}
                    title="删除标签"
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

      <div className="sidebar-storage">
        <HardDrive size={16} strokeWidth={1.8} className="storage-icon" aria-hidden="true" />
        <div>
          <div className="storage-title">数据仅保存在本机</div>
          <div className="storage-subtitle">自动保存</div>
        </div>
      </div>

      <button
        className="nav-item settings-item"
        title="设置"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen(true)}
      >
        <Settings2 size={16} strokeWidth={1.8} className="nav-icon" aria-hidden="true" />
        <span className="nav-text">设置</span>
      </button>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <AnimatePresence>
        {deletingProject && (
          <ConfirmDialog
            message={`删除项目「${deletingProject.name}」？该项目下的任务会移到「无项目」，项目本身无法恢复。`}
            confirmLabel="删除项目"
            onConfirm={confirmDelete}
            onClose={() => setDeletingProject(null)}
          />
        )}
      </AnimatePresence>
    </aside>
  )
}