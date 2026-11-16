import type { AppView } from '@shared/types'
import { TRASH_RETENTION_DAYS } from '@shared/retention'
import { useTaskStore } from '../stores/useTaskStore'
import { PolarisMark } from './PolarisMark'

// 每个视图一条文案：Record<AppView, …> 让新增视图漏写文案时 typecheck 直接报错。
const MESSAGES: Record<AppView, { title: string; desc: string }> = {
  today: {
    title: '今天还没有任务',
    desc: '按 N 或点击上方输入框，添加第一件事'
  },
  upcoming: {
    title: '未来几天很清爽',
    desc: '按 N 添加一项带日期的任务'
  },
  all: {
    title: '还没有任务',
    desc: '按 N 或点击上方输入框，添加第一件事'
  },
  completed: {
    title: '还没有完成的任务',
    desc: '完成一项任务后，它会出现在这里'
  },
  stats: {
    title: '还没有完成记录',
    desc: '完成一项任务后，这里会记录你的节奏'
  },
  trash: {
    title: '回收站是空的',
    desc: `删除的任务会在这里保留 ${TRASH_RETENTION_DAYS} 天`
  }
}

export function EmptyState({ view }: { view: AppView }) {
  const setView = useTaskStore((state) => state.setView)
  const message = MESSAGES[view]

  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <div className="empty-orbit-ring" />
        <PolarisMark size={34} />
      </div>
      <div className="empty-title">{message.title}</div>
      <div className="empty-desc">{message.desc}</div>
      {view === 'completed' || view === 'stats' ? (
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