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

export type BackupData = {
  schemaVersion: 1
  app: 'polaris'
  exportedAt: string
  projects: Project[]
  tasks: Task[]
}

export type ExportResult = { saved: boolean; path?: string; error?: string }

export type ImportResult = {
  ok: boolean
  canceled?: boolean
  projectsImported?: number
  projectsSkipped?: number
  tasksImported?: number
  tasksSkipped?: number
  error?: string
}

export type AppView = 'today' | 'upcoming' | 'all' | 'completed' | 'stats' | 'trash'

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
  data: {
    export: () => Promise<ExportResult>
    import: () => Promise<ImportResult>
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
  }
  reminder: {
    dismiss: () => Promise<void>
  }
}