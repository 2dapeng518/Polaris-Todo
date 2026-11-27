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
// 分组 + 排序 + 顺序」。纯视图偏好住 localStorage（同 useCalendarStore 的
// 先例），不进 meta 表，也不走 IPC。默认配置复刻旧版派生规则——重要 =
// 优先级中/高、紧急 = 今天到期或已逾期（无截止视为不紧急），按
// do → plan → quick → later 级联归象（首个命中的象限胜出），所以
// plan/later 的日期放宽为「所有」来接住前两个象限没接走的任务。

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

function readStored(): Record<QuadrantId, QuadrantPrefs> {
  const fallback = defaultQuadrantPrefs()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next = {} as Record<QuadrantId, QuadrantPrefs>
    for (const id of QUADRANT_IDS) {
      const stored = isQuadrantId(id) ? (parsed[id] as Record<string, unknown> | undefined) : undefined
      const base = fallback[id]
      next[id] = {
        filter: readFilter(stored?.filter, base.filter),
        group: isMatrixGroupMode(stored?.group) ? stored.group : base.group,
        sort: isMatrixSortMode(stored?.sort) ? stored.sort : base.sort,
        dir: isMatrixSortDir(stored?.dir) ? stored.dir : base.dir
      }
    }
    return next
  } catch {
    return fallback
  }
}

type MatrixState = {
  prefs: Record<QuadrantId, QuadrantPrefs>
  setFilter: (id: QuadrantId, filter: MatrixFilter) => void
  setGroup: (id: QuadrantId, group: MatrixGroupMode) => void
  setSort: (id: QuadrantId, sort: MatrixSortMode) => void
  setDir: (id: QuadrantId, dir: MatrixSortDir) => void
  resetQuadrant: (id: QuadrantId) => void
  resetAll: () => void
}

export const useMatrixStore = create<MatrixState>((set, get) => {
  const persist = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get().prefs))
    } catch {
      // 存储不可用时仅本次会话生效。
    }
  }

  const patchQuadrant = (id: QuadrantId, patch: Partial<QuadrantPrefs>): void => {
    set({ prefs: { ...get().prefs, [id]: { ...get().prefs[id], ...patch } } })
    persist()
  }

  return {
    prefs: readStored(),

    setFilter: (id, filter) => patchQuadrant(id, { filter }),
    setGroup: (id, group) => patchQuadrant(id, { group }),
    setSort: (id, sort) => patchQuadrant(id, { sort }),
    setDir: (id, dir) => patchQuadrant(id, { dir }),

    resetQuadrant: (id) => patchQuadrant(id, defaultQuadrantPrefs()[id]),

    resetAll: () => {
      set({ prefs: defaultQuadrantPrefs() })
      persist()
    }
  }
})
