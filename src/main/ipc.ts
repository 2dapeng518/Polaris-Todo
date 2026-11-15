import { ipcMain } from 'electron'
import { z } from 'zod'
import { isValidRecurrenceRule } from '../shared/recurrence'
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  deleteTaskForever,
  emptyTrash,
  listDeletedTasks,
  listProjects,
  listTasks,
  purgeExpiredDeleted,
  restoreTask,
  toggleTask,
  updateProject,
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

const updateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
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

  // Expired rows are purged before listing so the trash the user sees never
  // contains a task past its retention window.
  ipcMain.handle('tasks:list-deleted', () => {
    purgeExpiredDeleted(new Date().toISOString())
    return listDeletedTasks()
  })

  ipcMain.handle('tasks:delete-forever', (_event, input) => {
    const { id } = taskIdSchema.parse(input)
    deleteTaskForever(id)
  })

  ipcMain.handle('tasks:empty-trash', () => {
    emptyTrash()
  })

  ipcMain.handle('projects:list', () => listProjects())

  ipcMain.handle('projects:create', (_event, input) => {
    return createProject(createProjectSchema.parse(input))
  })

  ipcMain.handle('projects:update', (_event, input) => {
    return updateProject(updateProjectSchema.parse(input))
  })

  ipcMain.handle('projects:delete', (_event, input) => {
    const { id } = taskIdSchema.parse(input)
    deleteProject(id)
  })
}