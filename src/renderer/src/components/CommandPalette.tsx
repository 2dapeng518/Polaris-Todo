import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  FolderPlus,
  ListTodo,
  Moon,
  Plus,
  Search,
  Sun
} from 'lucide-react'
import type { AppView } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useThemeStore } from '../stores/useThemeStore'
import { THEME_META, THEME_ORDER, partnerTheme, themeFamily } from '@shared/themes'
import { formatDue } from '../lib/dates'
import { useFocusTrap } from '../lib/useFocusTrap'

type CommandItem = {
  kind: 'command'
  id: string
  label: string
  hint?: string
  icon: typeof Plus
  run: () => void
}

type TaskItem = {
  kind: 'task'
  id: string
  label: string
  subtitle: string
  completed: boolean
  color?: string
  run: () => void
}

type PaletteItem = CommandItem | TaskItem

export function CommandPalette() {
  const open = useTaskStore((state) => state.paletteOpen)
  const setOpen = useTaskStore((state) => state.setPaletteOpen)
  const tasks = useTaskStore((state) => state.tasks)
  const projects = useTaskStore((state) => state.projects)
  const setView = useTaskStore((state) => state.setView)
  const selectTask = useTaskStore((state) => state.selectTask)
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useFocusTrap(panelRef, open, inputRef)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
  }, [open])

  const commands = useMemo<CommandItem[]>(() => {
    const close = () => setOpen(false)
    const go = (view: AppView) => () => {
      setView(view)
      close()
    }
    const nextTheme = partnerTheme(theme)

    return [
      {
        kind: 'command',
        id: 'new-task',
        label: '新建任务',
        hint: 'N',
        icon: Plus,
        run: () => {
          close()
          window.dispatchEvent(new CustomEvent('polaris:quick-add'))
        }
      },
      {
        kind: 'command',
        id: 'new-project',
        label: '新建项目',
        icon: FolderPlus,
        run: () => {
          close()
          window.dispatchEvent(new CustomEvent('polaris:new-project'))
        }
      },
      {
        kind: 'command',
        id: 'toggle-theme',
        label: `切换到 ${THEME_META[nextTheme].label}`,
        icon: themeFamily(theme) === 'dark' ? Moon : Sun,
        run: () => {
          toggleTheme()
          close()
        }
      },
      // 六条直达：配对快切只够到两套，键盘用户要能在 Ctrl K 里枚举全部六套。
      ...THEME_ORDER.map((id) => ({
        kind: 'command' as const,
        id: `theme-${id}`,
        label: `主题：${THEME_META[id].label}`,
        hint: theme === id ? '当前' : undefined,
        icon: THEME_META[id].family === 'dark' ? Moon : Sun,
        run: () => {
          setTheme(id)
          close()
        }
      })),
      { kind: 'command', id: 'view-today', label: '今天', icon: Sun, run: go('today') },
      {
        kind: 'command',
        id: 'view-upcoming',
        label: '即将到来',
        icon: CalendarDays,
        run: go('upcoming')
      },
      { kind: 'command', id: 'view-all', label: '全部任务', icon: ListTodo, run: go('all') },
      {
        kind: 'command',
        id: 'view-completed',
        label: '已完成',
        icon: CheckCircle2,
        run: go('completed')
      }
    ]
  }, [setOpen, setView, theme, toggleTheme, setTheme])

  const items = useMemo<PaletteItem[]>(() => {
    const normalized = query.trim().toLowerCase()
    const close = () => setOpen(false)

    const matchedCommands = normalized
      ? commands.filter((command) => command.label.toLowerCase().includes(normalized))
      : commands

    const matchedTasks: TaskItem[] = normalized
      ? tasks
          .filter((task) => task.title.toLowerCase().includes(normalized))
          .slice(0, 8)
          .map((task) => {
            const project = task.projectId
              ? projects.find((candidate) => candidate.id === task.projectId)
              : undefined
            return {
              kind: 'task',
              id: task.id,
              label: task.title,
              subtitle: `${formatDue(task.dueAt)}${project ? ` · ${project.name}` : ''}`,
              completed: task.completed,
              color: project?.color,
              run: () => {
                selectTask(task.id)
                close()
              }
            }
          })
      : []

    return [...matchedCommands, ...matchedTasks]
  }, [query, commands, tasks, projects, selectTask, setOpen])

  const active = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1)
  const firstTaskIndex = items.findIndex((item) => item.kind === 'task')

  useEffect(() => {
    if (!open || active < 0) return
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) =>
        items.length === 0 ? 0 : (Math.min(index, items.length - 1) + 1) % items.length
      )
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        items.length === 0 ? 0 : (Math.max(index, 0) - 1 + items.length) % items.length
      )
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      items[active]?.run()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="command-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={() => setOpen(false)}
        >
          <motion.div
            className="command-panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="command-input-row">
              <Search size={17} strokeWidth={1.8} aria-hidden="true" />
              <input
                ref={inputRef}
                className="command-input"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                name="command-search"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={onKeyDown}
                placeholder="搜索任务，或输入命令…"
                aria-label="命令面板"
              />
              <kbd>Esc</kbd>
            </div>

            <div className="command-list" ref={listRef}>
              {items.length === 0 && <div className="command-empty">没有匹配结果</div>}
              {items.map((item, index) => {
                const Icon =
                  item.kind === 'command'
                    ? item.icon
                    : item.completed
                      ? CheckCircle2
                      : Circle
                return (
                  <div key={`${item.kind}-${item.id}`}>
                    {index === 0 && item.kind === 'command' && (
                      <div className="command-section">操作</div>
                    )}
                    {index === firstTaskIndex && <div className="command-section">任务</div>}
                    <button
                      data-index={index}
                      className={`command-item ${index === active ? 'active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={item.run}
                    >
                      <span
                        className={`command-icon ${item.kind}`}
                        style={
                          item.kind === 'task' && item.color ? { color: item.color } : undefined
                        }
                      >
                        <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <span className="command-main">
                        <span className="command-title">{item.label}</span>
                        {item.kind === 'task' && (
                          <span className="command-subtitle">{item.subtitle}</span>
                        )}
                      </span>
                      {item.kind === 'command' && item.hint && <kbd>{item.hint}</kbd>}
                      {item.kind === 'task' && <span className="command-enter">↵</span>}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="command-footer">
              <span>
                <kbd>↑↓</kbd> 选择
              </span>
              <span>
                <kbd>↵</kbd> 打开
              </span>
              <span>
                <kbd>Esc</kbd> 关闭
              </span>
              <span className="command-brand">Polaris</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}