import type { Project, Task } from '@shared/types'

export type StatsRange = 7 | 30

export type TrendDay = {
  // 本地日键 y-m-d，只在本模块内用于稳定 key。
  key: string
  label: string
  count: number
}

export type ProjectSlice = {
  // null 代表「无项目」，与 Task.projectId 同口径。
  id: string | null
  name: string
  color: string | null
  count: number
}

export type StatsSnapshot = {
  todayDone: number
  weekDone: number
  totalDone: number
  // 分母是「完成且设过截止时间」的任务；没有分母时给 null，界面显示 —。
  onTimeRate: number | null
  onTimeCount: number
  dueCount: number
  // 迁移 4 之前完成的行 completedAt 为 null，只计入 totalDone 与项目分布。
  untimed: number
  trend: TrendDay[]
  trendTotal: number
  distribution: ProjectSlice[]
}

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// 用本地年月日构造而不是加减毫秒：DST 切换日不是 24 小时。
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function dayLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// completedAt 是 ISO UTC 字符串；按浏览器本地日分组是渲染层的职责。
function completedTime(task: Task): number | null {
  if (!task.completed || !task.completedAt) return null
  const time = Date.parse(task.completedAt)
  return Number.isFinite(time) ? time : null
}

export function deriveStats(
  tasks: Task[],
  projects: Project[],
  now: Date,
  range: StatsRange
): StatsSnapshot {
  const today = startOfToday(now)
  const tomorrow = addDays(today, 1)
  const todayStart = today.getTime()
  const tomorrowStart = tomorrow.getTime()
  // 周一起算：周日 getDay() = 0，退 6 天；周一退 0 天。
  const monday = addDays(today, -((now.getDay() + 6) % 7))
  const weekStart = monday.getTime()

  const trendStart = addDays(today, -(range - 1))
  const trendBuckets = new Map<string, TrendDay>()
  for (let index = 0; index < range; index += 1) {
    const date = addDays(trendStart, index)
    trendBuckets.set(dayKey(date), { key: dayKey(date), label: dayLabel(date), count: 0 })
  }

  const distribution = new Map<string | null, ProjectSlice>()
  let todayDone = 0
  let weekDone = 0
  let totalDone = 0
  let untimed = 0
  let onTimeCount = 0
  let dueCount = 0

  for (const task of tasks) {
    if (!task.completed) continue
    totalDone += 1

    const project = task.projectId
      ? projects.find((item) => item.id === task.projectId)
      : undefined
    // 项目可能已被删除而任务还留着 projectId：按无项目口径归并，key 也用 null。
    const sliceKey = project?.id ?? null
    const slice = distribution.get(sliceKey) ?? {
      id: sliceKey,
      name: project?.name ?? '无项目',
      color: project?.color ?? null,
      count: 0
    }
    slice.count += 1
    distribution.set(sliceKey, slice)

    const time = completedTime(task)
    if (time === null) {
      untimed += 1
      continue
    }

    if (time >= todayStart && time < tomorrowStart) todayDone += 1
    if (time >= weekStart && time < tomorrowStart) weekDone += 1

    const bucket = trendBuckets.get(dayKey(new Date(time)))
    if (bucket) bucket.count += 1

    if (task.dueAt) {
      const dueTime = Date.parse(task.dueAt)
      if (Number.isFinite(dueTime)) {
        dueCount += 1
        if (time <= dueTime) onTimeCount += 1
      }
    }
  }

  const slices = [...distribution.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    // 同数时项目按名称，无项目压到最后，避免它抢在具体项目前面。
    if (a.id === null) return 1
    if (b.id === null) return -1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  const trend = [...trendBuckets.values()]

  return {
    todayDone,
    weekDone,
    totalDone,
    onTimeRate: dueCount === 0 ? null : onTimeCount / dueCount,
    onTimeCount,
    dueCount,
    untimed,
    trend,
    trendTotal: trend.reduce((sum, day) => sum + day.count, 0),
    distribution: slices
  }
}
