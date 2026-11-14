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

export type AppView = 'today' | 'upcoming' | 'all' | 'completed'

import type { AppTheme } from './themes'

export type { AppTheme }

export type AutoStartState = {
  enabled: boolean
  supported: boolean
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
  }
  projects: {
    list: () => Promise<Project[]>
    create: (input: CreateProjectInput) => Promise<Project>
  }
  app: {
    platform: string
    getVersion: () => Promise<string>
    setTheme: (theme: AppTheme) => Promise<void>
    getAutoStart: () => Promise<AutoStartState>
    setAutoStart: (enabled: boolean) => Promise<AutoStartState>
  }
  reminder: {
    dismiss: () => Promise<void>
  }
}