import Database from 'better-sqlite3'
import { app } from 'electron'
import log from 'electron-log/main'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { nextOccurrence } from '../shared/recurrence'
import { isPurgeable } from '../shared/retention'
import { isLocale, localeFromLanguageTag, type Locale } from '../shared/i18n'
import { csvErrorMessage, parseCsvImport } from '../shared/csvImport'
import { translate } from '../shared/i18n'
// db ↔ locale 相互引用：locale 用 getMeta/setMeta 持久化，db 用 getCurrentLocale
// 在抛出/返回错误前按界面语言翻译。两侧都只在运行期调用对方函数，模块初始化
// 互不触碰，循环引用安全。
import { getCurrentLocale } from './locale'
import type {
  BackupTask,
  CreateSubtaskInput,
  CreateTaskInput,
  Project,
  Subtask,
  Tag,
  Task,
  TaskTag,
  UpdateSubtaskInput,
  UpdateTaskInput,
  UpdateTaskResult
} from '../shared/types'

let db: Database.Database

/** initDatabase 的结果：quarantinedPath 非空表示原库已损坏并被改名隔离，
 *  当前运行的是重建的空库——调用方（whenReady 链）据此在启动后告知用户。 */
export type InitDatabaseResult = { quarantinedPath: string | null }

function openAndMigrate(dbPath: string): void {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate()
  seedIfNeeded()
}

export function initDatabase(): InitDatabaseResult {
  const directory = app.getPath('userData')
  mkdirSync(directory, { recursive: true })
  const dbPath = join(directory, 'polaris.db')
  try {
    openAndMigrate(dbPath)
    return { quarantinedPath: null }
  } catch (error) {
    // 灾难恢复：损坏库（连同 -wal/-shm 旁车）改名隔离保留取证，绝不覆盖删除。
    log.error('Polaris database init failed, quarantining corrupt file:', error)
    try {
      // Windows 上打开的句柄会挡住改名：先尽力关掉可能半开的连接。
      db?.close()
    } catch {
      // 关闭失败不阻断隔离尝试；隔离本身失败才致命。
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const corruptPath = `${dbPath}.corrupt-${stamp}`
    try {
      renameSync(dbPath, corruptPath)
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(`${dbPath}${suffix}`)) {
          renameSync(`${dbPath}${suffix}`, `${corruptPath}${suffix}`)
        }
      }
    } catch (quarantineError) {
      // 隔离失败（文件被占用等）：抛错交给启动链兜底退出，不得静默覆盖用户数据。
      throw new Error(
        `数据库损坏且隔离失败（${String(quarantineError)}）；原始错误：${String(error)}`
      )
    }
    // 重建空库走正常迁移与首启种子；再失败就抛给 whenReady 的 catch。
    openAndMigrate(dbPath)
    // 隔离位置写进日志：用户报告「数据没了」时按这份路径找回原库。
    log.error('Polaris database quarantined to:', corruptPath)
    return { quarantinedPath: corruptPath }
  }
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

  // 每个版本段一个事务：DDL 与 user_version 盖章同生共死，崩溃不会留半套迁移。
  // SQLite 支持事务内 DDL，user_version 也可在事务内写并随事务回滚
  // （已用 better-sqlite3 实测：提交生效、抛错整体回滚）。
  // 幂等检查（IF NOT EXISTS / 列探测）保留作双保险。migrate 抛错由
  // initDatabase 的灾难恢复接住。
  if (version < 1) {
    db.transaction(() => {
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
    `)
      db.pragma('user_version = 1')
    })()
    version = 1
  }

  if (version < 2) {
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'reminded_at')) {
        db.exec('ALTER TABLE tasks ADD COLUMN reminded_at TEXT')
      }
      db.pragma('user_version = 2')
    })()
    version = 2
  }

  if (version < 3) {
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'recurrence_rule')) {
        db.exec('ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT')
      }
      db.pragma('user_version = 3')
    })()
    version = 3
  }

  if (version < 4) {
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'completed_at')) {
        // updated_at is overwritten by every later edit, so it cannot answer
        // "when was this finished". Rows completed before this migration stay
        // NULL: the real instant is unknown and guessing it would poison any
        // completion statistics built on top.
        db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT')
      }
      db.pragma('user_version = 4')
    })()
    version = 4
  }

  if (version < 5) {
    // 轻量检查清单：子任务只属于一个任务，不参与截止/提醒/重复/项目/优先级。
    // task_id 的级联删除是「彻底删除 / 清空回收站 / 过期清理」清掉子任务的唯一路径；
    // 软删父任务不动这张表，恢复后勾选状态原样保留。
    db.transaction(() => {
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
    `)
      db.pragma('user_version = 5')
    })()
    version = 5
  }

  if (version < 6) {
    // 标签是项目之外的第二个组织维度：一条任务可以贴多个标签。
    // 名称大小写不敏感去重（COLLATE NOCASE）；两侧外键都级联删除——
    // 彻底删任务清关联，删标签清关联，软删/恢复不碰这张表。
    db.transaction(() => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);
    `)
      db.pragma('user_version = 6')
    })()
    version = 6
  }

  if (version < 7) {
    // 写修订号：五张数据表（tasks/subtasks/tags/task_tags/projects）的任何
    // INSERT/UPDATE/DELETE 都由 AFTER 触发器把 meta.write_revision 加一。
    // 渲染层 focus 时先廉价比对修订号，变了才全量重拉——外部写入（MCP/CSV
    // 导入/备份导入/retention 清理）与 UI 写入走同一套 SQL，触发器天然覆盖
    // 所有写入路径，应用层零埋点。meta 自身不建触发器：主题/语言等应用设置
    // 不是任务数据，不该触发重拉；也避免触发器写 meta 再触发自身的递归。
    // 级联删除（删任务连带 subtasks/task_tags）会多跳几次号——修订号只承诺
    // 单调递增，不承诺恰好等于写入次数，门控只做「变没变」的等值比较。
    // better-sqlite3 同连接事务内触发器写 meta 与普通写入同生共死（已实测）。
    db.transaction(() => {
      db.exec(`
      INSERT INTO meta (key, value) VALUES ('write_revision', '0')
        ON CONFLICT(key) DO NOTHING;
    `)
      for (const table of ['tasks', 'subtasks', 'tags', 'task_tags', 'projects']) {
        for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
          db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_write_revision_${table}_${op.toLowerCase()}
          AFTER ${op} ON ${table}
          BEGIN
            UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'write_revision';
          END;
        `)
        }
      }
      db.pragma('user_version = 7')
    })()
    version = 7
  }
}

// 当前写修订号：单行主键 SELECT，focus 门控的廉价探针。键缺失（理论上只有
// 迁移 7 之前的库）按 0 处理；值损坏（非数字）也按 0——宁可让渲染层多拉一次，
// 不能抛错把 focus 刷新整条链打断。
export function getWriteRevision(): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('write_revision') as
    | { value: string }
    | undefined
  const parsed = Number.parseInt(row?.value ?? '0', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

// 种子语言与 initAppLocale 同口径：harness 下 POLARIS_LOCALE 覆盖、其余 harness
// 场景确定性中文；正常启动按 meta 已存值 → 系统语言。种子先于 initAppLocale
// 执行（locale 的 meta 读取依赖建库），故这里独立解析，避免循环依赖。
function seedLocale(): Locale {
  if (__POLARIS_HARNESS__) {
    const forced = process.env['POLARIS_LOCALE']
    if (isLocale(forced)) return forced
    if (
      process.env['POLARIS_SMOKE'] ||
      process.env['POLARIS_SHOT'] ||
      process.env['POLARIS_SCREENSHOT']
    ) {
      return 'zh-CN'
    }
  }
  const stored = db.prepare('SELECT value FROM meta WHERE key = ?').get('locale') as
    | { value: string }
    | undefined
  const value = stored?.value
  return isLocale(value) ? value : localeFromLanguageTag(app.getLocale())
}

function seedIfNeeded(): void {
  const seeded = db.prepare('SELECT value FROM meta WHERE key = ?').get('demo_seeded') as
    | { value: string }
    | undefined
  if (seeded) return

  const en = seedLocale() === 'en'

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
    INSERT INTO tasks (id, title, notes, completed, due_at, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertSubtask = db.prepare(
    'INSERT INTO subtasks (id, task_id, title, completed, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertTag = db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)')
  const insertTaskTag = db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)')

  const seed = db.transaction(() => {
    insertProject.run(polarisProjectId, 'Polaris', '#5EEAD4', 0, stamp, stamp)
    insertProject.run(personalProjectId, en ? 'Personal' : '个人', '#A78BFA', 1, stamp, stamp)

    // 首启种子是一组教学示例：每条任务演示一个功能，用法写在备注里，取代
    // 早期的泛型演示任务。英文镜像与中文种子同结构（偏移/时刻/优先级/完成态/
    // 子任务/标签一致）；completed 直插、不写 completed_at，统计视图的
    // 「未记录时刻」老任务语义两边相同。四象限全覆盖：立即做（子任务/四象限两条）、
    // 计划（标签）、快速处理（每周回顾）、稍后（欢迎/提醒），matrix 截图仍有数据。
    // 提醒设在明天：首启不会立刻弹提醒窗。
    type SeedTask = {
      title: string
      notes: string
      completed: number
      dueAt: string | null
      remindAt: string | null
      recurrenceRule: string | null
      projectId: string
      priority: number
      subtasks: Array<{ title: string; completed: number }>
      tags: string[]
    }
    const t = (
      partial: Partial<SeedTask> & Pick<SeedTask, 'title' | 'notes' | 'projectId'>
    ): SeedTask => ({
      completed: 0,
      dueAt: null,
      remindAt: null,
      recurrenceRule: null,
      priority: 0,
      subtasks: [],
      tags: [],
      ...partial
    })

    const tasks: SeedTask[] = en
      ? [
          t({
            title: 'Welcome to Polaris — open me',
            notes:
              'Click a task to open its details: notes, due date, reminder and recurrence all live there.\nUse the input at the top to add tasks anytime; press Ctrl+Alt+P in any app to bring up Polaris quick add.\nThese sample tasks are just a demo — delete them whenever you like.',
            projectId: polarisProjectId
          }),
          t({
            title: 'Try quick add: Submit report tomorrow 3pm #Personal !high',
            notes:
              'Type the title above into the top input and press Enter: the date, #project and !priority are recognized as chips below the input.\nChinese syntax works too, e.g. 明天下午3点 交报告 #个人 !高.',
            projectId: personalProjectId
          }),
          t({
            title: 'Subtasks: break big work into small steps',
            notes:
              'Open the details and add checklist items under Subtasks, then tick them off one by one; the task row shows the progress.',
            dueAt: at(0, 18),
            projectId: polarisProjectId,
            priority: 2,
            subtasks: [
              { title: 'Open the detail panel', completed: 1 },
              { title: 'Add a subtask of your own', completed: 0 },
              { title: 'Tick one off and watch the progress', completed: 0 }
            ]
          }),
          t({
            title: 'Tags: organize across projects',
            notes:
              'A task can carry several tags; click a tag in the sidebar to filter across projects.\nType a name in the Tags row of the details to create a new one.',
            dueAt: at(1, 12),
            projectId: personalProjectId,
            priority: 2,
            tags: ['sample', 'getting-started']
          }),
          t({
            title: 'Review the task list weekly',
            notes:
              'This is a repeating task: completing it automatically spawns the next occurrence one week later.\nSubtasks and tags carry over to the next one.',
            dueAt: at(0, 20),
            recurrenceRule: 'FREQ=WEEKLY',
            projectId: personalProjectId,
            priority: 1
          }),
          t({
            title: 'Reminders: a popup right on time',
            notes:
              'This task has a reminder set for tomorrow 09:00 — a reminder window will pop up then.\nAny task can get one via the Remind row in the details.',
            dueAt: at(1, 9),
            remindAt: at(1, 9),
            projectId: personalProjectId
          }),
          t({
            title: 'Matrix: important & urgent comes first',
            notes:
              'Open the Matrix view: important = medium/high priority, urgent = due today or overdue.\nThis task lands in the "Do now" quadrant.',
            dueAt: at(0, 17),
            projectId: polarisProjectId,
            priority: 3
          }),
          t({
            title: 'Completed tasks fold away here',
            notes:
              'The completed section collapses into a single count row; expand it to review, and it folds back when you switch views.',
            completed: 1,
            dueAt: at(0, 12),
            projectId: personalProjectId
          })
        ]
      : [
          t({
            title: '欢迎使用 Polaris，点我看看',
            notes:
              '点击任务打开详情：备注、截止、提醒、重复都在那里设置。\n顶部输入框随时添加任务；在任何程序里按 Ctrl+Alt+P 都能唤起 Polaris 快速添加。\n这组示例任务只是演示，随时可以删掉。',
            projectId: polarisProjectId
          }),
          t({
            title: '试试快速添加：明天下午3点 交报告 #个人 !高',
            notes:
              '把标题这句话原样敲进顶部输入框再回车：时间、#项目、!优先级 会自动识别成输入框下方的芯片。\n英文同样支持，例如 Submit report tomorrow 3pm #Personal !high。',
            projectId: personalProjectId
          }),
          t({
            title: '子任务：把大事拆成小步',
            notes: '打开详情，在「子任务」里添加检查项，逐项打勾；任务行会显示完成进度。',
            dueAt: at(0, 18),
            projectId: polarisProjectId,
            priority: 2,
            subtasks: [
              { title: '打开详情面板', completed: 1 },
              { title: '添加一条自己的子任务', completed: 0 },
              { title: '勾掉一项，看进度变化', completed: 0 }
            ]
          }),
          t({
            title: '标签：跨项目归类',
            notes:
              '一条任务可以贴多个标签；点侧栏标签就能跨项目筛选。\n在详情的「标签」行输入名字即可新建。',
            dueAt: at(1, 12),
            projectId: personalProjectId,
            priority: 2,
            tags: ['示例', '入门']
          }),
          t({
            title: '每周回顾任务清单',
            notes:
              '这是一条重复任务：勾选完成后自动生成下一次，截止顺延一周。\n子任务和标签也会继承到下一次。',
            dueAt: at(0, 20),
            recurrenceRule: 'FREQ=WEEKLY',
            projectId: personalProjectId,
            priority: 1
          }),
          t({
            title: '提醒：到点弹窗不怕忘',
            notes:
              '这条任务设了明天 09:00 的提醒，到点会弹出提醒窗口。\n任何任务都能在详情的「提醒」行设置。',
            dueAt: at(1, 9),
            remindAt: at(1, 9),
            projectId: personalProjectId
          }),
          t({
            title: '四象限：重要又紧急的排最前',
            notes:
              '打开「四象限」视图看看：重要 = 中/高优先级，紧急 = 今天到期或已逾期。\n这条任务会落在「立即做」象限。',
            dueAt: at(0, 17),
            projectId: polarisProjectId,
            priority: 3
          }),
          t({
            title: '已完成的任务收在这里',
            notes: '完成区默认折叠成一行计数，点开可以回顾，切换视图后自动收起。',
            completed: 1,
            dueAt: at(0, 12),
            projectId: personalProjectId
          })
        ]

    const tagIds = new Map<string, string>()
    for (const task of tasks) {
      const taskId = randomUUID()
      insertTask.run(
        taskId,
        task.title,
        task.notes,
        task.completed,
        task.dueAt,
        task.remindAt,
        task.recurrenceRule,
        task.projectId,
        task.priority,
        stamp,
        stamp,
        null
      )
      task.subtasks.forEach((subtask, index) => {
        insertSubtask.run(randomUUID(), taskId, subtask.title, subtask.completed, index, stamp)
      })
      for (const name of task.tags) {
        let tagId = tagIds.get(name)
        if (!tagId) {
          tagId = randomUUID()
          insertTag.run(tagId, name, stamp)
          tagIds.set(name, tagId)
        }
        insertTaskTag.run(taskId, tagId)
      }
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

type TagRow = {
  id: string
  name: string
  created_at: string
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
    subtaskDone: row.subtask_done ?? 0,
    tags: []
  }
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at
  }
}

/** Attach the derived tags in one extra query, ordered by name. The join table
 *  is tiny, so reading the whole map is cheaper than a per-task query — and it
 *  keeps TASK_SELECT (and therefore every existing read) unchanged. */
function attachTags(tasks: Task[]): Task[] {
  if (tasks.length === 0) return tasks
  const rows = db
    .prepare(`
      SELECT tt.task_id, tg.id, tg.name, tg.created_at
      FROM task_tags tt
      JOIN tags tg ON tg.id = tt.tag_id
      ORDER BY tg.name COLLATE NOCASE ASC, tg.created_at ASC
    `)
    .all() as Array<TagRow & { task_id: string }>
  const byTask = new Map<string, Tag[]>()
  for (const row of rows) {
    const tag = mapTag(row)
    const list = byTask.get(row.task_id)
    if (list) list.push(tag)
    else byTask.set(row.task_id, [tag])
  }
  for (const task of tasks) task.tags = byTask.get(task.id) ?? []
  return tasks
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

// 按 id 直查（过滤软删行）：MCP 的 findTask 也走这里，不再全表 listTasks().find。
export function getTask(id: string): Task | undefined {
  const row = db
    .prepare(`${TASK_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`)
    .get(id) as TaskRow | undefined
  return row ? attachTags([mapTask(row)])[0] : undefined
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
  return attachTags(rows.map(mapTask))
}

export function listDeletedTasks(): Task[] {
  const rows = db
    .prepare(`
      ${TASK_SELECT}
      WHERE t.deleted_at IS NOT NULL
      ORDER BY t.deleted_at DESC, t.created_at DESC
    `)
    .all() as TaskRow[]
  return attachTags(rows.map(mapTask))
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

export function listTags(): Tag[] {
  const rows = db
    .prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC, created_at ASC')
    .all() as TagRow[]
  return rows.map(mapTag)
}

// 重名复用而不是报错：详情里的标签输入框是「输入即新建」的，
// 已存在的名字直接复用为同一个标签，不抛错——输入框按 Enter 即保存。
// 比较用 COLLATE NOCASE，英文标签 `Work` 与 `work` 视为同一个。
export function createTag(input: { name: string }): Tag {
  const name = input.name.trim()
  if (!name) throw new Error('标签名称不能为空')

  const existing = db
    .prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE')
    .get(name) as TagRow | undefined
  if (existing) return mapTag(existing)

  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now)
  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow
  return mapTag(row)
}

// 全局删除：task_tags 的 tag_id 外键 ON DELETE CASCADE 会清掉所有关联。
// 幂等，删不存在的 id 是 no-op；标签没有回收站，删除不可恢复。
export function deleteTag(id: string): void {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

// 导出全量项目、任务（含回收站软删行）、标签、标签关联与子任务，供备份。
// 时间戳原样保留，恢复时不失真。子任务与标签关联按平铺数组导出；
// 导入时再按父行是否存在决定去留。
export function exportBackup(): {
  projects: Project[]
  tasks: Task[]
  tags: Tag[]
  taskTags: TaskTag[]
  subtasks: Subtask[]
} {
  const projects = listProjects()
  const rows = db
    .prepare(`${TASK_SELECT} ORDER BY t.created_at ASC`)
    .all() as TaskRow[]
  const taskTags = db
    .prepare('SELECT task_id, tag_id FROM task_tags ORDER BY task_id ASC, tag_id ASC')
    .all() as Array<{ task_id: string; tag_id: string }>
  const subtasks = db
    .prepare('SELECT * FROM subtasks ORDER BY task_id ASC, sort_order ASC, created_at ASC')
    .all() as SubtaskRow[]
  return {
    projects,
    tasks: attachTags(rows.map(mapTask)),
    tags: listTags(),
    taskTags: taskTags.map((row) => ({ taskId: row.task_id, tagId: row.tag_id })),
    subtasks: subtasks.map(mapSubtask)
  }
}

export type ImportCounts = {
  projectsImported: number
  projectsSkipped: number
  tasksImported: number
  tasksSkipped: number
  subtasksImported: number
  subtasksSkipped: number
  tagsImported: number
  tagsSkipped: number
  taskTagsImported: number
  taskTagsSkipped: number
}

// 非破坏性按 ID 合并：已存在的行跳过（绝不覆盖/删除本地数据），新行插入。
// 先插项目、任务，再插标签，最后才插依赖两侧的 task_tags 与依赖父任务的子任务。
// 任务的 projectId 仅在该项目存在时保留，否则归「无项目」；同理，标签关联只在
// 任务与标签都存在时恢复，绝不制造外键违约。整体在一个事务里。
// 旧备份（schemaVersion 1/2）没有 tags / taskTags 字段，按「没有标签数据」处理。
export function importBackup(data: {
  projects: Project[]
  tasks: BackupTask[]
  tags?: Tag[]
  taskTags?: TaskTag[]
  subtasks?: Subtask[]
}): ImportCounts {
  const counts: ImportCounts = {
    projectsImported: 0,
    projectsSkipped: 0,
    tasksImported: 0,
    tasksSkipped: 0,
    subtasksImported: 0,
    subtasksSkipped: 0,
    tagsImported: 0,
    tagsSkipped: 0,
    taskTagsImported: 0,
    taskTagsSkipped: 0
  }
  const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?')
  const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?')
  const subtaskExists = db.prepare('SELECT 1 FROM subtasks WHERE id = ?')
  const tagExists = db.prepare('SELECT 1 FROM tags WHERE id = ?')
  const tagNameExists = db.prepare('SELECT 1 FROM tags WHERE name = ? COLLATE NOCASE')
  const taskTagExists = db.prepare('SELECT 1 FROM task_tags WHERE task_id = ? AND tag_id = ?')
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, completed_at, due_at, remind_at, reminded_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTag = db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)')
  const insertTaskTag = db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)')
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
    // 标签按 id 去重；id 新的行如果撞上本地同名标签也跳过，避免 UNIQUE 违约。
    for (const tag of data.tags ?? []) {
      if (tagExists.get(tag.id) || tagNameExists.get(tag.name)) {
        counts.tagsSkipped += 1
        continue
      }
      insertTag.run(tag.id, tag.name, tag.createdAt)
      counts.tagsImported += 1
    }
    // 标签关联依赖任务与标签两侧：任一侧缺失（含刚被上面跳过的同名标签）就跳过。
    for (const link of data.taskTags ?? []) {
      if (
        taskTagExists.get(link.taskId, link.tagId) ||
        !taskExists.get(link.taskId) ||
        !tagExists.get(link.tagId)
      ) {
        counts.taskTagsSkipped += 1
        continue
      }
      insertTaskTag.run(link.taskId, link.tagId)
      counts.taskTagsImported += 1
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

export type CsvImportCounts = {
  ok: boolean
  format?: 'todoist' | 'dida'
  tasksImported?: number
  tasksSkipped?: number
  projectsImported?: number
  subtasksImported?: number
  tagsImported?: number
  error?: string
}

// CSV 搬家：解析 → 落库。项目与标签按名复用，任务总是新建。
// 重复/提醒/附件不迁移（语义无法可靠对应，见 shared/csvImport.ts）。
// 整体一个事务（对照 importBackup）：中途任何一步抛错全部回滚，
// 绝不留下半份导入——「整体拒绝」不只是解析层的承诺。
// 错误在这里（展示边界）按当前界面语言翻译：shared 层只回 code+params。
export function importCsvText(text: string): CsvImportCounts {
  const parsed = parseCsvImport(text)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error ? csvErrorMessage(getCurrentLocale(), parsed.error) : undefined,
      tasksSkipped: parsed.skipped
    }
  }
  let projectsImported = 0
  let subtasksImported = 0
  let tagsImported = 0
  let tasksImported = 0
  // 循环外一次性建「名 → id」映射，循环内查 Map：逐行 listProjects/listTags
  // 全表扫描是 O(n²)。新建时同步写回 Map，后续行照常复用。
  const projectIdsByName = new Map(listProjects().map((project) => [project.name, project.id]))
  // 标签按 COLLATE NOCASE 去重（与 createTag 同语义），Map 键用小写归一。
  const tagIdsByName = new Map(listTags().map((tag) => [tag.name.toLowerCase(), tag.id]))
  const run = db.transaction(() => {
    for (const item of parsed.tasks) {
      let projectId: string | null = null
      if (item.projectName) {
        const existing = projectIdsByName.get(item.projectName)
        if (existing) {
          projectId = existing
        } else {
          const created = createProject({ name: item.projectName, color: '#5EEAD4' })
          projectIdsByName.set(created.name, created.id)
          projectId = created.id
          projectsImported++
        }
      }
      const task = createTask({
        title: item.title,
        dueAt: item.dueAt,
        projectId,
        priority: item.priority
      })
      if (item.notes) updateTask({ id: task.id, notes: item.notes })
      if (item.completed) {
        // 完成时刻未知：只置完成态，不盖 completed_at——盖导入时刻会污染
        // 基于完成时刻的统计（与迁移 4 之前的老行同语义）。
        db.prepare('UPDATE tasks SET completed = 1 WHERE id = ?').run(task.id)
      }
      for (const title of item.subtasks) {
        createSubtask({ taskId: task.id, title })
        subtasksImported++
      }
      if (item.tags.length > 0) {
        const tagIds: string[] = []
        for (const name of item.tags) {
          const key = name.toLowerCase()
          let tagId = tagIdsByName.get(key)
          if (!tagId) {
            const tag = createTag({ name })
            tagId = tag.id
            tagIdsByName.set(tag.name.toLowerCase(), tag.id)
            tagsImported++
          }
          tagIds.push(tagId)
        }
        updateTask({ id: task.id, tagIds })
      }
      tasksImported++
    }
  })
  run()
  return {
    ok: true,
    format: parsed.format,
    tasksImported,
    tasksSkipped: parsed.skipped,
    projectsImported,
    subtasksImported,
    tagsImported
  }
}

export function createTask(input: CreateTaskInput): Task {
  const title = input.title.trim()
  if (!title) throw new Error('任务标题不能为空')
  if (input.recurrenceRule && !input.dueAt) throw new Error(translate(getCurrentLocale(), 'errors.recurrenceNeedsDue'))

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

// 返回 { task, spawned }：完成重复任务时，下一次实例由 DB 在同一事务里生成，
// spawned 是权威完整 Task 行（含派生计数与 attachTags），渲染层不再靠标题猜。
export function updateTask(input: UpdateTaskInput): UpdateTaskResult {
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
  if (next.recurrenceRule && !next.dueAt) throw new Error(translate(getCurrentLocale(), 'errors.recurrenceNeedsDue'))

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
  // 替换式语义：tagIds 是「保存后应有的完整集合」，省略则完全不动关联。
  // 未知 id（标签已在别处被删）静默丢弃，而不是让整次保存失败。
  const tagIds =
    input.tagIds !== undefined
      ? Array.from(new Set(input.tagIds)).filter(
          (tagId) => db.prepare('SELECT 1 FROM tags WHERE id = ?').get(tagId) !== undefined
        )
      : null
  // Stamp the transition, not the row: re-completing keeps the first instant,
  // un-completing clears it, and unrelated edits never touch it.
  const completedAt = !next.completed
    ? null
    : existing.completed
      ? existing.completedAt
      : now

  // 提升到事务外：事务提交后按这个 id 读回权威 spawned 行。
  let spawnedId: string | null = null

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

    // 标签关联与任务字段在同一个事务里替换：先清空再插入，避免出现半套标签。
    if (tagIds) {
      db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(input.id)
      const insertTaskTag = db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)')
      for (const tagId of tagIds) insertTaskTag.run(input.id, tagId)
    }

    if (nextDate) {
      spawnedId = randomUUID()
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

      // 标签同样随下一次实例继承；新实例拿到新的关联行，之后各改各的互不影响。
      const tagTemplate = db
        .prepare('SELECT tag_id FROM task_tags WHERE task_id = ?')
        .all(input.id) as Array<{ tag_id: string }>
      if (tagTemplate.length > 0) {
        const insertTaskTag = db.prepare(
          'INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)'
        )
        for (const tag of tagTemplate) insertTaskTag.run(spawnedId, tag.tag_id)
      }
    }
  })

  write()

  const updated = getTask(input.id)
  if (!updated) throw new Error('任务更新失败')
  // 权威 spawned：事务提交后读回完整行（派生计数 + 标签），没生成则为 null。
  const spawned = spawnedId ? (getTask(spawnedId) ?? null) : null
  return { task: updated, spawned }
}

// tasks:toggle IPC 与 MCP complete_task 继续拿纯 Task：形状不变，
// 需要 spawned 的调用方走 updateTask 的 { task, spawned } 返回。
export function toggleTask(id: string, completed: boolean): Task {
  return updateTask({ id, completed }).task
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
  return attachTags(rows.map(mapTask))
}

export function markTaskReminded(id: string, at: string): void {
  db.prepare('UPDATE tasks SET reminded_at = ? WHERE id = ?').run(at, id)
}