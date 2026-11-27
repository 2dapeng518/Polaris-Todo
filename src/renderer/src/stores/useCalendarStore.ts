import { create } from 'zustand'

// 日历套件的视图偏好：子视图模式（年/月/周/日/日程/多日/多周）、迷你月历
// 开关、显示开关（农历/节假日/周数）、全部子视图共享的锚点日，以及日历内
// 的搜索词与项目/标签筛选。纯视图偏好住 localStorage（同 useSidebarStore
// 的先例），不进 meta 表，也不走 IPC；搜索与筛选是查询意图，只留会话，
// 不持久化。默认月视图 + 迷你月历收起 + 全部显示开关关闭——所有既有布局
// 与冒烟断言都量这个默认态。

export type CalendarMode = 'year' | 'month' | 'week' | 'multiweek' | 'day' | 'multiday' | 'list'

// 顺序即切换器顺序：年 / 月 / 周 / 日 / 日程 / 多日 / 多周。
// list 保留旧 id（localStorage 里已存的偏好不作废），只把显示名改成「日程」。
const MODES: readonly CalendarMode[] = ['year', 'month', 'week', 'day', 'list', 'multiday', 'multiweek']

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

type StoredView = {
  mode?: unknown
  miniOpen?: unknown
  showLunar?: unknown
  showHolidays?: unknown
  showWeekNumbers?: unknown
}

type StoredPrefs = { mode: CalendarMode; miniOpen: boolean; showLunar: boolean; showHolidays: boolean; showWeekNumbers: boolean }

function readStored(): StoredPrefs {
  const fallback: StoredPrefs = {
    mode: 'month',
    miniOpen: false,
    showLunar: false,
    showHolidays: false,
    showWeekNumbers: false
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as StoredView
    return {
      mode: isCalendarMode(parsed.mode) ? parsed.mode : fallback.mode,
      miniOpen: parsed.miniOpen === true,
      showLunar: parsed.showLunar === true,
      showHolidays: parsed.showHolidays === true,
      showWeekNumbers: parsed.showWeekNumbers === true
    }
  } catch {
    return fallback
  }
}

type CalendarState = {
  mode: CalendarMode
  /** 共享锚点日（本地日键）：月视图取所在月，周/日视图取所在周/日。 */
  anchor: string
  miniOpen: boolean
  /** 显示开关（月格信息层，P3）：农历/节假日休班标记/周数列。 */
  showLunar: boolean
  showHolidays: boolean
  showWeekNumbers: boolean
  /** 日历内搜索与筛选（P3.5）：查询意图只留会话，不持久化；互斥同主列表。 */
  calendarSearch: string
  calendarProjectFilter: string | null
  calendarTagFilter: string | null
  setMode: (mode: CalendarMode) => void
  setAnchor: (day: Date) => void
  setMiniOpen: (open: boolean) => void
  toggleMini: () => void
  setShowLunar: (show: boolean) => void
  setShowHolidays: (show: boolean) => void
  setShowWeekNumbers: (show: boolean) => void
  setCalendarSearch: (text: string) => void
  setCalendarProjectFilter: (id: string | null) => void
  setCalendarTagFilter: (id: string | null) => void
}

export const useCalendarStore = create<CalendarState>((set, get) => {
  const persist = (): void => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode: get().mode,
          miniOpen: get().miniOpen,
          showLunar: get().showLunar,
          showHolidays: get().showHolidays,
          showWeekNumbers: get().showWeekNumbers
        })
      )
    } catch {
      // 存储不可用时仅本次会话生效。
    }
  }

  return {
    mode: readStored().mode,
    anchor: dayKeyOf(new Date()),
    miniOpen: readStored().miniOpen,
    showLunar: readStored().showLunar,
    showHolidays: readStored().showHolidays,
    showWeekNumbers: readStored().showWeekNumbers,
    calendarSearch: '',
    calendarProjectFilter: null,
    calendarTagFilter: null,

    setMode: (mode) => {
      set({ mode })
      persist()
    },

    setAnchor: (day) => set({ anchor: dayKeyOf(day) }),

    setMiniOpen: (open) => {
      set({ miniOpen: open })
      persist()
    },

    toggleMini: () => get().setMiniOpen(!get().miniOpen),

    setShowLunar: (show) => {
      set({ showLunar: show })
      persist()
    },

    setShowHolidays: (show) => {
      set({ showHolidays: show })
      persist()
    },

    setShowWeekNumbers: (show) => {
      set({ showWeekNumbers: show })
      persist()
    },

    setCalendarSearch: (text) => set({ calendarSearch: text }),

    // 项目与标签筛选互斥（语义同主列表的 projectFilter/tagFilter）。
    setCalendarProjectFilter: (id) =>
      set({ calendarProjectFilter: id, calendarTagFilter: null }),
    setCalendarTagFilter: (id) =>
      set({ calendarTagFilter: id, calendarProjectFilter: null })
  }
})
