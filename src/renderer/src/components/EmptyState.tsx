import type { AppView } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { TRASH_RETENTION_DAYS } from '@shared/retention'
import { useTaskStore } from '../stores/useTaskStore'
import { useT } from '../stores/useLocaleStore'
import { PolarisMark } from './PolarisMark'

// 每个视图一条文案：Record<AppView, …> 让新增视图漏写文案时 typecheck 直接报错。
const MESSAGES: Record<AppView, { title: MessageKey; desc: MessageKey }> = {
  today: { title: 'views.empty.today.title', desc: 'views.empty.today.desc' },
  upcoming: { title: 'views.empty.upcoming.title', desc: 'views.empty.upcoming.desc' },
  all: { title: 'views.empty.all.title', desc: 'views.empty.all.desc' },
  completed: { title: 'views.empty.completed.title', desc: 'views.empty.completed.desc' },
  stats: { title: 'views.empty.stats.title', desc: 'views.empty.stats.desc' },
  matrix: { title: 'views.empty.matrix.title', desc: 'views.empty.matrix.desc' },
  calendar: { title: 'views.empty.calendar.title', desc: 'views.empty.calendar.desc' },
  trash: { title: 'views.empty.trash.title', desc: 'views.empty.trash.desc' }
}

export function EmptyState({ view }: { view: AppView }) {
  const t = useT()
  const setView = useTaskStore((state) => state.setView)
  const message = MESSAGES[view]

  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <div className="empty-orbit-ring" />
        <PolarisMark size={34} />
      </div>
      <div className="empty-title">{t(message.title)}</div>
      <div className="empty-desc">{t(message.desc, { days: TRASH_RETENTION_DAYS })}</div>
      {view === 'completed' || view === 'stats' ? (
        <button className="empty-cta" onClick={() => setView('today')}>
          {t('views.empty.viewToday')}
        </button>
      ) : view !== 'trash' ? (
        <button
          className="empty-cta"
          onClick={() => window.dispatchEvent(new CustomEvent('polaris:quick-add'))}
        >
          {t('views.empty.addTask')}
        </button>
      ) : null}
    </div>
  )
}