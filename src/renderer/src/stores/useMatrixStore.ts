import { create } from 'zustand'
import {
  QUADRANT_IDS,
  defaultQuadrantPrefs,
  isMatrixGroupMode,
  isMatrixSortDir,
  isMatrixSortMode,
  type MatrixDateScope,
  type MatrixFilter,
  type MatrixGroupMode,
  type MatrixKindScope,
  type MatrixSortDir,
  type MatrixSortMode,
  type QuadrantId,
  type QuadrantPrefs
} from '../components/matrix/matching'

// 四象限套件的视图偏好：每个象限一份「筛选（清单/日期/优先级/任务类型） +
// 分组 + 排序 + 顺序」，外加 2×2 的卡片排列顺序与每格的手动排序。纯视图
// 偏好住 localStorage（同 useCalendarStore 的先例），不进 meta 表，也不走
// IPC。默认配置复刻旧版派生规则——重要 = 优先级中/高、紧急 = 今天到期或
// 已逾期（无截止视为不紧急），按 do → plan → quick → later 级联归象（首个
// 命中的象限胜出），所以 plan/later 的日期放宽为「所有」来接住前两个象限
// 没接走的任务。

const STORAGE_KEY = 'polaris-matrix-view'

function isQuadrantId(value: unknown): value is QuadrantId {
  return typeof value === 'string' && (QUADRANT_IDS as readonly string[]).includes(value)
}

function isDateScope(value: unknown): value is MatrixDateScope {
  return (
    value === 'all' ||
    value === 'today' ||
    value === 'tomorrow' ||
    value === 'week' ||
    value === 'overdue' ||
    value === 'todayOrOverdue' ||
    value === 'noDate'
  )
}

function isKindScope(value: unknown): value is MatrixKindScope {
  return value === 'all' || value === 'task' || value === 'note'
}

// 优先级集合：'all' 或 0-3 的任意数组。空数组是合法配置（一个优先级都不
// 匹配，象限为空），「恢复默认」随时能救回来，不必偷偷改写用户的选择。
function isPriorityScope(value: unknown): value is 'all' | number[] {
  if (value === 'all') return true
  if (!Array.isArray(value)) return false
  return value.every((item) => typeof item === 'number' && item >= 0 && item <= 3 && Number.isInteger(item))
}

function readFilter(raw: unknown, fallback: MatrixFilter): MatrixFilter {
  const source = (raw ?? {}) as {
    projectId?: unknown
    date?: unknown
    priorities?: unknown
    kind?: unknown
  }
  return {
    projectId: typeof source.projectId === 'string' ? source.projectId : fallback.projectId,
    date: isDateScope(source.date) ? source.date : fallback.date,
    priorities: isPriorityScope(source.priorities) ? source.priorities : fallback.priorities,
    kind: isKindScope(source.kind) ? source.kind : fallback.kind
  }
}

// 排列顺序必须是四象限的一个排列：去重、丢弃非法项、补回缺项（旧存档没有
// order 字段时自然得到默认顺序）。
function readOrder(raw: unknown): QuadrantId[] {
  const result: QuadrantId[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isQuadrantId(item) && !result.includes(item)) result.push(item)
    }
  }
  for (const id of QUADRANT_IDS) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

function readManualOrder(raw: unknown): Record<QuadrantId, string[]> {
  const source = (raw ?? {}) as Record<string, unknown>
  const next = {} as Record<QuadrantId, string[]>
  for (const id of QUADRANT_IDS) {
    const value = source[id]
    const ids: string[] = []
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && !ids.includes(item)) ids.push(item)
      }
    }
    next[id] = ids
  }
  return next
}

type StoredState = {
  prefs: Record<QuadrantId, QuadrantPrefs>
  order: QuadrantId[]
  manualOrder: Record<QuadrantId, string[]>
}

function readStored(): StoredState {
  const fallback: StoredState = {
    prefs: defaultQuadrantPrefs(),
    order: [...QUADRANT_IDS],
    manualOrder: readManualOrder(null)
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const prefs = {} as Record<QuadrantId, QuadrantPrefs>
    for (const id of QUADRANT_IDS) {
      const stored = parsed[id] as Record<string, unknown> | undefined
      const base = fallback.prefs[id]
      prefs[id] = {
        filter: readFilter(stored?.filter, base.filter),
        group: isMatrixGroupMode(stored?.group) ? stored.group : base.group,
        sort: isMatrixSortMode(stored?.sort) ? stored.sort : base.sort,
        dir: isMatrixSortDir(stored?.dir) ? stored.dir : base.dir
      }
    }
    return {
      prefs,
      order: readOrder(parsed.order),
      manualOrder: readManualOrder(parsed.manualOrder)
    }
  } catch {
    return fallback
  }
}

type MatrixState = {
  prefs: Record<QuadrantId, QuadrantPrefs>
  /** 2×2 的显示顺序（卡片拖动换位后持久化）。 */
  order: QuadrantId[]
  /** 每格的手动排序（任务 id 序列；仅 sort==='manual' 时消费）。 */
  manualOrder: Record<QuadrantId, string[]>
  setFilter: (id: QuadrantId, filter: MatrixFilter) => void
  setGroup: (id: QuadrantId, group: MatrixGroupMode) => void
  setSort: (id: QuadrantId, sort: MatrixSortMode) => void
  setDir: (id: QuadrantId, dir: MatrixSortDir) => void
  /** 卡片拖动换位：交换两个象限在 2×2 中的位置。 */
  swapQuadrants: (a: QuadrantId, b: QuadrantId) => void
  setManualOrder: (id: QuadrantId, taskIds: string[]) => void
  resetQuadrant: (id: QuadrantId) => void
  resetAll: () => void
}

const stored = readStored()

export const useMatrixStore = create<MatrixState>((set, get) => {
  const persist = (): void => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...get().prefs,
          order: get().order,
          manualOrder: get().manualOrder
        })
      )
    } catch {
      // 存储不可用时仅本次会话生效。
    }
  }

  const patchQuadrant = (id: QuadrantId, patch: Partial<QuadrantPrefs>): void => {
    set({ prefs: { ...get().prefs, [id]: { ...get().prefs[id], ...patch } } })
    persist()
  }

  return {
    prefs: stored.prefs,
    order: stored.order,
    manualOrder: stored.manualOrder,

    setFilter: (id, filter) => patchQuadrant(id, { filter }),
    setGroup: (id, group) => patchQuadrant(id, { group }),
    setSort: (id, sort) => patchQuadrant(id, { sort }),
    setDir: (id, dir) => patchQuadrant(id, { dir }),

    swapQuadrants: (a, b) => {
      if (a === b) return
      const order = [...get().order]
      const indexA = order.indexOf(a)
      const indexB = order.indexOf(b)
      if (indexA < 0 || indexB < 0) return
      order[indexA] = b
      order[indexB] = a
      set({ order })
      persist()
    },

    setManualOrder: (id, taskIds) => {
      set({ manualOrder: { ...get().manualOrder, [id]: taskIds } })
      persist()
    },

    resetQuadrant: (id) => {
      set({
        prefs: { ...get().prefs, [id]: defaultQuadrantPrefs()[id] },
        manualOrder: { ...get().manualOrder, [id]: [] }
      })
      persist()
    },

    resetAll: () => {
      set({
        prefs: defaultQuadrantPrefs(),
        order: [...QUADRANT_IDS],
        manualOrder: readManualOrder(null)
      })
      persist()
    }
  }
})