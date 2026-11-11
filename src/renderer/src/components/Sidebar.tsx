import { useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, CheckCircle2, ListTodo, Plus, Settings2, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import type { AppView } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { isTodayOrOverdue, isUpcoming } from '../lib/dates'
import { SettingsPanel } from './SettingsPanel'

const NAV_ITEMS: Array<{ view: AppView; label: string; icon: typeof Sun }> = [
  { view: 'today', label: '今天', icon: Sun },
  { view: 'upcoming', label: '即将到来', icon: CalendarDays },
  { view: 'all', label: '全部任务', icon: ListTodo },
  { view: 'completed', label: '已完成', icon: CheckCircle2 }
]

const PROJECT_COLORS = ['#5EEAD4', '#A78BFA', '#F0ABFC', '#FBBF24', '#FB7185', '#60A5FA']

export function Sidebar() {
  const tasks = useTaskStore((state) => state.tasks)
  const projects = useTaskStore((state) => state.projects)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)
  const setView = useTaskStore((state) => state.setView)
  const setProjectFilter = useTaskStore((state) => state.setProjectFilter)
  const createProject = useTaskStore((state) => state.createProject)

  const [addingProject, setAddingProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0])
  const [settingsOpen, setSettingsOpen] = useState(false)

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
    completed: tasks.filter((task) => task.completed).length
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

  return (
    <aside className="sidebar">
      <nav className="nav-section" aria-label="视图">
        <div className="nav-label">视图</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.view && !projectFilter
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
              <span className="nav-count">{counts[item.view]}</span>
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
          return (
            <button
              key={project.id}
              className={`nav-item project-item ${active ? 'active' : ''}`}
              onClick={() => setProjectFilter(project.id)}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="nav-active-bg"
                  transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                />
              )}
              <span
                className="project-dot"
                style={{
                background: project.color,
                boxShadow: '0 0 0 1px var(--line-strong)'
              }}
              />
              <span className="nav-text">{project.name}</span>
              <span className="nav-count">{count}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-status">
        <span className="status-dot" />
        <div>
          <div className="status-title">数据保存在本机</div>
          <div className="status-subtitle">SQLite · 自动保存</div>
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
    </aside>
  )
}