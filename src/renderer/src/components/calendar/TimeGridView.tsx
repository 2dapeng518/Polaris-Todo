import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameDay, startOfDay, startOfWeek } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import type { Task } from '@shared/types'
import type { Locale } from '@shared/i18n'
import { useT, useLocale } from '../../stores/useLocaleStore'
import { useTaskStore } from '../../stores/useTaskStore'
import { dayKey, monthLabel, weekdayLabels } from '../../lib/dateTime'
import type { TaskPatch } from '../detail/types'

// 时间轴视图（日历套件 P2.1/2.2/2.3）：周 / 日 / 多日 共用一份 00–24 小时
// 轴网格，多周用紧凑日格（chip 语义与月格一致，不带时间轴）。任务按
// startAt/endAt 摆块；只有 dueAt 的任务按「截止 +1h」摆视觉块（样式区分，
// 不落库）；全天任务进顶部全天行。空白拖拽创建、块拖拽移动、下缘拉伸改
// 时长，15 分钟吸附；移动/拉伸同步平移 dueAt（日历分组的锚点不能掉队）。
// 键盘可达替代 = 详情面板「时间」弹层（P0.3）。
//
// 已知边界：拖拽只在当前列内进行（不跨列拖），全天 chip 不可拖；重叠块全部
// 并排渲染（等宽分列），不藏事件。

const HOUR_PX = 48
const PX_PER_MIN = HOUR_PX / 60
const DAY_MINUTES = 1440
const SNAP_MINUTES = 15
const DEFAULT_BLOCK_MINUTES = 60
const MIN_BLOCK_MINUTES = 15
const ALL_DAY_MAX = 3

export type TimeMode = 'week' | 'multiweek' | 'day' | 'multiday'

const MULTIDAY_COUNT = 3
const MULTIWEEK_WEEKS = 2

// 可见日（周一起始的整周；多日 = 锚点起连续 3 天；多周 = 锚点所在周起 2 周）。
export function visibleDaysFor(mode: TimeMode, anchor: Date): Date[] {
  if (mode === 'day') return [startOfDay(anchor)]
  if (mode === 'multiday') {
    const first = startOfDay(anchor)
    return Array.from({ length: MULTIDAY_COUNT }, (_, index) => addDays(first, index))
  }
  const weekStart = startOfWeek(startOfDay(anchor), { weekStartsOn: 1 })
  const weeks = mode === 'multiweek' ? MULTIWEEK_WEEKS : 1
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(weekStart, index))
}

// 有小时轴的模式（周/日/多日）与紧凑模式（多周）分流。
export function isAxisMode(mode: TimeMode): boolean {
  return mode !== 'multiweek'
}

const snapFloorMin = (raw: number): number => Math.floor(raw / SNAP_MINUTES) * SNAP_MINUTES
const snapRoundMin = (raw: number): number => Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES
const clampMin = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

// 任务在某一列（本地日）的块：返回「相对当日零点的分钟」，跨天块的结束端
// 可超过 1440，渲染时夹到列高。allDay 不进时间轴；默认时长 1 小时只用于
// 视觉与拖拽基准，不落库。
type DayBlock = { task: Task; startMin: number; endMin: number }

function blockForDay(task: Task, day: Date): DayBlock | null {
  if (task.allDay) return null
  const startIso = task.startAt ?? task.dueAt
  if (!startIso) return null
  const startDate = new Date(startIso)
  const durationMs =
    task.startAt && task.endAt
      ? new Date(task.endAt).getTime() - startDate.getTime()
      : DEFAULT_BLOCK_MINUTES * 60000
  const endDate = new Date(startDate.getTime() + Math.max(0, durationMs))
  const dayStart = startOfDay(day).getTime()
  const startMs = Math.max(startDate.getTime(), dayStart)
  const endMs = Math.min(endDate.getTime(), dayStart + DAY_MINUTES * 60000)
  if (endMs <= startMs) return null
  return {
    task,
    startMin: (startMs - dayStart) / 60000,
    endMin: (endMs - dayStart) / 60000
  }
}

// 全天任务出现在某一列：allDay 且 [start日, end日] 覆盖该列。
function allDayForDay(task: Task, day: Date): boolean {
  if (!task.allDay) return false
  const startIso = task.startAt ?? task.dueAt
  if (!startIso) return false
  const startDate = startOfDay(new Date(startIso))
  const endDate = task.endAt ? startOfDay(new Date(task.endAt)) : startDate
  const target = startOfDay(day)
  return target.getTime() >= startDate.getTime() && target.getTime() <= endDate.getTime()
}

// 重叠聚类 + 列分配：同一簇内逐列贪心（列尾 <= 块头即复用），簇与簇纵向
// 相接。全部并排渲染，不藏事件。
type PlacedBlock = DayBlock & { col: number; cols: number }

function layoutDay(blocks: DayBlock[]): PlacedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const placed: PlacedBlock[] = []
  let cluster: DayBlock[] = []
  let clusterEnd = -1
  const flush = (): void => {
    if (cluster.length === 0) return
    const colEnds: number[] = []
    const assigned: Array<DayBlock & { col: number }> = []
    for (const block of cluster) {
      let col = colEnds.findIndex((end) => end <= block.startMin)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(block.endMin)
      } else {
        colEnds[col] = block.endMin
      }
      assigned.push({ ...block, col })
    }
    for (const block of assigned) placed.push({ ...block, cols: colEnds.length })
    cluster = []
    clusterEnd = -1
  }
  for (const block of sorted) {
    if (cluster.length > 0 && block.startMin >= clusterEnd) flush()
    cluster.push(block)
    clusterEnd = Math.max(clusterEnd, block.endMin)
  }
  flush()
  return placed
}

type DragState =
  | { kind: 'create'; dayIndex: number; startMin: number; endMin: number }
  | { kind: 'move'; task: Task; dayIndex: number; startMin: number; endMin: number; moved: boolean }
  | { kind: 'resize'; task: Task; dayIndex: number; startMin: number; endMin: number }

type CreateDraft = { day: Date; startMin: number; endMin: number }

export function TimeGridView({
  mode,
  tasks,
  now,
  anchorKey,
  onAnchorChange,
  parseDayKey
}: {
  mode: TimeMode
  tasks: Task[]
  now: Date
  anchorKey: string
  onAnchorChange: (day: Date) => void
  parseDayKey: (key: string) => Date
}) {
  const t = useT()
  const locale = useLocale()
  const addTask = useTaskStore((state) => state.addTask)
  const updateTask = useTaskStore((state) => state.updateTask)
  const selectTask = useTaskStore((state) => state.selectTask)
  const anchor = useMemo(() => parseDayKey(anchorKey), [anchorKey, parseDayKey])
  const days = useMemo(() => visibleDaysFor(mode, anchor), [mode, anchor])
  const en = locale === 'en'

  // 拖拽的权威状态在 ref（pointerup 的闭包必须读到最新值），React state 只做
  // 渲染镜像；两者永远由 updateDrag 一同更新。
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDragState] = useState<DragState | null>(null)
  const updateDrag = (next: DragState | null): void => {
    dragRef.current = next
    setDragState(next)
  }

  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)
  const [createTitle, setCreateTitle] = useState('')
  const createInputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const colRefs = useRef<Array<HTMLDivElement | null>>([])

  // 进视图滚到清晨（6 点起跳）。
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller.scrollTop = Math.max(0, 6 * HOUR_PX - 24)
  }, [])

  // 创建弹层出现即聚焦输入框（30ms，避开 pop-in 中途聚焦失败的老坑）。
  useEffect(() => {
    if (!createDraft) return
    const timer = window.setTimeout(() => createInputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [createDraft])

  const byDay = useMemo(() => {
    const blocks = new Map<string, DayBlock[]>()
    const allDay = new Map<string, Task[]>()
    for (const day of days) {
      const key = dayKey(day)
      blocks.set(key, [])
      allDay.set(key, [])
    }
    for (const task of tasks) {
      for (const day of days) {
        const key = dayKey(day)
        if (allDayForDay(task, day)) {
          allDay.get(key)?.push(task)
          continue
        }
        const block = blockForDay(task, day)
        if (block) blocks.get(key)?.push(block)
      }
    }
    return { blocks, allDay }
  }, [tasks, days])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowKey = dayKey(now)

  // ---------- 拖拽：window pointer 监听 + 15 分钟吸附。列矩形按下时捕获一次。 ----------
  const beginDrag = (
    kind: 'create' | 'move' | 'resize',
    dayIndex: number,
    event: React.PointerEvent,
    seed?: { startMin: number; endMin: number; task?: Task }
  ): void => {
    if (event.button !== 0 || createDraft || dragRef.current) return
    const col = colRefs.current[dayIndex]
    if (!col) return
    const rect = col.getBoundingClientRect()
    const minFromY = (clientY: number): number =>
      clampMin(snapRoundMin(((clientY - rect.top) / rect.height) * DAY_MINUTES), 0, DAY_MINUTES * 2)

    // create：按下点向下取整到 15 分钟刻度；move/resize：以块的原始区间为基准。
    const origStart = seed?.startMin ?? 0
    const origEnd = seed?.endMin ?? 0
    let moved = false

    if (kind === 'create') {
      const startMin = clampMin(
        snapFloorMin(((event.clientY - rect.top) / rect.height) * DAY_MINUTES),
        0,
        DAY_MINUTES - SNAP_MINUTES
      )
      updateDrag({ kind: 'create', dayIndex, startMin, endMin: startMin })
    } else if (kind === 'move') {
      updateDrag({ kind: 'move', task: seed!.task!, dayIndex, startMin: origStart, endMin: origEnd, moved: false })
    } else {
      updateDrag({ kind: 'resize', task: seed!.task!, dayIndex, startMin: origStart, endMin: origEnd })
    }
    const originY = event.clientY

    const onMove = (e: PointerEvent): void => {
      if (Math.abs(e.clientY - originY) > 3) moved = true
      const current = dragRef.current
      if (!current) return
      if (current.kind === 'create') {
        const raw = minFromY(e.clientY)
        const endMin = Math.max(clampMin(raw, 0, DAY_MINUTES), current.startMin + SNAP_MINUTES)
        updateDrag({ ...current, endMin })
        return
      }
      if (current.kind === 'resize') {
        const endMin = clampMin(minFromY(e.clientY), current.startMin + MIN_BLOCK_MINUTES, DAY_MINUTES * 2)
        updateDrag({ ...current, endMin })
        return
      }
      // move：整块平移保持时长，起点限制在当日 0 点以后。
      const deltaMin = snapRoundMin(((e.clientY - originY) / rect.height) * DAY_MINUTES)
      const startMin = Math.max(origStart + deltaMin, 0)
      const applied = startMin - origStart
      updateDrag({
        ...current,
        startMin: origStart + applied,
        endMin: origEnd + applied,
        moved
      })
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const current = dragRef.current
      updateDrag(null)
      if (!current) return
      if (current.kind === 'create') {
        const length = current.endMin - current.startMin
        setCreateDraft({
          day: days[current.dayIndex],
          startMin: current.startMin,
          endMin: length >= MIN_BLOCK_MINUTES ? current.endMin : current.startMin + DEFAULT_BLOCK_MINUTES
        })
        setCreateTitle('')
        return
      }
      // 块上「点击」没超过拖拽阈值：打开详情，不当作拖拽。
      if (current.kind === 'move' && !current.moved) {
        selectTask(current.task.id)
        return
      }
      applyDrag(current)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 把拖拽结果落库。move：start/end/due 同步平移同一分钟差；resize：有
  // startAt 改 endAt，只有 dueAt 的任务第一次拉伸即升级为计划时间段。
  const applyDrag = (state: DragState): void => {
    if (state.kind !== 'move' && state.kind !== 'resize') return
    const task = state.task
    const day = days[state.dayIndex]
    const dayStart = startOfDay(day)
    const toIso = (min: number): string =>
      new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, min).toISOString()
    const patch: TaskPatch = {}

    if (state.kind === 'move') {
      const original = blockForDay(task, day)
      const delta = state.startMin - (original?.startMin ?? 0)
      if (delta === 0) return
      const shift = (iso: string | null): string | null =>
        iso ? new Date(new Date(iso).getTime() + delta * 60000).toISOString() : null
      patch.startAt = shift(task.startAt)
      patch.endAt = shift(task.endAt)
      patch.dueAt = shift(task.dueAt)
    } else {
      const endIso = toIso(state.endMin)
      const baseMs = task.startAt
        ? new Date(task.startAt).getTime()
        : task.dueAt
          ? new Date(task.dueAt).getTime()
          : null
      if (baseMs === null) return
      const safeEnd = new Date(Math.max(new Date(endIso).getTime(), baseMs + MIN_BLOCK_MINUTES * 60000)).toISOString()
      if (task.startAt) {
        patch.endAt = safeEnd
      } else {
        // due-only → 拉伸即升级：startAt = 截止时刻，endAt = 拉伸终点。
        patch.startAt = task.dueAt
        patch.endAt = safeEnd
      }
    }
    void updateTask(task.id, patch)
  }

  // 创建弹层提交：标题必填；dueAt 取块开始时刻（月格/列表同帧可见），
  // startAt/endAt 落拖拽区间。
  const submitCreate = (): void => {
    if (!createDraft) return
    const title = createTitle.trim()
    if (!title) return
    const dayStart = startOfDay(createDraft.day)
    const startIso = new Date(
      dayStart.getFullYear(),
      dayStart.getMonth(),
      dayStart.getDate(),
      0,
      createDraft.startMin
    ).toISOString()
    const endIso = new Date(
      dayStart.getFullYear(),
      dayStart.getMonth(),
      dayStart.getDate(),
      0,
      Math.max(createDraft.endMin, createDraft.startMin + MIN_BLOCK_MINUTES)
    ).toISOString()
    void addTask(title, startIso, null, 0, { startAt: startIso, endAt: endIso })
    setCreateDraft(null)
    setCreateTitle('')
  }

  const headLabel = (day: Date): string =>
    en
      ? format(day, 'EEE d', { locale: enUS })
      : format(day, 'EEEEEE d', { locale: zhCN })

  if (!isAxisMode(mode)) {
    return (
      <MultiWeekGrid
        days={days}
        tasks={tasks}
        now={now}
        anchor={anchor}
        locale={locale}
        onSelectTask={selectTask}
        onAnchorChange={onAnchorChange}
      />
    )
  }

  return (
    <div className="timegrid" data-timegrid>
      <div className="timegrid-head">
        <div className="timegrid-dayheads">
          <div className="timegrid-corner" />
          {days.map((day) => {
            const key = dayKey(day)
            const isToday = key === nowKey
            return (
              <button
                key={key}
                type="button"
                className={`timegrid-dayhead ${isToday ? 'is-today' : ''} ${isSameDay(day, anchor) ? 'is-anchor' : ''}`}
                aria-label={day.toLocaleDateString(en ? 'en-US' : 'zh-CN')}
                onClick={() => onAnchorChange(day)}
              >
                <span className="timegrid-dayhead-name">{headLabel(day)}</span>
              </button>
            )
          })}
        </div>
        <div className="timegrid-allday" data-allday-row>
          <div className="timegrid-corner timegrid-corner-label">
            {t('detail.time.allDay')}
          </div>
          {days.map((day) => {
            const key = dayKey(day)
            const items = byDay.allDay.get(key) ?? []
            const shown = items.slice(0, ALL_DAY_MAX)
            const rest = items.length - shown.length
            return (
              <div key={key} className="timegrid-allday-cell" data-allday-day={key}>
                {shown.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="timegrid-allday-chip"
                    data-calendar-task={task.id}
                    title={task.title}
                    onClick={() => selectTask(task.id)}
                  >
                    <span className="timegrid-allday-title">{task.title}</span>
                  </button>
                ))}
                {rest > 0 && <span className="calendar-more">+{rest}</span>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="timegrid-scroll" ref={scrollRef}>
        <div className="timegrid-canvas" style={{ height: DAY_MINUTES * PX_PER_MIN }}>
          <div className="timegrid-axis" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="timegrid-hourlabel" style={{ top: hour * HOUR_PX }}>
                {en
                  ? format(new Date(2026, 0, 1, hour), 'hA', { locale: enUS })
                  : `${String(hour).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          <div className="timegrid-cols">
            {days.map((day, dayIndex) => {
              const key = dayKey(day)
              const placed = layoutDay(byDay.blocks.get(key) ?? [])
              return (
                <div
                  key={key}
                  className="timegrid-col"
                  data-timegrid-day={key}
                  ref={(node) => {
                    colRefs.current[dayIndex] = node
                  }}
                  onPointerDown={(event) => {
                    // 只响应列空白处的按下（块自己 stopPropagation）。
                    if (event.target !== event.currentTarget) return
                    beginDrag('create', dayIndex, event)
                  }}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <div key={hour} className="timegrid-hourline" style={{ top: hour * HOUR_PX }} />
                  ))}

                  {drag?.kind === 'create' && drag.dayIndex === dayIndex && (
                    <div
                      className="timegrid-ghost"
                      style={{
                        top: drag.startMin * PX_PER_MIN,
                        height: Math.max(drag.endMin - drag.startMin, SNAP_MINUTES) * PX_PER_MIN
                      }}
                    />
                  )}
                  {drag?.kind === 'move' && drag.dayIndex === dayIndex && drag.moved && (
                    <div
                      className="timegrid-ghost is-move"
                      style={{
                        top: drag.startMin * PX_PER_MIN,
                        height: Math.max(drag.endMin - drag.startMin, MIN_BLOCK_MINUTES) * PX_PER_MIN
                      }}
                    />
                  )}

                  {placed.map((block) => {
                    // 正在拖动的块隐藏本体，由幽灵块接力（避免双影）。
                    if (
                      drag &&
                      drag.kind === 'move' &&
                      drag.task.id === block.task.id &&
                      drag.dayIndex === dayIndex &&
                      drag.moved
                    ) {
                      return null
                    }
                    const isResizing =
                      drag?.kind === 'resize' && drag.task.id === block.task.id && drag.dayIndex === dayIndex
                    const bottomMin = isResizing && drag ? drag.endMin : block.endMin
                    return (
                      <div
                        key={block.task.id}
                        className={`timegrid-block ${isResizing ? 'is-resizing' : ''} ${block.task.completed ? 'is-done' : ''} ${block.task.startAt ? '' : 'is-due-only'}`}
                        data-timegrid-block={block.task.id}
                        style={{
                          top: block.startMin * PX_PER_MIN,
                          height: Math.max((bottomMin - block.startMin) * PX_PER_MIN, 18),
                          left: `calc(${(block.col / block.cols) * 100}% + 2px)`,
                          width: `calc(${(1 / block.cols) * 100}% - 4px)`
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          beginDrag('move', dayIndex, event, {
                            startMin: block.startMin,
                            endMin: block.endMin,
                            task: block.task
                          })
                        }}
                      >
                        <span className="timegrid-block-time">
                          {formatTimeRange(block.task, en)}
                        </span>
                        <span className="timegrid-block-title">{block.task.title}</span>
                        <div
                          className="timegrid-resize"
                          onPointerDown={(event) => {
                            event.stopPropagation()
                            beginDrag('resize', dayIndex, event, {
                              startMin: block.startMin,
                              endMin: block.endMin,
                              task: block.task
                            })
                          }}
                        />
                      </div>
                    )
                  })}

                  {nowKey === key && (
                    <div
                      className="timegrid-now"
                      style={{ top: nowMinutes * PX_PER_MIN }}
                      aria-hidden="true"
                    >
                      <span className="timegrid-now-dot" />
                    </div>
                  )}

                  {createDraft && isSameDay(createDraft.day, day) && (
                    <div
                      className="timegrid-create"
                      style={{ top: createDraft.startMin * PX_PER_MIN }}
                      data-timegrid-create
                    >
                      <input
                        ref={createInputRef}
                        value={createTitle}
                        placeholder={t('calendar.time.createPlaceholder')}
                        aria-label={t('calendar.time.createPlaceholder')}
                        onChange={(event) => setCreateTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            submitCreate()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            event.stopPropagation()
                            setCreateDraft(null)
                          }
                        }}
                      />
                      <span className="timegrid-create-range">
                        {formatMinutesRange(createDraft.startMin, createDraft.endMin, en)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTimeRange(task: Task, en: boolean): string {
  const startIso = task.startAt ?? task.dueAt
  if (!startIso) return ''
  const startDate = new Date(startIso)
  const endMs = task.endAt
    ? new Date(task.endAt).getTime()
    : startDate.getTime() + DEFAULT_BLOCK_MINUTES * 60000
  const fmt = (date: Date): string =>
    en
      ? `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${date.getHours() < 12 ? 'AM' : 'PM'}`
      : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${fmt(startDate)} – ${fmt(new Date(endMs))}`
}

function formatMinutesRange(startMin: number, endMin: number, en: boolean): string {
  const fmt = (min: number): string => {
    const hours = Math.floor(min / 60) % 24
    const minutes = min % 60
    return en
      ? `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
  return `${fmt(startMin)} – ${fmt(Math.max(endMin, startMin))}`
}

// ---------- 多周：紧凑日格（两行 × 七列，chip 语义与月格一致） ----------

function MultiWeekGrid({
  days,
  tasks,
  now,
  anchor,
  locale,
  onSelectTask,
  onAnchorChange
}: {
  days: Date[]
  tasks: Task[]
  now: Date
  anchor: Date
  locale: Locale
  onSelectTask: (id: string) => void
  onAnchorChange: (day: Date) => void
}) {
  const t = useT()
  const nowKey = dayKey(now)
  const anchorKey = dayKey(anchor)
  const maxChips = 3

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const day of days) map.set(dayKey(day), [])
    for (const task of tasks) {
      const source = task.dueAt ?? task.startAt
      if (!source) continue
      const key = dayKey(new Date(source))
      map.get(key)?.push(task)
    }
    return map
  }, [tasks, days])

  return (
    <div className="multiweek" data-multiweek>
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdayLabels(locale).map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="multiweek-grid" role="grid" aria-label={t('calendar.gridAria', { month: monthLabel(days[0], locale) })}>
        {days.map((day) => {
          const key = dayKey(day)
          const items = byDay.get(key) ?? []
          const shown = items.slice(0, maxChips)
          const rest = items.length - shown.length
          const isToday = key === nowKey
          const isAnchor = key === anchorKey
          return (
            <div
              key={key}
              className={`multiweek-cell ${isToday ? 'is-today' : ''} ${isAnchor ? 'is-anchor' : ''}`}
              role="gridcell"
              data-date={key}
              tabIndex={-1}
              aria-current={isToday ? 'date' : undefined}
              aria-label={t('calendar.cellAria', { month: day.getMonth() + 1, day: day.getDate(), count: items.length })}
              onClick={() => onAnchorChange(day)}
            >
              <span className="calendar-daynum">{day.getDate()}</span>
              <div className="calendar-chips">
                {shown.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`calendar-chip ${task.completed ? 'is-done' : ''} ${
                      !task.completed && (task.dueAt ?? task.startAt) && new Date(task.dueAt ?? task.startAt!).getTime() < now.getTime()
                        ? 'is-overdue'
                        : ''
                    }`}
                    data-calendar-task={task.id}
                    title={task.title}
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectTask(task.id)
                    }}
                  >
                    {task.priority >= 2 && <span className="calendar-chip-dot" aria-hidden="true" />}
                    <span className="calendar-chip-title">{task.title}</span>
                  </button>
                ))}
                {rest > 0 && <span className="calendar-more">+{rest}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
