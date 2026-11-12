import Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { nextOccurrence } from '../shared/recurrence'
import type { CreateTaskInput, Project, Task, UpdateTaskInput } from '../shared/types'

let db: Database.Database

export function initDatabase(): void {
  const directory = app.getPath('userData')
  mkdirSync(directory, { recursive: true })
  db = new Database(join(directory, 'polaris.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate()
  seedIfNeeded()
}

// Small key/value reads on the meta table created by migration 1. No new
// migration is needed for app-level settings such as the theme.
export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

function migrate(): void {
  let version = db.pragma('user_version', { simple: true }) as number

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#5EEAD4',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        completed INTEGER NOT NULL DEFAULT 0,
        due_at TEXT,
        remind_at TEXT,
        reminded_at TEXT,
        recurrence_rule TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `)
    version = 1
  }

  if (version < 2) {
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'reminded_at')) {
      db.exec('ALTER TABLE tasks ADD COLUMN reminded_at TEXT')
    }
    db.pragma('user_version = 2')
  }

  if (version < 3) {
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'recurrence_rule')) {
      db.exec('ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT')
    }
    db.pragma('user_version = 3')
  }
}

function seedIfNeeded(): void {
  const seeded = db.prepare('SELECT value FROM meta WHERE key = ?').get('demo_seeded') as
    | { value: string }
    | undefined
  if (seeded) return

  const now = new Date()
  const stamp = now.toISOString()

  const at = (dayOffset: number, hour: number, minute = 0): string => {
    const date = new Date(now)
    date.setDate(date.getDate() + dayOffset)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
  }

  const polarisProjectId = randomUUID()
  const personalProjectId = randomUUID()

  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, due_at, remind_at, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const seed = db.transaction(() => {
    insertProject.run(polarisProjectId, 'Polaris', '#5EEAD4', 0, stamp, stamp)
    insertProject.run(personalProjectId, '个人', '#A78BFA', 1, stamp, stamp)

    const tasks: Array<{
      title: string
      completed: number
      dueAt: string
      projectId: string
      priority: number
    }> = [
      { title: '完成 Polaris 的界面设计', completed: 0, dueAt: at(0, 18), projectId: polarisProjectId, priority: 2 },
      { title: '梳理本周的任务清单', completed: 0, dueAt: at(0, 20), projectId: personalProjectId, priority: 1 },
      { title: '给妈妈打个电话', completed: 1, dueAt: at(0, 19, 30), projectId: personalProjectId, priority: 0 },
      { title: '整理下载文件夹', completed: 1, dueAt: at(0, 12), projectId: personalProjectId, priority: 0 },
      { title: '阅读《设计中的设计》第三章', completed: 0, dueAt: at(1, 21), projectId: personalProjectId, priority: 0 },
      { title: '预约周五的牙医', completed: 0, dueAt: at(1, 10), projectId: personalProjectId, priority: 2 }
    ]

    for (const task of tasks) {
      insertTask.run(
        randomUUID(),
        task.title,
        '',
        task.completed,
        task.dueAt,
        null,
        task.projectId,
        task.priority,
        stamp,
        stamp,
        null
      )
    }

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('demo_seeded', '1')
  })

  seed()
}

type TaskRow = {
  id: string
  title: string
  notes: string
  completed: number
  due_at: string | null
  remind_at: string | null
  reminded_at: string | null
  recurrence_rule: string | null
  project_id: string | null
  priority: number
  created_at: string
  updated_at: string
}

type ProjectRow = {
  id: string
  name: string
  color: string
  sort_order: number
  created_at: string
  updated_at: string
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    completed: row.completed === 1,
    dueAt: row.due_at,
    remindAt: row.remind_at,
    remindedAt: row.reminded_at,
    recurrenceRule: row.recurrence_rule,
    projectId: row.project_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getTask(id: string): Task | undefined {
  const row = db
    .prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL')
    .get(id) as TaskRow | undefined
  return row ? mapTask(row) : undefined
}

export function listTasks(): Task[] {
  const rows = db
    .prepare(`
      SELECT * FROM tasks
      WHERE deleted_at IS NULL
      ORDER BY completed ASC,
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC,
        due_at ASC,
        created_at DESC
    `)
    .all() as TaskRow[]
  return rows.map(mapTask)
}

export function listProjects(): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects ORDER BY sort_order ASC, created_at ASC')
    .all() as ProjectRow[]
  return rows.map(mapProject)
}

function getProject(id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  return row ? mapProject(row) : undefined
}

export function createProject(input: { name: string; color: string }): Project {
  const name = input.name.trim()
  if (!name) throw new Error('项目名称不能为空')

  const id = randomUUID()
  const now = new Date().toISOString()
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM projects')
    .get() as { next: number }

  db.prepare(`
    INSERT INTO projects (id, name, color, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, input.color, next.next, now, now)

  const project = getProject(id)
  if (!project) throw new Error('项目创建失败')
  return project
}

export function createTask(input: CreateTaskInput): Task {
  const title = input.title.trim()
  if (!title) throw new Error('任务标题不能为空')
  if (input.recurrenceRule && !input.dueAt) throw new Error('重复任务需要截止时间')

  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, due_at, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, '', 0, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    title,
    input.dueAt ?? null,
    input.remindAt ?? null,
    input.recurrenceRule ?? null,
    input.projectId ?? null,
    input.priority ?? 0,
    now,
    now
  )

  const task = getTask(id)
  if (!task) throw new Error('任务创建失败')
  return task
}

export function updateTask(input: UpdateTaskInput): Task {
  const existing = getTask(input.id)
  if (!existing) throw new Error('任务不存在')

  const reminderChanged =
    input.remindAt !== undefined && input.remindAt !== existing.remindAt

  const next = {
    title: input.title !== undefined ? input.title.trim() : existing.title,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    completed: input.completed !== undefined ? input.completed : existing.completed,
    dueAt: input.dueAt !== undefined ? input.dueAt : existing.dueAt,
    remindAt: input.remindAt !== undefined ? input.remindAt : existing.remindAt,
    remindedAt: reminderChanged ? null : existing.remindedAt,
    recurrenceRule:
      input.recurrenceRule !== undefined ? input.recurrenceRule : existing.recurrenceRule,
    projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
    priority: input.priority !== undefined ? input.priority : existing.priority
  }

  if (!next.title) throw new Error('任务标题不能为空')
  if (next.recurrenceRule && !next.dueAt) throw new Error('重复任务需要截止时间')

  const completingRecurrence = Boolean(
    input.completed === true && !existing.completed && next.recurrenceRule && next.dueAt
  )
  const nextDate = completingRecurrence
    ? nextOccurrence(next.dueAt, next.recurrenceRule)
    : null
  const reminderOffset =
    next.dueAt && next.remindAt
      ? new Date(next.dueAt).getTime() - new Date(next.remindAt).getTime()
      : null
  const maxReminderOffset = 7 * 24 * 60 * 60 * 1000
  const spawnedRemindAt =
    nextDate &&
    reminderOffset !== null &&
    reminderOffset >= 0 &&
    reminderOffset <= maxReminderOffset
      ? new Date(nextDate.getTime() - reminderOffset).toISOString()
      : null
  const storedRule = completingRecurrence ? null : next.recurrenceRule
  const now = new Date().toISOString()

  const write = db.transaction(() => {
    db.prepare(`
      UPDATE tasks
      SET title = ?, notes = ?, completed = ?, due_at = ?, remind_at = ?, reminded_at = ?, recurrence_rule = ?, project_id = ?, priority = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.notes,
      next.completed ? 1 : 0,
      next.dueAt,
      next.remindAt,
      next.remindedAt,
      storedRule,
      next.projectId,
      next.priority,
      now,
      input.id
    )

    if (nextDate) {
      db.prepare(`
        INSERT INTO tasks (id, title, notes, completed, due_at, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        randomUUID(),
        next.title,
        next.notes,
        nextDate.toISOString(),
        spawnedRemindAt,
        next.recurrenceRule,
        next.projectId,
        next.priority,
        now,
        now
      )
    }
  })

  write()

  const updated = getTask(input.id)
  if (!updated) throw new Error('任务更新失败')
  return updated
}

export function toggleTask(id: string, completed: boolean): Task {
  return updateTask({ id, completed })
}

export function deleteTask(id: string): void {
  const now = new Date().toISOString()
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

export function restoreTask(id: string): Task {
  const now = new Date().toISOString()
  db.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id)

  const task = getTask(id)
  if (!task) throw new Error('任务恢复失败')
  return task
}

export function listDueReminders(now: string): Task[] {
  const rows = db
    .prepare(`
      SELECT * FROM tasks
      WHERE deleted_at IS NULL
        AND completed = 0
        AND remind_at IS NOT NULL
        AND remind_at <= ?
        AND (reminded_at IS NULL OR reminded_at < remind_at)
      ORDER BY remind_at ASC
    `)
    .all(now) as TaskRow[]
  return rows.map(mapTask)
}

export function markTaskReminded(id: string, at: string): void {
  db.prepare('UPDATE tasks SET reminded_at = ? WHERE id = ?').run(at, id)
}