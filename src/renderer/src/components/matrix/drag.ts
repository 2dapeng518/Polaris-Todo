import { startOfDay } from 'date-fns'
import type { Task } from '@shared/types'
import type { QuadrantId } from './matching'

// 任务拖拽的 dataTransfer 类型。卡片换位不走 HTML5 DnD（需要整张卡片跟手
// 的浮层效果），由 MatrixView 的指针手势处理，两边互不干扰。
export const MATRIX_TASK_MIME = 'application/x-polaris-matrix-task'

export type MatrixDropPatch = {
  priority?: number
  dueAt?: string
}

function isUrgentDue(dueAt: string | null, now: Date): boolean {
  if (!dueAt) return false
  return startOfDay(new Date(dueAt)).getTime() <= startOfDay(now).getTime()
}

// 以注入时钟构造本地墙钟时刻再转 ISO——与库内 dueAt 的语义一致，也让
// 冒烟/测试的注入时钟生效。
function atLocal(now: Date, dayOffset: number, hour: number, minute: number): string {
  const date = new Date(now)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

// 拖到目标象限时需要的字段改写：按目标象限「默认语义」调整重要性与紧急性
// （do/plan 重要、do/quick 紧急）。
// - 重要性：跨档时才改（重要档最低给「中」，非重要档最高给「低」），保留
//   用户已设的高/低优先级，不做无谓改写。
// - 紧急性：只有方向不匹配时才动日期——拖进紧急格且不紧急 → 今天 23:59；
//   拖进非紧急格且正紧急 → 明天 09:00（不直接清空，避免静默丢日期）。
// 若目标象限用的是自定义筛选，改写后仍可能不命中，任务会按级联规则落到
// 别的格——这是可配置筛选的固有代价，拖拽只保证「默认语义下成立」。
export function quadrantDropPatch(target: QuadrantId, task: Task, now: Date): MatrixDropPatch {
  const patch: MatrixDropPatch = {}
  const important = target === 'do' || target === 'plan'
  const urgent = target === 'do' || target === 'quick'

  if (important) {
    if (task.priority < 2) patch.priority = 2
  } else if (task.priority >= 2) {
    patch.priority = 1
  }

  const currentlyUrgent = isUrgentDue(task.dueAt, now)
  if (urgent && !currentlyUrgent) patch.dueAt = atLocal(now, 0, 23, 59)
  else if (!urgent && currentlyUrgent) patch.dueAt = atLocal(now, 1, 9, 0)

  return patch
}

// 手动排序重排：把 draggedId 插到 beforeId 之前（beforeId 为 null = 追加
// 到末尾）。current 必须是当前渲染顺序（含未知 id），保证未上榜的新任务
// 不会因为一次拖动被丢掉。
export function reorderIds(
  current: readonly string[],
  draggedId: string,
  beforeId: string | null
): string[] {
  const rest = current.filter((id) => id !== draggedId)
  if (!beforeId) {
    rest.push(draggedId)
    return rest
  }
  const index = rest.indexOf(beforeId)
  if (index < 0) rest.push(draggedId)
  else rest.splice(index, 0, draggedId)
  return rest
}

// 拖入手动排序的象限：追加到该格末尾（不插队）。
export function appendId(current: readonly string[], id: string): string[] {
  return current.includes(id) ? [...current] : [...current, id]
}