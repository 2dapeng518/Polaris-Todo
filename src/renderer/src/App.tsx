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

  // trash 拉取只挂在主窗口（App）上：提醒窗口走 ReminderView 自己的 load()，
  // 不经过这里，所以弹窗不会触发 list-deleted 附带的 purge 写操作。
  useEffect(() => {
    void load()
    void loadTrash()
  }, [load, loadTrash])

  // focus 刷新走修订号门控（迁移 7 触发器 + data:revision 探针）：号没变就
  // 跳过全量重拉，频繁 alt-tab 不再让 tasks 数组整体换引用、全员重渲染。
  // 号变了（含 MCP/导入等外部写入）仍全量 load()+loadTrash()，可见性不降级。
  useEffect(() => {
    const onFocus = () => {
      void refreshOnFocus()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshOnFocus])

  // 更新状态订阅只挂主窗口：提醒窗口不该弹更新框。
  useEffect(() => subscribeUpdateStore(), [])

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
          <div className={`app-body${inspectorOpen ? ' has-inspector' : ''}`}>
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