import type { Task } from '@shared/types'

// 详情排期弹层的四种类型（截止 / 时间段 / 提醒 / 重复）。
export type ScheduleKind = 'due' | 'time' | 'reminder' | 'repeat'

// 详情面板的写回补丁。与 store 的 UpdateTaskInput 对齐，但只暴露详情面板
// 会编辑的字段；tagIds 是替换式写入（见下）。
export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'completed'
    | 'dueAt'
    | 'startAt'
    | 'endAt'
    | 'allDay'
    | 'remindAt'
    | 'recurrenceRule'
    | 'projectId'
    | 'priority'
  >
> & {
  // 替换式：完整的目标标签集合；省略则不动关联。tags 本身是 DB 派生字段，
  // 不能直接写，写入走 tagIds。
  tagIds?: string[]
}

// DuePopover / ReminderPopover 的公共 props（RepeatPopover 不关闭自身，另定义）。
export type DetailPopoverProps = {
  task: Task
  onPatch: (patch: TaskPatch) => void
  onClose: () => void
}