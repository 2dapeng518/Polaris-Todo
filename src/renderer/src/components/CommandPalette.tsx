import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Grid2x2,
  Circle,
  FolderPlus,
  ListTodo,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2
} from './Icon'
import type { AppView } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useLocale, useT } from '../stores/useLocaleStore'
import { THEME_META, THEME_ORDER, partnerTheme, themeFamily } from '@shared/themes'
import { themeLabel } from '@shared/i18n'
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

// 选项 id 用 kind+id 而非索引：搜索词变化时列表会增删，索引会漂移，
// aria-activedescendant 指向的节点必须稳定。id 都是 UUID/固定命令名，可安全入 DOM。
function optionId(item: PaletteItem): string {
  return `command-option-${item.kind}-${item.id}`
}

export function CommandPalette() {
  const t = useT()
  const locale = useLocale()
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
        label: t('palette.newTask'),
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
        label: t('palette.newProject'),
        icon: FolderPlus,
        run: () => {
          close()
          window.dispatchEvent(new CustomEvent('polaris:new-project'))
        }
      },
      {
        kind: 'command',
        id: 'toggle-theme',
        label: t('palette.switchTheme', { theme: themeLabel(locale, nextTheme) }),
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
        label: t('palette.theme', { theme: themeLabel(locale, id) }),
        hint: theme === id ? t('palette.current') : undefined,
        icon: THEME_META[id].family === 'dark' ? Moon : Sun,
        run: () => {
          setTheme(id)
          close()
        }
      })),
      /* 视图命令与侧栏同序：时间轴→任务轴→回顾→系统。 */
      { kind: 'command', id: 'view-today', label: t('nav.view.today'), icon: Sun, run: go('today') },
      {
        kind: 'command',
        id: 'view-upcoming',
        label: t('nav.view.upcoming'),
        icon: CalendarClock,
        run: go('upcoming')
      },
      { kind: 'command', id: 'view-calendar', label: t('nav.view.calendar'), icon: CalendarDays, run: go('calendar') },
      { kind: 'command', id: 'view-matrix', label: t('nav.view.matrix'), icon: Grid2x2, run: go('matrix') },
      { kind: 'command', id: 'view-all', label: t('nav.view.all'), icon: ListTodo, run: go('all') },
      {
        kind: 'command',
        id: 'view-completed',
        label: t('nav.view.completed'),
        icon: CheckCircle2,
        run: go('completed')
      },
      { kind: 'command', id: 'view-stats', label: t('nav.view.stats'), icon: BarChart3, run: go('stats') },
      { kind: 'command', id: 'view-trash', label: t('nav.view.trash'), icon: Trash2, run: go('trash') }
    ]
  }, [setOpen, setView, theme, toggleTheme, setTheme, t, locale])

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
              subtitle: `${formatDue(task.dueAt, locale)}${project ? ` · ${project.name}` : ''}`,
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
  }, [query, commands, tasks, projects, selectTask, setOpen, locale])

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
  }

  // Esc 挂在面板容器而非仅搜索框：Tab 把焦点移到命令按钮后仍能关闭面板。
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
            aria-label={t('palette.title')}
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={onPanelKeyDown}
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
                placeholder={t('palette.placeholder')}
                aria-label={t('palette.title')}
                // combobox 语义照 LanguageSelect 的 listbox 模式：焦点留在输入框，
                // 方向键高亮通过 aria-activedescendant 播报，而不是移动 DOM 焦点。
                role="combobox"
                aria-expanded={open}
                aria-controls="command-palette-list"
                aria-autocomplete="list"
                aria-activedescendant={active >= 0 ? optionId(items[active]) : undefined}
              />
              <kbd>Esc</kbd>
            </div>

            <div
              className="command-list"
              ref={listRef}
              role="listbox"
              id="command-palette-list"
              aria-label={t('palette.title')}
            >
              {items.length === 0 && (
                <div className="command-empty" role="presentation">{t('palette.empty')}</div>
              )}
              {items.map((item, index) => {
                const Icon =
                  item.kind === 'command'
                    ? item.icon
                    : item.completed
                      ? CheckCircle2
                      : Circle
                return (
                  // 包装层与分组标题用 presentation：listbox 的 owned 元素必须是
                  // option，去掉中间层语义（文本内容仍会被读屏读到）。
                  <div key={`${item.kind}-${item.id}`} role="presentation">
                    {index === 0 && item.kind === 'command' && (
                      <div className="command-section" role="presentation">{t('palette.actions')}</div>
                    )}
                    {index === firstTaskIndex && (
                      <div className="command-section" role="presentation">{t('palette.tasks')}</div>
                    )}
                    <button
                      data-index={index}
                      id={optionId(item)}
                      role="option"
                      aria-selected={index === active}
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
                <kbd>↑↓</kbd> {t('palette.select')}
              </span>
              <span>
                <kbd>↵</kbd> {t('palette.open')}
              </span>
              <span>
                <kbd>Esc</kbd> {t('palette.close')}
              </span>
              <span className="command-brand">Polaris</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}