import { ipcMain } from 'electron'
import { z } from 'zod'
import { isValidRecurrenceRule } from '../shared/recurrence'
import {
  createProject,
  createTask,
  deleteTask,
  listProjects,
  listTasks,
  restoreTask,
  toggleTask,
  updateTask
} from './db'

const dateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日期无效')

const recurrenceRuleSchema = z
  .string()
  .max(500)
  .refine((value) => isValidRecurrenceRule(value), '重复规则无效')

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  dueAt: dateTimeSchema.nullable().optional(),
  remindAt: dateTimeSchema.nullable().optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  projectId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional()
})

const updateTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(20000).optional(),
  completed: z.boolean().optional(),
  dueAt: dateTimeSchema.nullable().optional(),
  remindAt: dateTimeSchema.nullable().optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  projectId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional()
})

const toggleTaskSchema = z.object({
  id: z.string().min(1),
  completed: z.boolean()
})

const taskIdSchema = z.object({
  id: z.string().min(1)
})

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
})

// Split out so the smoke test can drop this one channel to exercise the
// renderer's failed-submit path, then put it back.
export function registerTaskCreate(): void {
  ipcMain.handle('tasks:create', (_event, input) => {
    return createTask(createTaskSchema.parse(input))
  })
}

export function registerIpc(): void {
  ipcMain.handle('tasks:list', () => listTasks())

  registerTaskCreate()

  ipcMain.handle('tasks:update', (_event, input) => {
    return updateTask(updateTaskSchema.parse(input))
  })

  ipcMain.handle('tasks:toggle', (_event, input) => {
    const { id, completed } = toggleTaskSchema.parse(input)
    return toggleTask(id, completed)
  })

  ipcMain.handle('tasks:delete', (_event, input) => {
    const { id } = taskIdSchema.parse(input)
    deleteTask(id)
  })

  ipcMain.handle('tasks:restore', (_event, input) => {
    const { id } = taskIdSchema.parse(input)
    return restoreTask(id)
  })

  ipcMain.handle('projects:list', () => listProjects())

  ipcMain.handle('projects:create', (_event, input) => {
    return createProject(createProjectSchema.parse(input))
  })
}