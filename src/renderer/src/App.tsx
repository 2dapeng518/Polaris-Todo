import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { CommandPalette } from './components/CommandPalette'
import { Sidebar } from './components/Sidebar'
import { TaskDetail } from './components/TaskDetail'
import { TaskView } from './components/TaskView'
import { ThemeSync } from './components/ThemeSync'
import { TitleBar } from './components/TitleBar'
import { UndoToast } from './components/UndoToast'
import { UpdateDialog } from './components/UpdateDialog'
import { useTaskStore } from './stores/useTaskStore'
import { subscribeUpdateStore } from './stores/useUpdateStore'

export default function App() {
  const load = useTaskStore((state) => state.load)
  const loadTrash = useTaskStore((state) => state.loadTrash)
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

  useEffect(() => {
    const onFocus = () => {
      void load()
      void loadTrash()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, loadTrash])

  // 更新状态订阅只挂主窗口：提醒窗口不该弹更新框。
  useEffect(() => subscribeUpdateStore(), [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <ThemeSync />
        <a className="skip-link" href="#main-content">
          跳到主内容
        </a>
        <TitleBar />
        {loading ? (
          <div className="app-loading">
            <div className="loading-star" />
            <span>正在载入 Polaris…</span>
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