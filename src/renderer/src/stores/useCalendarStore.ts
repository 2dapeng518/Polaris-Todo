import { create } from 'zustand'

// 日历套件的视图偏好：子视图模式（月/周/多周/日/多日/列表/看板）、迷你月历
// 开关、全部子视图共享的锚点日。纯视图偏好住 localStorage（同 useSidebarStore
// 的先例），不进 meta 表，也不走 IPC。默认月视图 + 迷你月历收起——所有既有
// 布局与冒烟断言都量这个默认态。

export type CalendarMode = 'month' | 'week' | 'multiweek' | 'day' | 'multiday' | 'list' | 'board'

const MODES: readonly CalendarMode[] = ['month', 'week', 'multiweek', 'day', 'multiday', 'list', 'board']

function isCalendarMode(value: unknown): value is CalendarMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

const STORAGE_KEY = 'polaris-calendar-view'

// 本地日键 yyyy-MM-dd 的解析/生成：不用 new Date('yyyy-MM-dd')（那是 UTC 解析，
// 西半球会退一天）。锚点以「日键」存在 store 里，杜绝时区/时刻噪音。
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10))
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function dayKeyOf(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type StoredView = { mode?: unknown; miniOpen?: unknown }

function readStored(): { mode: CalendarMode; miniOpen: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { mode: 'month', miniOpen: false }
    const parsed = JSON.parse(raw) as StoredView
    return {
      mode: isCalendarMode(parsed.mode) ? parsed.mode : 'month',
      miniOpen: parsed.miniOpen === true
    }
  } catch {
    return { mode: 'month', miniOpen: false }
  }
}

type CalendarState = {
  mode: CalendarMode
  /** 共享锚点日（本地日键）：月视图取所在月，周/日视图（P2）取所在周/日。 */
  anchor: string
  miniOpen: boolean
  setMode: (mode: CalendarMode) => void
  setAnchor: (day: Date) => void
  setMiniOpen: (open: boolean) => void
  toggleMini: () => void
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  mode: readStored().mode,
  anchor: dayKeyOf(new Date()),
  miniOpen: readStored().miniOpen,

  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, miniOpen: get().miniOpen }))
    } catch {
      // 存储不可用时仅本次会话生效。
    }
    set({ mode })
  },

  setAnchor: (day) => set({ anchor: dayKeyOf(day) }),

  setMiniOpen: (open) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: get().mode, miniOpen: open }))
    } catch {
      // 存储不可用时仅本次会话生效。
    }
    set({ miniOpen: open })
  },

  toggleMini: () => get().setMiniOpen(!get().miniOpen)
}))
