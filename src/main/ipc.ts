import { ipcMain } from 'electron'
import { z } from 'zod'
import { isValidRecurrenceRule } from '../shared/recurrence'
import {
  createProject,
  createSubtask,
  createTag,
  createTask,
  deleteProject,
  deleteSubtask,
  deleteTag,
  deleteTask,
  deleteTaskForever,
  emptyTrash,
  listDeletedTasks,
  listProjects,
  listSubtasks,
  listTags,
  listTasks,
  purgeExpiredDeleted,
  restoreTask,
  toggleTask,
  updateProject,
  updateSubtask,
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
  priority: z.number().int().min(0).max(3).optional(),
  tagIds: z.array(z.string().min(1)).max(50).optional()
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

const createSubtaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).max(500)
})

const updateSubtaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(500).optional(),
    completed: z.boolean().optional()
  })
  .refine((value) => value.title !== undefined || value.completed !== undefined, '没有要更新的字段')

const subtaskTaskIdSchema = z.object({
  taskId: z.string().min(1)
})

const createTagSchema = z.object({
  name: z.string().min(1).max(40)
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

  // 返回形状 { task: Task, spawned: Task | null }：spawned 是完成重复任务时
  // DB 在同一事务里生成的下一次实例（权威完整行），渲染层据此乐观插入。
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

  ipcMain.handle('subtasks:list', (_event, input) => {
    const { taskId } = subtaskTaskIdSchema.parse(input)
    return listSubtasks(taskId)
  })

  ipcMain.handle('subtasks:create', (_event, input) => {
    return createSubtask(createSubtaskSchema.parse(input))
  })

  ipcMain.handle('subtasks:update', (_event, input) => {
    return updateSubtask(updateSubtaskSchema.parse(input))
  })

  ipcMain.handle('subtasks:remove', (_event, input) => {
    const { id } = taskIdSchema.parse(input)
    deleteSubtask(id)
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

  ipcMain.handle('tags:list', () => listTags())

  ipcMain.handle('tags:create', (_event, input) => {
    return createTag(createTagSchema.parse(input))
  })

  // 全局删除：外键 ON DELETE CASCADE 清掉所有 task_tags 关联，任务本身不动。
  ipcMain.handle('tags:remove', (_event, input) => {
    const { id } = taskIdSchema.parse(input)
    deleteTag(id)
  })
}