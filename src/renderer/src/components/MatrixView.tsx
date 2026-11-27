import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { MessageKey } from '@shared/i18n'
import { useTaskStore } from '../stores/useTaskStore'
import { useMatrixStore } from '../stores/useMatrixStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { TaskItem } from './TaskItem'
import { QuadrantMenu } from './matrix/QuadrantMenu'
import { QuadrantQuickAdd } from './matrix/QuadrantQuickAdd'
import { QuadrantEditDialog } from './matrix/QuadrantEditDialog'
import {
  QUADRANT_IDS,
  QUADRANT_NUMERALS,
  assignQuadrants,
  groupByTime,
  sortTasks,
  type QuadrantId
} from './matrix/matching'

// 四象限视图：归象走 matrix/matching.ts 的级联规则（do → plan → quick →
// later 首个命中筛选配置的象限胜出），筛选/分组/排序/顺序按象限存
// useMatrixStore（localStorage 持久化）。默认配置复刻旧派生规则：
// 重要 = 优先级中/高；紧急 = 今天到期或已逾期；无截止 = 不紧急。
const QUADRANT_META: Record<QuadrantId, { labelKey: MessageKey; hintKey: MessageKey }> = {
  do: { labelKey: 'matrix.do', hintKey: 'matrix.doHint' },
  plan: { labelKey: 'matrix.plan', hintKey: 'matrix.planHint' },
  quick: { labelKey: 'matrix.quick', hintKey: 'matrix.quickHint' },
  later: { labelKey: 'matrix.later', hintKey: 'matrix.laterHint' }
}

export function MatrixView() {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const prefs = useMatrixStore((state) => state.prefs)
  // 矩阵可能长时间开着：跨过午夜后「今天/逾期」的判定不能还是昨天。
  const [now, setNow] = useState(() => new Date())
  const [editFor, setEditFor] = useState<QuadrantId | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const quadrants = useMemo(() => {
    const active = tasks.filter((task) => !task.completed)
    const buckets = assignQuadrants(active, prefs, now)
    return QUADRANT_IDS.map((id) => ({
      id,
      meta: QUADRANT_META[id],
      group: prefs[id].group,
      items: sortTasks(buckets[id], prefs[id].sort, prefs[id].dir, locale)
    }))
  }, [tasks, prefs, now, locale])

  return (
    <div className="matrix-view" role="group" aria-label={t('matrix.groupAria')}>
      {quadrants.map((quadrant) => {
        const aria = t('matrix.sectionAria', {
          label: t(quadrant.meta.labelKey),
          hint: t(quadrant.meta.hintKey)
        })
        const timeGroups =
          quadrant.group === 'time'
            ? groupByTime(quadrant.items, now, {
                // 分组标签全部走 matrix 自有键：不依赖日历键集（日历重构会删改键）。
                overdue: t('matrix.date.overdue'),
                today: t('matrix.date.today'),
                tomorrow: t('matrix.date.tomorrow'),
                far: t('matrix.date.far'),
                noDate: t('matrix.date.noDate')
              })
            : null
        return (
          <section key={quadrant.id} className="matrix-quadrant" data-quadrant={quadrant.id} aria-label={aria}>
            <div className="matrix-quadrant-head">
              <span className="matrix-quadrant-num" aria-hidden="true">
                {QUADRANT_NUMERALS[quadrant.id]}
              </span>
              <span className="matrix-quadrant-title">{t(quadrant.meta.labelKey)}</span>
              <span className="matrix-quadrant-hint">{t(quadrant.meta.hintKey)}</span>
              <span className="matrix-quadrant-count" data-quadrant-count>
                {quadrant.items.length}
              </span>
              <span className="matrix-quadrant-actions">
                <QuadrantQuickAdd quadrantId={quadrant.id} />
                <QuadrantMenu quadrantId={quadrant.id} onEdit={() => setEditFor(quadrant.id)} />
              </span>
            </div>
            {quadrant.items.length > 0 ? (
              <div className="matrix-quadrant-list">
                {timeGroups
                  ? timeGroups.map((group) => (
                      <div key={group.key} className="matrix-quadrant-group">
                        <div className="matrix-group-label">{group.label}</div>
                        {group.tasks.map((task) => (
                          <TaskItem key={task.id} task={task} />
                        ))}
                      </div>
                    ))
                  : quadrant.items.map((task) => <TaskItem key={task.id} task={task} />)}
              </div>
            ) : (
              <p className="matrix-quadrant-empty">{t('matrix.empty')}</p>
            )}
          </section>
        )
      })}
      <AnimatePresence>
        {editFor && (
          <QuadrantEditDialog key={editFor} quadrantId={editFor} onClose={() => setEditFor(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
