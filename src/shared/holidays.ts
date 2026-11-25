// 法定节假日与调休休/班数据集（日历套件 P3.2）。数据来源为国务院办公厅
// 年度安排原文，按年内置、逐年更新；未收录的年份静默无标记（不猜测）。
// 2025：国办发明电〔2024〕7 号；2026：国办发明电〔2025〕号（2025-11-04 发布，
// 中国政府网 2025 年第 12406 期公报）。
//
// date 用 MM-DD 本地日键片段，展开后按 yyyy-MM-dd 查询。kind: holiday = 休，
// workday = 调休补班的「班」。

export type HolidayKind = 'holiday' | 'workday'

export type HolidayEntry = {
  /** MM-DD（当年内的本地日期片段）。 */
  date: string
  name: string
  kind: HolidayKind
}

export const HOLIDAY_DATASETS: Readonly<Record<number, readonly HolidayEntry[]>> = {
  2025: [
    ...expandRange(2025, 1, 1, 1, 1, '元旦'),
    ...expandRange(2025, 1, 28, 2, 4, '春节'),
    ...expandRange(2025, 4, 4, 4, 6, '清明节'),
    ...expandRange(2025, 5, 1, 5, 5, '劳动节'),
    ...expandRange(2025, 5, 31, 6, 2, '端午节'),
    ...expandRange(2025, 10, 1, 10, 8, '国庆节·中秋节'),
    { date: '01-26', name: '春节', kind: 'workday' },
    { date: '02-08', name: '春节', kind: 'workday' },
    { date: '04-27', name: '劳动节', kind: 'workday' },
    { date: '09-28', name: '国庆节·中秋节', kind: 'workday' },
    { date: '10-11', name: '国庆节·中秋节', kind: 'workday' }
  ],
  2026: [
    ...expandRange(2026, 1, 1, 1, 3, '元旦'),
    ...expandRange(2026, 2, 15, 2, 23, '春节'),
    ...expandRange(2026, 4, 4, 4, 6, '清明节'),
    ...expandRange(2026, 5, 1, 5, 5, '劳动节'),
    ...expandRange(2026, 6, 19, 6, 21, '端午节'),
    ...expandRange(2026, 9, 25, 9, 27, '中秋节'),
    ...expandRange(2026, 10, 1, 10, 7, '国庆节'),
    { date: '01-04', name: '元旦', kind: 'workday' },
    { date: '02-14', name: '春节', kind: 'workday' },
    { date: '02-28', name: '春节', kind: 'workday' },
    { date: '05-09', name: '劳动节', kind: 'workday' },
    { date: '09-20', name: '国庆节', kind: 'workday' },
    { date: '10-10', name: '国庆节', kind: 'workday' }
  ]
}

// 跨月的假期区间（春节 1/28–2/4）按真实日历日展开，不做 31 天截断。
function expandRange(
  year: number,
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number,
  name: string
): HolidayEntry[] {
  const entries: HolidayEntry[] = []
  const cursor = new Date(year, startMonth - 1, startDay)
  const end = new Date(year, endMonth - 1, endDay)
  while (cursor.getTime() <= end.getTime()) {
    const month = String(cursor.getMonth() + 1).padStart(2, '0')
    const day = String(cursor.getDate()).padStart(2, '0')
    entries.push({ date: `${month}-${day}`, name, kind: 'holiday' })
    cursor.setDate(cursor.getDate() + 1)
  }
  return entries
}

const BY_DAY = new Map<string, { name: string; kind: HolidayKind }>()
for (const [year, entries] of Object.entries(HOLIDAY_DATASETS)) {
  for (const entry of entries) {
    BY_DAY.set(`${year}-${entry.date}`, { name: entry.name, kind: entry.kind })
  }
}

/** 查某本地日的节假日/调休标记；未收录年份或普通日子返回 null。 */
export function holidayOf(date: Date): { name: string; kind: HolidayKind } | null {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
  return BY_DAY.get(key) ?? null
}
