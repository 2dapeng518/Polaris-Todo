import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { CommandPalette } from './components/CommandPalette'
import { Sidebar } from './components/Sidebar'
import { TaskDetail } from './components/TaskDetail'
import { TaskView } from './components/TaskView'
import { ThemeSync } from './components/ThemeSync'
import { LocaleSync } from './components/LocaleSync'
import { TitleBar } from './components/TitleBar'
import { UndoToast } from './components/UndoToast'
import { UpdateDialog } from './components/UpdateDialog'
import { useTaskStore } from './stores/useTaskStore'
import { useShortcutsStore } from './stores/useShortcutsStore'
import { APP_SHORTCUTS } from '@shared/shortcuts'
import { eventMatchesKeys } from './lib/shortcuts'
import { useSidebarStore } from './stores/useSidebarStore'
import { useT } from './stores/useLocaleStore'
import { subscribeUpdateStore } from './stores/useUpdateStore'

export default function App() {
  const t = useT()
  const load = useTaskStore((state) => state.load)
  const loadTrash = useTaskStore((state) => state.loadTrash)
  const refreshOnFocus = useTaskStore((state) => state.refreshOnFocus)
  const loading = useTaskStore((state) => state.loading)
  const inspectorOpen = useTaskStore((state) =>
    state.tasks.some((task) => task.id === state.selectedTaskId)
  )
  // 侧栏收起态落在 app-body 上：网格首列的宽度变量与侧栏内文字的显隐都挂在它下面。
  const sidebarCollapsed = useSidebarStore((state) => state.collapsed)
  const shortcutOverrides = useShortcutsStore((state) => state.overrides)
  const loadShortcuts = useShortcutsStore((state) => state.load)
  const setView = useTaskStore((state) => state.setView)

  // trash 拉取只挂在主窗口（App）上：提醒窗口走 ReminderView 自己的 load()，
  // 不经过这里，所以弹窗不会触发 list-deleted 附带的 purge 写操作。
  useEffect(() => {
    void load()
    void loadTrash()
    void loadShortcuts()
  }, [load, loadTrash, loadShortcuts])

  // focus 刷新走修订号门控（迁移 7 触发器 + data:revision 探针）：号没变就
  // 跳过全量重拉，频繁 alt-tab 不再让 tasks 数组整体换引用、全员重渲染。
  // 号变了（含 MCP/导入等外部写入）仍全量 load()+loadTrash()，可见性不降级。
  useEffect(() => {
    const onFocus = () => {
      void refreshOnFocus()
      // 设置窗口改完快捷键回到主窗口即生效：focus 时重拉绑定（同 revision 门思路）。
      void loadShortcuts()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshOnFocus])

  // 更新状态订阅只挂主窗口：提醒窗口不该弹更新框。
  useEffect(() => subscribeUpdateStore(), [])

  // 视图导航快捷键：注册表里带 view 的项（默认 1-8）。输入态与模态期间让位；
  // 绑定变化（overrides）即重挂监听。setView 自身清选中，切视图顺带收起检查器。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // target 可能是 window（合成事件）——只有元素才查 closest，避免对非元素抛错。
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return
      const { paletteOpen, trashConfirm } = useTaskStore.getState()
      if (paletteOpen || trashConfirm) return
      for (const def of APP_SHORTCUTS) {
        if (!def.view) continue
        const keys = shortcutOverrides[def.id] ?? def.defaultKeys
        if (eventMatchesKeys(event, keys)) {
          event.preventDefault()
          setView(def.view)
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutOverrides, setView])

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <ThemeSync />
        <LocaleSync />
        <a className="skip-link" href="#main-content">
          {t('app.skip')}
        </a>
        <TitleBar />
        {loading ? (
          <div className="app-loading">
            <div className="loading-star" />
            <span>{t('app.loading')}</span>
          </div>
        ) : (
          <div
            className={`app-body${inspectorOpen ? ' has-inspector' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
          >
            <Sidebar />
            <TaskView />
            <TaskDetail />
          </div>
        )}
        <CommandPalette />
        <UndoToast />
        <UpdateDialog />
      </div>
    </MotionConfig>
  )
}