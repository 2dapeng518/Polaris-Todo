import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import type { MessageKey } from '@shared/i18n'
import type { Task } from '@shared/types'
import { useTaskStore } from '../stores/useTaskStore'
import { useMatrixStore } from '../stores/useMatrixStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { TaskItem } from './TaskItem'
import { QuadrantMenu } from './matrix/QuadrantMenu'
import { QuadrantQuickAdd } from './matrix/QuadrantQuickAdd'
import { QuadrantEditDialog } from './matrix/QuadrantEditDialog'
import {
  MATRIX_QUADRANT_MIME,
  MATRIX_TASK_MIME,
  appendId,
  quadrantDropPatch,
  reorderIds
} from './matrix/drag'
import {
  QUADRANT_NUMERALS,
  applyManualOrder,
  assignQuadrants,
  groupByTime,
  sortTasks,
  type QuadrantId
} from './matrix/matching'

// 四象限视图：归象走 matrix/matching.ts 的级联规则（do → plan → quick →
// later 首个命中筛选配置的象限胜出），筛选/分组/排序/顺序按象限存
// useMatrixStore（localStorage 持久化）。默认配置复刻旧派生规则：
// 重要 = 优先级中/高；紧急 = 今天到期或已逾期；无截止 = 不紧急。
//
// 拖拽三种手势（HTML5 DnD，同日历看板先例）：
// 1) 任务跨象限：按目标象限默认语义改写优先级/日期后重新归象；
// 2) 任务格内拖动：仅 sort==='manual' 时生效，写入该格手动顺序；
// 3) 卡片换位：拖象限头到另一格，交换 2×2 位置（持久化）。
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
  const updateTask = useTaskStore((state) => state.updateTask)
  const prefs = useMatrixStore((state) => state.prefs)
  const order = useMatrixStore((state) => state.order)
  const manualOrder = useMatrixStore((state) => state.manualOrder)
  const swapQuadrants = useMatrixStore((state) => state.swapQuadrants)
  const setManualOrder = useMatrixStore((state) => state.setManualOrder)
  // 矩阵可能长时间开着：跨过午夜后「今天/逾期」的判定不能还是昨天。
  const [now, setNow] = useState(() => new Date())
  const [editFor, setEditFor] = useState<QuadrantId | null>(null)
  // 拖拽态：任务行、卡片各自记录来源与当前悬停目标。
  const dragTaskRef = useRef<{ id: string; from: QuadrantId } | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [draggingQuadrant, setDraggingQuadrant] = useState<QuadrantId | null>(null)
  const [dropQuadrant, setDropQuadrant] = useState<QuadrantId | null>(null)
  const [dropBeforeTaskId, setDropBeforeTaskId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const quadrants = useMemo(() => {
    const active = tasks.filter((task) => !task.completed)
    const buckets = assignQuadrants(active, prefs, now)
    return order.map((id) => {
      const pref = prefs[id]
      const items =
        pref.sort === 'manual'
          ? applyManualOrder(buckets[id], manualOrder[id])
          : sortTasks(buckets[id], pref.sort, pref.dir, locale)
      return { id, meta: QUADRANT_META[id], group: pref.group, sort: pref.sort, items }
    })
  }, [tasks, prefs, order, manualOrder, now, locale])

  const itemsOf = (id: QuadrantId): Task[] =>
    quadrants.find((quadrant) => quadrant.id === id)?.items ?? []

  // 切到手动排序前，用当前可见顺序给手动序列打底：用户看到什么顺序，
  // 切过去就是什么顺序，而不是回到 DB 顺序。
  const snapshotManualOrder = (id: QuadrantId): void => {
    setManualOrder(
      id,
      itemsOf(id).map((task) => task.id)
    )
  }

  const clearDragState = (): void => {
    dragTaskRef.current = null
    setDraggingTaskId(null)
    setDraggingQuadrant(null)
    setDropQuadrant(null)
    setDropBeforeTaskId(null)
  }

  const onTaskDragStart = (task: Task, from: QuadrantId) => (event: ReactDragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(MATRIX_TASK_MIME, task.id)
    event.dataTransfer.effectAllowed = 'move'
    dragTaskRef.current = { id: task.id, from }
    setDraggingTaskId(task.id)
  }

  const onTaskDrop = (taskId: string, target: QuadrantId, beforeTaskId: string | null): void => {
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (!task) return
    const from = dragTaskRef.current?.from
    if (from === target) {
      // 同格内只支持手动排序；派生排序下落地即复位。
      if (prefs[target].sort !== 'manual') return
      setManualOrder(target, reorderIds(itemsOf(target).map((item) => item.id), taskId, beforeTaskId))
      return
    }
    const patch = quadrantDropPatch(target, task, now)
    void updateTask(taskId, patch)
      .then(() => {
        if (prefs[target].sort === 'manual') {
          setManualOrder(target, appendId(manualOrder[target], taskId))
        }
      })
      .catch(() => {})
  }

  const sectionDropHandlers = (id: QuadrantId) => ({
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      const types = event.dataTransfer.types
      if (!types.includes(MATRIX_TASK_MIME) && !types.includes(MATRIX_QUADRANT_MIME)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropQuadrant(id)
      if (types.includes(MATRIX_QUADRANT_MIME)) setDropBeforeTaskId(null)
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null
      if (next && event.currentTarget.contains(next)) return
      setDropQuadrant((current) => (current === id ? null : current))
      setDropBeforeTaskId(null)
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      const types = event.dataTransfer.types
      setDropQuadrant(null)
      setDropBeforeTaskId(null)
      if (types.includes(MATRIX_QUADRANT_MIME)) {
        const from = event.dataTransfer.getData(MATRIX_QUADRANT_MIME) as QuadrantId
        if (from && from !== id) swapQuadrants(from, id)
        clearDragState()
        return
      }
      const taskId = event.dataTransfer.getData(MATRIX_TASK_MIME)
      if (taskId) onTaskDrop(taskId, id, null)
      clearDragState()
    }
  })

  const rowDropHandlers = (task: Task, quadrantId: QuadrantId) => ({
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(MATRIX_TASK_MIME)) return
      if (dragTaskRef.current?.from !== quadrantId) return
      if (prefs[quadrantId].sort !== 'manual') return
      event.preventDefault()
      event.stopPropagation()
      setDropBeforeTaskId(task.id)
      setDropQuadrant(quadrantId)
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(MATRIX_TASK_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      const taskId = event.dataTransfer.getData(MATRIX_TASK_MIME)
      // 先落盘再清拖拽态：onTaskDrop 需要读 dragTaskRef 判断是否同格。
      if (taskId && taskId !== task.id) onTaskDrop(taskId, quadrantId, task.id)
      clearDragState()
    }
  })

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
        const sectionHandlers = sectionDropHandlers(quadrant.id)
        return (
          <section
            key={quadrant.id}
            className={[
              'matrix-quadrant',
              dropQuadrant === quadrant.id ? 'is-drop-target' : '',
              draggingQuadrant === quadrant.id ? 'is-dragging' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            data-quadrant={quadrant.id}
            aria-label={aria}
            {...sectionHandlers}
          >
            <div
              className="matrix-quadrant-head"
              draggable
              onDragStart={(event) => {
                // 头部的 +/… 是按钮：从按钮上起手不能变成拖卡片。
                if ((event.target as HTMLElement).closest('button')) {
                  event.preventDefault()
                  return
                }
                event.dataTransfer.setData(MATRIX_QUADRANT_MIME, quadrant.id)
                event.dataTransfer.effectAllowed = 'move'
                setDraggingQuadrant(quadrant.id)
              }}
              onDragEnd={clearDragState}
            >
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
                <QuadrantMenu
                  quadrantId={quadrant.id}
                  onEdit={() => setEditFor(quadrant.id)}
                  onManualSort={() => snapshotManualOrder(quadrant.id)}
                />
              </span>
            </div>
            {quadrant.items.length > 0 ? (
              <div className="matrix-quadrant-list">
                {timeGroups
                  ? timeGroups.map((group) => (
                      <div key={group.key} className="matrix-quadrant-group">
                        <div className="matrix-group-label">{group.label}</div>
                        {group.tasks.map((task) => (
                          <MatrixRow
                            key={task.id}
                            task={task}
                            quadrantId={quadrant.id}
                            dragging={draggingTaskId === task.id}
                            dropBefore={dropBeforeTaskId === task.id}
                            onDragStart={onTaskDragStart(task, quadrant.id)}
                            onDragEnd={clearDragState}
                            rowHandlers={rowDropHandlers(task, quadrant.id)}
                          />
                        ))}
                      </div>
                    ))
                  : quadrant.items.map((task) => (
                      <MatrixRow
                        key={task.id}
                        task={task}
                        quadrantId={quadrant.id}
                        dragging={draggingTaskId === task.id}
                        dropBefore={dropBeforeTaskId === task.id}
                        onDragStart={onTaskDragStart(task, quadrant.id)}
                        onDragEnd={clearDragState}
                        rowHandlers={rowDropHandlers(task, quadrant.id)}
                      />
                    ))}
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

type MatrixRowProps = {
  task: Task
  quadrantId: QuadrantId
  dragging: boolean
  dropBefore: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  rowHandlers: {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => void
  }
}

// 任务行包一层拖拽壳：TaskItem 是各视图共用的，不为矩阵单独改它。
function MatrixRow({ task, quadrantId, dragging, dropBefore, onDragStart, onDragEnd, rowHandlers }: MatrixRowProps) {
  return (
    <div
      className={[
        'matrix-row',
        dragging ? 'is-dragging' : '',
        dropBefore ? 'is-drop-before' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      draggable
      data-matrix-row={task.id}
      data-matrix-row-quadrant={quadrantId}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      {...rowHandlers}
    >
      <TaskItem task={task} />
    </div>
  )
}