import Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { nextOccurrence } from '../shared/recurrence'
import { isPurgeable } from '../shared/retention'
import type {
  BackupTask,
  CreateSubtaskInput,
  CreateTaskInput,
  Project,
  Subtask,
  Task,
  UpdateSubtaskInput,
  UpdateTaskInput
} from '../shared/types'

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

  if (version < 4) {
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'completed_at')) {
      // updated_at is overwritten by every later edit, so it cannot answer
      // "when was this finished". Rows completed before this migration stay
      // NULL: the real instant is unknown and guessing it would poison any
      // completion statistics built on top.
      db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT')
    }
    db.pragma('user_version = 4')
  }

  if (version < 5) {
    // 轻量检查清单：子任务只属于一个任务，不参与截止/提醒/重复/项目/优先级。
    // task_id 的级联删除是「彻底删除 / 清空回收站 / 过期清理」清掉子任务的唯一路径；
    // 软删父任务不动这张表，恢复后勾选状态原样保留。
    db.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);

      PRAGMA user_version = 5;
    `)
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
  completed_at: string | null
  due_at: string | null
  remind_at: string | null
  reminded_at: string | null
  recurrence_rule: string | null
  project_id: string | null
  priority: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  subtask_total: number
  subtask_done: number
}

type SubtaskRow = {
  id: string
  task_id: string
  title: string
  completed: number
  sort_order: number
  created_at: string
}

/** Every task read goes through this projection so the derived checklist
 *  counts are always present. The counts are computed, never stored. */
const TASK_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.completed = 1) AS subtask_done
  FROM tasks t
`

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
    completedAt: row.completed_at,
    dueAt: row.due_at,
    remindAt: row.remind_at,
    remindedAt: row.reminded_at,
    recurrenceRule: row.recurrence_rule,
    projectId: row.project_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    subtaskTotal: row.subtask_total ?? 0,
    subtaskDone: row.subtask_done ?? 0
  }
}

function mapSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    completed: row.completed === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at
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
    .prepare(`${TASK_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`)
    .get(id) as TaskRow | undefined
  return row ? mapTask(row) : undefined
}

export function listTasks(): Task[] {
  const rows = db
    .prepare(`
      ${TASK_SELECT}
      WHERE t.deleted_at IS NULL
      ORDER BY t.completed ASC,
        CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END ASC,
        t.due_at ASC,
        t.priority DESC,
        t.created_at DESC
    `)
    .all() as TaskRow[]
  return rows.map(mapTask)
}

export function listDeletedTasks(): Task[] {
  const rows = db
    .prepare(`
      ${TASK_SELECT}
      WHERE t.deleted_at IS NOT NULL
      ORDER BY t.deleted_at DESC, t.created_at DESC
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

export function updateProject(input: { id: string; name?: string; color?: string }): Project {
  const current = getProject(input.id)
  if (!current) throw new Error('项目不存在')

  const name = input.name !== undefined ? input.name.trim() : current.name
  if (!name) throw new Error('项目名称不能为空')
  const color = input.color ?? current.color
  const now = new Date().toISOString()

  db.prepare('UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?').run(
    name,
    color,
    now,
    input.id
  )

  const project = getProject(input.id)
  if (!project) throw new Error('项目更新失败')
  return project
}

export function deleteProject(id: string): void {
  // tasks.project_id 外键 ON DELETE SET NULL：删项目只把任务归「无项目」，不连带删任务。
  // 幂等：删不存在的 id 是 no-op。项目本身无回收站，删除不可恢复。
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

function getSubtask(id: string): Subtask | undefined {
  const row = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as SubtaskRow | undefined
  return row ? mapSubtask(row) : undefined
}

// 只接受活任务：getTask 过滤软删行，所以给回收站里的任务加检查项会得到「任务不存在」。
export function listSubtasks(taskId: string): Subtask[] {
  const rows = db
    .prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(taskId) as SubtaskRow[]
  return rows.map(mapSubtask)
}

export function createSubtask(input: CreateSubtaskInput): Subtask {
  const title = input.title.trim()
  if (!title) throw new Error('子任务标题不能为空')
  if (!getTask(input.taskId)) throw new Error('任务不存在')

  const id = randomUUID()
  const now = new Date().toISOString()
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM subtasks WHERE task_id = ?')
    .get(input.taskId) as { next: number }

  db.prepare(`
    INSERT INTO subtasks (id, task_id, title, completed, sort_order, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(id, input.taskId, title, next.next, now)

  const subtask = getSubtask(id)
  if (!subtask) throw new Error('子任务创建失败')
  return subtask
}

export function updateSubtask(input: UpdateSubtaskInput): Subtask {
  const current = getSubtask(input.id)
  if (!current) throw new Error('子任务不存在')

  const title = input.title !== undefined ? input.title.trim() : current.title
  if (!title) throw new Error('子任务标题不能为空')
  const completed = input.completed !== undefined ? input.completed : current.completed

  db.prepare('UPDATE subtasks SET title = ?, completed = ? WHERE id = ?').run(
    title,
    completed ? 1 : 0,
    input.id
  )

  const subtask = getSubtask(input.id)
  if (!subtask) throw new Error('子任务更新失败')
  return subtask
}

export function deleteSubtask(id: string): void {
  db.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
}

// 导出全量项目、任务（含回收站软删行）与子任务，供备份。时间戳原样保留，恢复时不失真。
// 子任务按 task_id 平铺导出；导入时再按父任务是否落地决定去留。
export function exportBackup(): { projects: Project[]; tasks: Task[]; subtasks: Subtask[] } {
  const projects = listProjects()
  const rows = db
    .prepare(`${TASK_SELECT} ORDER BY t.created_at ASC`)
    .all() as TaskRow[]
  const subtasks = db
    .prepare('SELECT * FROM subtasks ORDER BY task_id ASC, sort_order ASC, created_at ASC')
    .all() as SubtaskRow[]
  return { projects, tasks: rows.map(mapTask), subtasks: subtasks.map(mapSubtask) }
}

export type ImportCounts = {
  projectsImported: number
  projectsSkipped: number
  tasksImported: number
  tasksSkipped: number
  subtasksImported: number
  subtasksSkipped: number
}

// 非破坏性按 ID 合并：已存在的行跳过（绝不覆盖/删除本地数据），新行插入。
// 先插项目再插任务；任务的 projectId 仅在该项目存在时保留，否则归「无项目」，
// 避免外键违约。整体在一个事务里，要么全成要么全不成。
// 旧备份（schemaVersion 1）没有 subtasks 字段，按「没有检查清单数据」处理。
export function importBackup(data: {
  projects: Project[]
  tasks: BackupTask[]
  subtasks?: Subtask[]
}): ImportCounts {
  const counts: ImportCounts = {
    projectsImported: 0,
    projectsSkipped: 0,
    tasksImported: 0,
    tasksSkipped: 0,
    subtasksImported: 0,
    subtasksSkipped: 0
  }
  const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?')
  const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?')
  const subtaskExists = db.prepare('SELECT 1 FROM subtasks WHERE id = ?')
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, completed_at, due_at, remind_at, reminded_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertSubtask = db.prepare(`
    INSERT INTO subtasks (id, task_id, title, completed, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const run = db.transaction(() => {
    for (const project of data.projects) {
      if (projectExists.get(project.id)) {
        counts.projectsSkipped += 1
        continue
      }
      insertProject.run(project.id, project.name, project.color, project.sortOrder, project.createdAt, project.updatedAt)
      counts.projectsImported += 1
    }
    for (const task of data.tasks) {
      if (taskExists.get(task.id)) {
        counts.tasksSkipped += 1
        continue
      }
      const projectId = task.projectId && projectExists.get(task.projectId) ? task.projectId : null
      insertTask.run(
        task.id,
        task.title,
        task.notes,
        task.completed ? 1 : 0,
        task.completedAt,
        task.dueAt,
        task.remindAt,
        task.remindedAt,
        task.recurrenceRule,
        projectId,
        task.priority,
        task.createdAt,
        task.updatedAt,
        task.deletedAt
      )
      counts.tasksImported += 1
    }
    // 子任务依赖父任务：父任务已存在（本地原有或本轮刚插入）才恢复；
    // 孤儿子任务（父任务缺失）直接跳过，绝不制造外键违约。
    for (const subtask of data.subtasks ?? []) {
      if (subtaskExists.get(subtask.id) || !taskExists.get(subtask.taskId)) {
        counts.subtasksSkipped += 1
        continue
      }
      insertSubtask.run(
        subtask.id,
        subtask.taskId,
        subtask.title,
        subtask.completed ? 1 : 0,
        subtask.sortOrder,
        subtask.createdAt
      )
      counts.subtasksImported += 1
    }
  })
  run()
  return counts
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
  // Stamp the transition, not the row: re-completing keeps the first instant,
  // un-completing clears it, and unrelated edits never touch it.
  const completedAt = !next.completed
    ? null
    : existing.completed
      ? existing.completedAt
      : now

  const write = db.transaction(() => {
    db.prepare(`
      UPDATE tasks
      SET title = ?, notes = ?, completed = ?, completed_at = ?, due_at = ?, remind_at = ?, reminded_at = ?, recurrence_rule = ?, project_id = ?, priority = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.notes,
      next.completed ? 1 : 0,
      completedAt,
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
      const spawnedId = randomUUID()
      db.prepare(`
        INSERT INTO tasks (id, title, notes, completed, due_at, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        spawnedId,
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

      // 检查清单随下一次实例复制，勾选状态全部重置；当前实例保留自己的勾选状态。
      // 复制发生在上面的同一事务里，任务与子任务不会只成一半。
      const template = db
        .prepare(
          'SELECT title, sort_order FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC'
        )
        .all(input.id) as Array<{ title: string; sort_order: number }>
      if (template.length > 0) {
        const insertSubtask = db.prepare(`
          INSERT INTO subtasks (id, task_id, title, completed, sort_order, created_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `)
        for (const subtask of template) {
          insertSubtask.run(randomUUID(), spawnedId, subtask.title, subtask.sort_order, now)
        }
      }
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

// Idempotent hard delete, scoped to soft-deleted rows so a live task can never
// be destroyed through this path. No existence check: getTask filters deleted
// rows out, so it cannot answer "is this row in the trash".
export function deleteTaskForever(id: string): void {
  db.prepare('DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL').run(id)
}

export function emptyTrash(): void {
  db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL').run()
}

// Retention cleanup. isPurgeable in shared/retention.ts is the single authority
// on what expires, so every candidate row is asked in JS — no SQL cutoff that
// could drift from it. The clock is injected like listDueReminders.
export function purgeExpiredDeleted(now: string): void {
  const rows = db
    .prepare('SELECT id, deleted_at FROM tasks WHERE deleted_at IS NOT NULL')
    .all() as Array<{ id: string; deleted_at: string | null }>
  const instant = new Date(now)
  const expiredIds = rows
    .filter((row) => isPurgeable(row.deleted_at, instant))
    .map((row) => row.id)
  if (expiredIds.length === 0) return

  const purge = db.transaction((ids: string[]) => {
    const remove = db.prepare('DELETE FROM tasks WHERE id = ?')
    for (const id of ids) remove.run(id)
  })
  purge(expiredIds)
}

export function listDueReminders(now: string): Task[] {
  const rows = db
    .prepare(`
      ${TASK_SELECT}
      WHERE t.deleted_at IS NULL
        AND t.completed = 0
        AND t.remind_at IS NOT NULL
        AND t.remind_at <= ?
        AND (t.reminded_at IS NULL OR t.reminded_at < t.remind_at)
      ORDER BY t.remind_at ASC
    `)
    .all(now) as TaskRow[]
  return rows.map(mapTask)
}

export function markTaskReminded(id: string, at: string): void {
  db.prepare('UPDATE tasks SET reminded_at = ? WHERE id = ?').run(at, id)
}