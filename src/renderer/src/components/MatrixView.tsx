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
import { MATRIX_TASK_MIME, appendId, quadrantDropPatch, reorderIds } from './matrix/drag'
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
  // 卡片换位走指针手势：整张卡片克隆成浮层跟手，松手按落点交换。
  const cardDragRef = useRef<{
    id: QuadrantId
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    card: HTMLElement
    rect: DOMRect
    active: boolean
  } | null>(null)
  const ghostRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 卡片拖拽：pointerdown 记起点，移动超过 5px 才升级为拖拽（避免误触），
  // 克隆整张卡片做浮层（幽灵节点 pointer-events:none，不挡落点探测）。
  useEffect(() => {
    const quadrantAt = (x: number, y: number): QuadrantId | null => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null
      const value = element?.closest('[data-quadrant]')?.getAttribute('data-quadrant')
      return value === 'do' || value === 'plan' || value === 'quick' || value === 'later' ? value : null
    }
    const endGhost = (): void => {
      ghostRef.current?.remove()
      ghostRef.current = null
      document.body.classList.remove('matrix-card-dragging')
    }
    const beginGhost = (drag: NonNullable<typeof cardDragRef.current>): void => {
      drag.active = true
      setDraggingQuadrant(drag.id)
      document.body.classList.add('matrix-card-dragging')
      const clone = drag.card.cloneNode(true) as HTMLElement
      clone.classList.add('matrix-card-ghost')
      clone.removeAttribute('data-quadrant')
      clone.setAttribute('aria-hidden', 'true')
      clone.style.width = `${drag.rect.width}px`
      clone.style.height = `${drag.rect.height}px`
      // 同步列表滚动位置：克隆默认回到顶部，浮层应与抓起的瞬间一致。
      const sourceList = drag.card.querySelector('.matrix-quadrant-list')
      const cloneList = clone.querySelector('.matrix-quadrant-list')
      if (sourceList && cloneList) cloneList.scrollTop = sourceList.scrollTop
      document.body.appendChild(clone)
      ghostRef.current = clone
    }
    const moveGhost = (x: number, y: number, drag: NonNullable<typeof cardDragRef.current>): void => {
      const ghost = ghostRef.current
      if (!ghost) return
      ghost.style.transform = `translate3d(${x - drag.offsetX}px, ${y - drag.offsetY}px, 0) rotate(1.2deg)`
    }
    const onMove = (event: PointerEvent): void => {
      const drag = cardDragRef.current
      if (!drag) return
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return
        beginGhost(drag)
      }
      moveGhost(event.clientX, event.clientY, drag)
      const target = quadrantAt(event.clientX, event.clientY)
      setDropQuadrant(target && target !== drag.id ? target : null)
    }
    const finish = (x: number, y: number, cancelled: boolean): void => {
      const drag = cardDragRef.current
      if (!drag) return
      cardDragRef.current = null
      if (drag.active) {
        if (!cancelled) {
          const target = quadrantAt(x, y)
          if (target && target !== drag.id) swapQuadrants(drag.id, target)
        }
        setDraggingQuadrant(null)
        setDropQuadrant(null)
      }
      endGhost()
    }
    const onUp = (event: PointerEvent): void => finish(event.clientX, event.clientY, false)
    const onCancel = (event: PointerEvent): void => finish(event.clientX, event.clientY, true)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !cardDragRef.current?.active) return
      event.preventDefault()
      event.stopPropagation()
      finish(-1, -1, true)
    }
    // 在窗口外松开鼠标拿不到 pointerup：失焦时按取消收尾，避免浮层卡住。
    const onBlur = (): void => {
      if (cardDragRef.current?.active) finish(-1, -1, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      endGhost()
    }
  }, [swapQuadrants])

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
      if (!event.dataTransfer.types.includes(MATRIX_TASK_MIME)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropQuadrant(id)
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null
      if (next && event.currentTarget.contains(next)) return
      setDropQuadrant((current) => (current === id ? null : current))
      setDropBeforeTaskId(null)
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      setDropQuadrant(null)
      setDropBeforeTaskId(null)
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
              onPointerDown={(event) => {
                // 头部的 +/… 是按钮：从按钮上起手不进入卡片拖拽。
                if (event.button !== 0) return
                if ((event.target as HTMLElement).closest('button')) return
                const card = (event.currentTarget as HTMLElement).closest(
                  '.matrix-quadrant'
                ) as HTMLElement | null
                if (!card) return
                // 按住头部不选中文字；真正的拖拽阈值在 window 的 pointermove 里。
                event.preventDefault()
                const rect = card.getBoundingClientRect()
                cardDragRef.current = {
                  id: quadrant.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  offsetX: event.clientX - rect.left,
                  offsetY: event.clientY - rect.top,
                  card,
                  rect,
                  active: false
                }
              }}
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