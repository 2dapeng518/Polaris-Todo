export type Task = {
  id: string
  title: string
  notes: string
  completed: boolean
  /** When the task was finished. Null while active, and null for rows completed
   *  before migration 4 — the instant was never recorded. Set by the DB, never
   *  supplied by the renderer. */
  completedAt: string | null
  dueAt: string | null
  remindAt: string | null
  remindedAt: string | null
  recurrenceRule: string | null
  projectId: string | null
  priority: number
  createdAt: string
  updatedAt: string
  /** When the task was soft-deleted into the trash. Null while the task is
   *  live. Set by the DB on delete and cleared on restore, never supplied by
   *  the renderer. */
  deletedAt: string | null
  /** Derived checklist progress, computed by the DB on every read. Never part
   *  of CreateTaskInput/UpdateTaskInput and never stored on the task row. */
  subtaskTotal: number
  subtaskDone: number
  /** Associated tags, derived by the DB on every read (ordered by name).
   *  UpdateTaskInput.tagIds is the only write path; never stored on the task
   *  row itself. */
  tags: Tag[]
}

/** A global label. Tags have no colour, due date or hierarchy — they are an
 *  organisation axis orthogonal to projects, so a task can carry several. */
export type Tag = {
  id: string
  name: string
  createdAt: string
}

export type CreateTagInput = {
  name: string
}

/** A lightweight checklist item. Subtasks carry no due date, reminder,
 *  recurrence, project or priority — they belong to exactly one task. */
export type Subtask = {
  id: string
  taskId: string
  title: string
  completed: boolean
  sortOrder: number
  createdAt: string
}

export type CreateSubtaskInput = {
  taskId: string
  title: string
}

export type UpdateSubtaskInput = {
  id: string
  title?: string
  completed?: boolean
}

export type Project = {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type CreateTaskInput = {
  title: string
  dueAt?: string | null
  remindAt?: string | null
  recurrenceRule?: string | null
  projectId?: string | null
  priority?: number
}

export type UpdateTaskInput = {
  id: string
  title?: string
  notes?: string
  completed?: boolean
  dueAt?: string | null
  remindAt?: string | null
  recurrenceRule?: string | null
  projectId?: string | null
  priority?: number
  /** Replacement semantics: the full desired tag set. Omitted leaves the
   *  associations untouched; an empty array clears them. Unknown ids are
   *  dropped rather than rejected so a stale renderer cannot fail a save. */
  tagIds?: string[]
}

export type CreateProjectInput = {
  name: string
  color: string
}

export type UpdateProjectInput = {
  id: string
  name?: string
  color?: string
}

/** Backup rows carry no derived counts or tags: both are recomputed from the
 *  subtasks and task_tags tables after an import, and an old backup has no
 *  such field at all. */
export type BackupTask = Omit<Task, 'subtaskTotal' | 'subtaskDone' | 'tags'>

/** schemaVersion 3 added the tags and taskTags arrays. Imports still accept
 *  versions 1 and 2, where those arrays are absent and mean "no tag data". */
export type BackupData = {
  schemaVersion: 3
  app: 'polaris'
  exportedAt: string
  projects: Project[]
  tasks: BackupTask[]
  tags: Tag[]
  taskTags: TaskTag[]
  subtasks: Subtask[]
}

/** One row of the task_tags join table. */
export type TaskTag = {
  taskId: string
  tagId: string
}

export type ExportResult = { saved: boolean; path?: string; error?: string }

export type ImportResult = {
  ok: boolean
  canceled?: boolean
  projectsImported?: number
  projectsSkipped?: number
  tasksImported?: number
  tasksSkipped?: number
  subtasksImported?: number
  subtasksSkipped?: number
  tagsImported?: number
  tagsSkipped?: number
  taskTagsImported?: number
  taskTagsSkipped?: number
  error?: string
}

export type CsvImportResult = {
  ok: boolean
  canceled?: boolean
  format?: 'standard' | 'legacy'
  tasksImported?: number
  tasksSkipped?: number
  projectsImported?: number
  subtasksImported?: number
  tagsImported?: number
  error?: string
}

export type AppView = 'today' | 'upcoming' | 'calendar' | 'all' | 'completed' | 'stats' | 'matrix' | 'trash'

import type { AppTheme } from './themes'

export type { AppTheme }

export type AutoStartState = {
  enabled: boolean
  supported: boolean
  error?: string
}

/** 全局热键的期望状态与实际注册状态分开：组合键被别的程序占用时，
 *  enabled 仍是用户的选择（开），registered 才是这次注册的结果。 */
export type GlobalHotkeyState = {
  enabled: boolean
  registered: boolean
  accelerator: string
  error?: string
}

export type McpState = {
  enabled: boolean
  running: boolean
  endpoint: string
  error?: string
}

/** 在线更新状态机。unsupported = 开发/未打包环境没有更新通道；
 *  available → downloading → downloaded 由 electron-updater 事件驱动，
 *  渲染层只消费快照，不自己推算进度。 */
export type UpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  /** 检查到的新版本号；没查到或还没查时为 null。 */
  latestVersion: string | null
  /** 下载进度 0-100，仅 downloading 期间有意义，其余为 null。 */
  percent: number | null
  /** 更新说明（来自 GitHub Release 正文），无则 null。 */
  releaseNotes: string | null
  /** 用户点过「跳过此版本」的版本号；自动检查命中它时保持安静。 */
  skippedVersion: string | null
  error: string | null
}

export type PolarisApi = {
  tasks: {
    list: () => Promise<Task[]>
    create: (input: CreateTaskInput) => Promise<Task>
    update: (input: UpdateTaskInput) => Promise<Task>
    toggle: (id: string, completed: boolean) => Promise<Task>
    remove: (id: string) => Promise<void>
    restore: (id: string) => Promise<Task>
    listDeleted: () => Promise<Task[]>
    deleteForever: (id: string) => Promise<void>
    emptyTrash: () => Promise<void>
  }
  projects: {
    list: () => Promise<Project[]>
    create: (input: CreateProjectInput) => Promise<Project>
    update: (input: UpdateProjectInput) => Promise<Project>
    remove: (id: string) => Promise<void>
  }
  subtasks: {
    list: (taskId: string) => Promise<Subtask[]>
    create: (input: CreateSubtaskInput) => Promise<Subtask>
    update: (input: UpdateSubtaskInput) => Promise<Subtask>
    remove: (id: string) => Promise<void>
  }
  tags: {
    list: () => Promise<Tag[]>
    create: (input: CreateTagInput) => Promise<Tag>
    remove: (id: string) => Promise<void>
  }
  data: {
    export: () => Promise<ExportResult>
    import: () => Promise<ImportResult>
    importCsv: () => Promise<CsvImportResult>
  }
  app: {
    getVersion: () => Promise<string>
    setTheme: (theme: AppTheme) => Promise<void>
    getAutoStart: () => Promise<AutoStartState>
    setAutoStart: (enabled: boolean) => Promise<AutoStartState>
    getCloseToTray: () => Promise<boolean>
    setCloseToTray: (enabled: boolean) => Promise<boolean>
    getGlobalHotkey: () => Promise<GlobalHotkeyState>
    setGlobalHotkey: (enabled: boolean) => Promise<GlobalHotkeyState>
    getMcp: () => Promise<McpState>
    setMcp: (enabled: boolean) => Promise<McpState>
  }
  update: {
    getState: () => Promise<UpdateState>
    /** 手动检查：忽略「跳过此版本」，用户主动问就要给答案。 */
    check: () => Promise<UpdateState>
    /** 跳过指定版本（渲染层正在展示的那个）；自动检查不再为它弹窗。 */
    skip: (version: string) => Promise<UpdateState>
    /** 退出并安装已下载好的更新（quitAndInstall）。 */
    install: () => Promise<void>
    /** 订阅主进程推送的状态快照，返回取消订阅函数。 */
    onState: (callback: (state: UpdateState) => void) => () => void
  }
  reminder: {
    dismiss: () => Promise<void>
  }
}