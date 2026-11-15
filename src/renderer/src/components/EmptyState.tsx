import type { AppView } from '@shared/types'
import { TRASH_RETENTION_DAYS } from '@shared/retention'
import { useTaskStore } from '../stores/useTaskStore'
import { PolarisMark } from './PolarisMark'

export function EmptyState({ view }: { view: AppView }) {
  const setView = useTaskStore((state) => state.setView)
  const message =
    view === 'trash'
      ? {
          title: '回收站是空的',
          desc: `删除的任务会在这里保留 ${TRASH_RETENTION_DAYS} 天`
        }
      : view === 'completed'
        ? {
            title: '还没有完成的任务',
            desc: '完成一项任务后，它会出现在这里'
          }
        : view === 'upcoming'
          ? {
              title: '未来几天很清爽',
              desc: '按 N 添加一项带日期的任务'
            }
          : view === 'all'
            ? {
                title: '还没有任务',
                desc: '按 N 或点击上方输入框，添加第一件事'
              }
            : {
                title: '今天还没有任务',
                desc: '按 N 或点击上方输入框，添加第一件事'
              }

  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <div className="empty-orbit-ring" />
        <PolarisMark size={34} />
      </div>
      <div className="empty-title">{message.title}</div>
      <div className="empty-desc">{message.desc}</div>
      {view === 'completed' ? (
        <button className="empty-cta" onClick={() => setView('today')}>
          查看今天
        </button>
      ) : view !== 'trash' ? (
        <button
          className="empty-cta"
          onClick={() => window.dispatchEvent(new CustomEvent('polaris:quick-add'))}
        >
          添加任务
        </button>
      ) : null}
    </div>
  )
}