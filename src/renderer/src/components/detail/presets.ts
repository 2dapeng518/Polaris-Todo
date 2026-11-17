import type { Task } from '@shared/types'
import type { Translate } from '../../stores/useLocaleStore'
import { todayAt, tomorrowAt } from '../../lib/dates'

// 详情弹层的纯函数预设工厂：只读时钟与任务字段，不碰 DOM / store。
// 相对预设（「1小时后」等）每次渲染重算，保持诚实；调用方只冻结种子值。

export type Preset = { label: string; value: string }

// duePresets / reminderPresets 共用的尾部整理：按 ISO 值去重（保留先出现者的
// 标签），再按时间升序。两处逻辑此前逐字相同，抽到这里保证不会各自漂移。
function dedupeAndSort(items: Preset[]): Preset[] {
  const seen = new Set<string>()
  return items
    .filter((item) => {
      if (seen.has(item.value)) return false
      seen.add(item.value)
      return true
    })
    .sort((a, b) => new Date(a.value).getTime() - new Date(b.value).getTime())
}

export function defaultReminderAt(task: Task): string {
  const now = Date.now()
  if (task.dueAt) {
    const due = new Date(task.dueAt).getTime()
    const before = due - 10 * 60 * 1000
    if (before > now + 60 * 1000) return new Date(before).toISOString()
    if (due > now + 60 * 1000) {
      return new Date(Math.min(now + 60 * 1000, due - 60 * 1000)).toISOString()
    }
  }
  return new Date(now + 60 * 60 * 1000).toISOString()
}

export function quickDuePreset(t: Translate): Preset {
  const now = Date.now()
  const minLead = 15 * 60 * 1000

  const evening = todayAt(18, 0)
  if (new Date(evening).getTime() >= now + minLead) {
    return { label: t('detail.todayAt', { time: '18:00' }), value: evening }
  }

  const tonight = todayAt(20, 0)
  if (new Date(tonight).getTime() >= now + minLead) {
    return { label: t('detail.tonightAt', { time: '20:00' }), value: tonight }
  }

  return { label: t('detail.tomorrowAt', { time: '09:00' }), value: tomorrowAt(9, 0) }
}

export function duePresets(t: Translate): Preset[] {
  return dedupeAndSort([
    { label: t('detail.hourLater'), value: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    quickDuePreset(t),
    { label: t('detail.tomorrowAt', { time: '09:00' }), value: tomorrowAt(9, 0) }
  ])
}

export function reminderPresets(task: Task, t: Translate): Preset[] {
  const now = Date.now()
  const items: Preset[] = []

  if (task.dueAt) {
    const due = new Date(task.dueAt).getTime()
    if (due > now + 60 * 1000) {
      items.push({ label: t('detail.dueAt'), value: task.dueAt })
    }
    const before10 = due - 10 * 60 * 1000
    if (before10 > now + 60 * 1000) {
      items.push({ label: t('detail.advance10'), value: new Date(before10).toISOString() })
    }
    const before60 = due - 60 * 60 * 1000
    if (before60 > now + 60 * 1000) {
      items.push({ label: t('detail.advance1h'), value: new Date(before60).toISOString() })
    }
  }

  items.push({ label: t('detail.hourLater'), value: new Date(now + 60 * 60 * 1000).toISOString() })

  const tomorrow = tomorrowAt(9, 0)
  if (new Date(tomorrow).getTime() > now + 60 * 1000) {
    items.push({ label: t('detail.tomorrowAt', { time: '09:00' }), value: tomorrow })
  }

  return dedupeAndSort(items)
}