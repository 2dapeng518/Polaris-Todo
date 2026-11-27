import Database from 'better-sqlite3'
import { app } from 'electron'
import log from 'electron-log/main'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextOccurrence } from '../shared/recurrence'
import { isPurgeable } from '../shared/retention'
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from '../shared/sampleTasks'
import { isLocale, localeFromLanguageTag, type Locale } from '../shared/i18n'
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
// 当前打开的库文件路径：迁移/恢复复制（backupDbTo / checkpointCopyDbSync）用，
// initDatabase 由 index.ts 传入目录，db.ts 不感知指针文件。
let dbFilePath = ''

/** initDatabase 的结果：quarantinedPath 非空表示原库已损坏并被改名隔离，
 *  当前运行的是重建的空库——调用方（whenReady 链）据此在启动后告知用户。 */
export type InitDatabaseResult = { quarantinedPath: string | null }

function openAndMigrate(dbPath: string): void {
  dbFilePath = dbPath
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate()
  seedIfNeeded()
}

export function initDatabase(directory: string): InitDatabaseResult {
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

/** 在线一致性备份到目标路径：better-sqlite3 backup API 对运行中的库做完整
 *  快照（含 WAL 内容），复制期间读写照常。目标是数据目录切换的复制路径，
 *  先清掉目标三件套（残留旧库/-wal 会污染新快照）。 */
export async function backupDbTo(destPath: string): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) {
    const stale = `${destPath}${suffix}`
    if (existsSync(stale)) unlinkSync(stale)
  }
  await db.backup(destPath)
}

/** 退出兜底：同步 checkpoint 把 WAL 收进主库，再临时文件 + rename 覆盖复制。
 *  will-quit 里同步调用——异步 API 在退出钩子里不保证跑完。 */
export function checkpointCopyDbSync(destPath: string): void {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const tempPath = `${destPath}.quit-tmp`
  copyFileSync(dbFilePath, tempPath)
  renameSync(tempPath, destPath)
}

/** 退出收尾：显式 checkpoint 把 WAL 收进主库并关闭连接。SQLite 关闭最后一个
 *  连接时会删掉 -wal/-shm 旁车，数据目录只剩单个 polaris.db——网盘同步的
 *  数据目录不再有三件套版本错位（同步是按文件粒度的，旁车必然错位）。
 *  必须在所有可能摸库的模块（定时器/监听）停掉之后调用。 */
export function closeDatabase(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (error) {
    log.error('Polaris database close failed:', error)
  }
}

// 同步指纹旁车：紧挨 polaris.db 存放，记录收拢后的（大小 + mtime）。存库外的
// 原因是比对发生在开库之前——库还打不开时就要能读到上一次的指纹。
const SYNC_STAMP_SUFFIX = '.sync-stamp'

/** 退出收尾后记录指纹。db 未开/路径缺失时静默跳过——指纹缺失的后果只是
 *  下次启动少一次比对机会，绝不能反过来挡住退出。 */
export function writeDbSyncStamp(): void {
  writeSyncStampAt(dbFilePath)
}

/** 为指定库文件写指纹：数据目录切换 / 恢复默认由应用自己把库复制到目标
 *  位置，而目标旁可能残留旧指纹（如恢复默认时默认目录里上一次退出写的），
 *  复制出的新文件必然与之不符——下次启动会误报「外部修改」。应用自己
 *  落盘的每个目标库副本都要随写随记，让外部修改检测只对真正的应用外改动
 *  诚实触发（其他设备的网盘同步 / 手动改文件 / 未正常退出）。 */
export function writeSyncStampAt(dbPath: string): void {
  try {
    const info = statSync(dbPath)
    writeFileSync(
      `${dbPath}${SYNC_STAMP_SUFFIX}`,
      JSON.stringify(
        { size: info.size, mtimeMs: info.mtimeMs, quitAt: new Date().toISOString() },
        null,
        2
      )
    )
  } catch (error) {
    log.warn('Polaris database sync stamp write failed:', error)
  }
}

/** 启动检测（开库之前调用）：指纹与磁盘现状不一致 = 文件在应用之外被动过
 *  （其他设备的网盘同步 / 上次未正常退出）。返回 null = 无指纹可比（首次
 *  运行或刚换了数据目录），不构成变更信号。 */
export function detectExternalDbChange(directory: string): boolean | null {
  try {
    const dbPath = join(directory, 'polaris.db')
    const stamp = JSON.parse(readFileSync(`${dbPath}${SYNC_STAMP_SUFFIX}`, 'utf8')) as {
      size?: number
      mtimeMs?: number
    }
    if (typeof stamp.size !== 'number' || typeof stamp.mtimeMs !== 'number') return null
    const info = statSync(dbPath)
    return info.size !== stamp.size || info.mtimeMs !== stamp.mtimeMs
  } catch {
    return null
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

/** 首启教学示例的 id 清单（meta `demo_seed_ids`）。缺失或损坏返回 null，
 *  调用方按「不是全新库」处理——绝不在拿不准的时候删用户数据。 */
export type DemoSeedIds = {
  tasks: string[]
  projects: string[]
  tags: string[]
  subtasks: string[]
}

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export function listDemoSeedIds(): DemoSeedIds | null {
  const raw = getMeta('demo_seed_ids')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DemoSeedIds>
    return {
      tasks: readStringArray(parsed.tasks),
      projects: readStringArray(parsed.projects),
      tags: readStringArray(parsed.tags),
      subtasks: readStringArray(parsed.subtasks)
    }
  } catch {
    return null
  }
}

export function removeDemoSeedRows(keepIds?: ReadonlySet<string>): boolean {
  const ids = listDemoSeedIds()
  if (!ids) return false
  if (ids.tasks.length + ids.projects.length + ids.tags.length + ids.subtasks.length === 0) {
    return false
  }
  const keep = (id: string): boolean => keepIds?.has(id) === true
  let removed = 0
  const run = db.transaction(() => {
    const deleteSubtask = db.prepare('DELETE FROM subtasks WHERE id = ?')
    const deleteTask = db.prepare('DELETE FROM tasks WHERE id = ?')
    const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?')
    const deleteTag = db.prepare('DELETE FROM tags WHERE id = ?')
    for (const id of ids.subtasks) {
      if (keep(id)) continue
      removed += deleteSubtask.run(id).changes
    }
    for (const id of ids.tasks) {
      if (keep(id)) continue
      removed += deleteTask.run(id).changes
    }
    for (const id of ids.projects) {
      if (keep(id)) continue
      removed += deleteProject.run(id).changes
    }
    for (const id of ids.tags) {
      if (keep(id)) continue
      removed += deleteTag.run(id).changes
    }
    // 只删清单，不删 demo_seeded：后者负责阻止下次启动重新播种。
    // 全部 id 都在 keepIds 里时清单仍然有效，未来仍可识别「仅示例」。
    if (removed > 0) db.prepare('DELETE FROM meta WHERE key = ?').run('demo_seed_ids')
  })
  run()
  return removed > 0
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

  if (version < 8) {
    // 任务计划时间段（日历套件 P0）：开始/结束时刻与全天标记。都是可选信息——
    // 旧行 NULL/0 = 未设置；dueAt 仍是截止与日历分组的锚点，start/end 只描述
    // 「打算什么时候做」。照 v4 的加列写法（探测 + ALTER，同事务盖章）。
    db.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'start_at')) {
        db.exec('ALTER TABLE tasks ADD COLUMN start_at TEXT')
      }
      if (!columns.some((column) => column.name === 'end_at')) {
        db.exec('ALTER TABLE tasks ADD COLUMN end_at TEXT')
      }
      if (!columns.some((column) => column.name === 'all_day')) {
        db.exec('ALTER TABLE tasks ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0')
      }
      db.pragma('user_version = 8')
    })()
    version = 8
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

// 示例数据集（shared/sampleTasks.ts）：首启种子与「载入示例任务」共用的
// 唯一来源。固定 ID（sample-task-N / sample-project-*）是幂等键——扩充示例
// 集后再载入只补新增条目，绝不覆盖；示例项目在老库里按名称复用（老种子的
// 项目 ID 是随机 UUID，按名复用才不会重名重建）。
const SAMPLE_PROJECT_IDS: Record<string, string> = {
  polaris: 'sample-project-polaris',
  personal: 'sample-project-personal'
}

// 把示例集插进当前库：项目映射（key→id）由调用方解析（seed 用固定 ID 新建、
// load 按名复用），任务按固定 ID 幂等跳过。返回计数供 UI 反馈与冒烟断言。
function insertSampleTasks(
  en: boolean,
  now: Date,
  projectIds: Record<string, string>,
  seedIds: DemoSeedIds
): { tasksAdded: number; tasksSkipped: number; subtasksAdded: number; tagsAdded: number } {
  const stamp = now.toISOString()
  const at = (dayOffset: number, hour: number, minute = 0): string => {
    const date = new Date(now)
    date.setDate(date.getDate() + dayOffset)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
  }
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, due_at, start_at, end_at, all_day, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `)
  const insertSubtask = db.prepare(
    'INSERT INTO subtasks (id, task_id, title, completed, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertTag = db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)')
  const insertTaskTag = db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)')
  const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?')
  const tagByName = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')

  let tasksAdded = 0
  let tasksSkipped = 0
  let subtasksAdded = 0
  let tagsAdded = 0

  for (const sample of SAMPLE_TASKS) {
    if (taskExists.get(sample.id)) {
      tasksSkipped += 1
      continue
    }
    const lang = en ? sample.en : sample.zh
    const dueAt =
      sample.dayOffset === null ? null : at(sample.dayOffset, sample.hour, sample.minute ?? 0)
    const allDay = sample.allDay === true
    // 全天任务的起止也存完整时刻（展示忽略钟点）；无时间段不造 end。
    const startAt =
      sample.startHour === undefined
        ? dueAt
        : at(sample.dayOffset ?? 0, sample.startHour, sample.startMinute ?? 0)
    // 跨天全天示例只给 endDayOffset、不给 endHour：此时结束时刻按当天 23:59
// 补齐，否则 endAt 为 null，示例在月格/全天行里只亮一天，与教学文案矛盾。
    const endAt =
      sample.endHour !== undefined
        ? at(sample.endDayOffset ?? sample.dayOffset ?? 0, sample.endHour, sample.endMinute ?? 0)
        : sample.endDayOffset !== undefined
          ? at(sample.endDayOffset, 23, 59)
          : null
    const remindAt = sample.remind
      ? at(sample.remind.dayOffset, sample.remind.hour, sample.remind.minute ?? 0)
      : null
    insertTask.run(
      sample.id,
      lang.title,
      lang.notes,
      sample.completed ? 1 : 0,
      dueAt,
      startAt,
      endAt,
      allDay ? 1 : 0,
      remindAt,
      sample.recurrenceRule ?? null,
      projectIds[sample.project],
      sample.priority,
      stamp,
      stamp
    )
    tasksAdded += 1
    seedIds.tasks.push(sample.id)

    ;(lang.subtasks ?? []).forEach((title, index) => {
      const subtaskId = randomUUID()
      seedIds.subtasks.push(subtaskId)
      insertSubtask.run(subtaskId, sample.id, title, 0, index, stamp)
      subtasksAdded += 1
    })
    for (const tag of sample.tags ?? []) {
      const name = en ? tag.en : tag.zh
      let tagId = (tagByName.get(name) as { id: string } | undefined)?.id
      if (!tagId) {
        tagId = randomUUID()
        insertTag.run(tagId, name, stamp)
        tagsAdded += 1
        seedIds.tags.push(tagId)
      }
      insertTaskTag.run(sample.id, tagId)
    }
  }
  return { tasksAdded, tasksSkipped, subtasksAdded, tagsAdded }
}

function seedIfNeeded(): void {
  const seeded = db.prepare('SELECT value FROM meta WHERE key = ?').get('demo_seeded') as
    | { value: string }
    | undefined
  if (seeded) return

  const en = seedLocale() === 'en'
  const now = new Date()
  const stamp = now.toISOString()

  const seed = db.transaction(() => {
    const insertProject = db.prepare(
      'INSERT INTO projects (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const projectIds: Record<string, string> = {}
    for (const key of ['polaris', 'personal'] as const) {
      const def = SAMPLE_PROJECTS[key]
      const id = SAMPLE_PROJECT_IDS[key]
      insertProject.run(id, en ? def.en : def.zh, def.color, def.sortOrder, stamp, stamp)
      projectIds[key] = id
      // demo_seed_ids 的 projects 键是给设置页「定位示例」留的账目，沿用。
    }
    const seedIds: DemoSeedIds = { tasks: [], projects: Object.values(projectIds), tags: [], subtasks: [] }

    // 首启种子 = 完整示例集（shared/sampleTasks.ts）：每条演示一个功能，用法
    // 写在备注里；新增功能（时间段/全天/跨天/信息层/打印）随示例集扩充自动
    // 出现在新装首启与「载入示例任务」里。提醒设在明天：首启不会立刻弹提醒窗。
    insertSampleTasks(en, now, projectIds, seedIds)

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('demo_seeded', '1')
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'demo_seed_ids',
      JSON.stringify(seedIds)
    )
  })

  seed()
}

// 「载入示例任务」（设置 → 数据与备份）：把当前版本的完整示例集合并进库。
// 项目按名称复用（老库种子项目是随机 ID），任务按固定 ID 幂等跳过——重复
// 点击只补新增示例，绝不覆盖现有数据。整体一个事务。
export function loadSampleTasks(locale: Locale): {
  tasksAdded: number
  tasksSkipped: number
  projectsCreated: number
  subtasksAdded: number
  tagsAdded: number
} {
  const en = locale === 'en'
  const now = new Date()
  const stamp = now.toISOString()
  const seedIds: DemoSeedIds = { tasks: [], projects: [], tags: [], subtasks: [] }
  const projectByName = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE')
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )

  const run = db.transaction(() => {
    const projectIds: Record<string, string> = {}
    let projectsCreated = 0
    for (const key of ['polaris', 'personal'] as const) {
      const def = SAMPLE_PROJECTS[key]
      const name = en ? def.en : def.zh
      const existing = (projectByName.get(name) as { id: string } | undefined)?.id
      if (existing) {
        projectIds[key] = existing
        continue
      }
      const id = SAMPLE_PROJECT_IDS[key]
      // 同名不存在但固定 ID 被占（理论上不可能）：换个随机 ID 兜底。
      const free = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)
        ? randomUUID()
        : id
      insertProject.run(free, name, def.color, def.sortOrder, stamp, stamp)
      projectIds[key] = free
      seedIds.projects.push(free)
      projectsCreated += 1
    }
    const counts = insertSampleTasks(en, now, projectIds, seedIds)
    return { ...counts, projectsCreated }
  })
  return run()
}

type TaskRow = {
  id: string
  title: string
  notes: string
  completed: number
  completed_at: string | null
  due_at: string | null
  start_at: string | null
  end_at: string | null
  all_day: number
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
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day === 1,
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
  const tagIdByName = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
  const taskTagExists = db.prepare('SELECT 1 FROM task_tags WHERE task_id = ? AND tag_id = ?')
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, completed_at, due_at, start_at, end_at, all_day, remind_at, reminded_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        task.startAt ?? null,
        task.endAt ?? null,
        task.allDay ? 1 : 0,
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
    // 标签按 id 去重；同名不同 id 时复用本地标签，并把备份 id 映射到本地 id——
    // 只跳过标签行、不建映射的话，后面所有 taskTags 都会因「备份 id 不存在」
    // 被静默丢掉，任务导入成功却没了标签。
    const tagIdMap = new Map<string, string>()
    for (const tag of data.tags ?? []) {
      if (tagExists.get(tag.id)) {
        tagIdMap.set(tag.id, tag.id)
        counts.tagsSkipped += 1
        continue
      }
      const sameName = tagIdByName.get(tag.name) as { id: string } | undefined
      if (sameName) {
        tagIdMap.set(tag.id, sameName.id)
        counts.tagsSkipped += 1
        continue
      }
      insertTag.run(tag.id, tag.name, tag.createdAt)
      tagIdMap.set(tag.id, tag.id)
      counts.tagsImported += 1
    }
    // 标签关联依赖任务与标签两侧：标签侧优先用映射（同名复用），没有映射时
    // 回退到「本地已存在同 id」（备份省略 tags 数组的旧文件）。
    for (const link of data.taskTags ?? []) {
      const mappedTagId =
        tagIdMap.get(link.tagId) ?? (tagExists.get(link.tagId) ? link.tagId : null)
      if (
        !mappedTagId ||
        taskTagExists.get(link.taskId, mappedTagId) ||
        !taskExists.get(link.taskId)
      ) {
        counts.taskTagsSkipped += 1
        continue
      }
      insertTaskTag.run(link.taskId, mappedTagId)
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

export function createTask(input: CreateTaskInput): Task {
  const title = input.title.trim()
  if (!title) throw new Error('任务标题不能为空')
  if (input.recurrenceRule && !input.dueAt) throw new Error(translate(getCurrentLocale(), 'errors.recurrenceNeedsDue'))

  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO tasks (id, title, notes, completed, due_at, start_at, end_at, all_day, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
    VALUES (?, ?, '', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    title,
    input.dueAt ?? null,
    input.startAt ?? null,
    input.endAt ?? null,
    input.allDay ? 1 : 0,
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
    startAt: input.startAt !== undefined ? input.startAt : existing.startAt,
    endAt: input.endAt !== undefined ? input.endAt : existing.endAt,
    allDay: input.allDay !== undefined ? input.allDay : existing.allDay,
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

  // 下一次实例继承计划时间段：开始随 due 的「墙钟日期差」整体平移（保留钟点，
  // 用本地 Y/M/D 构造日期，与 recurrence 的墙钟约定一致；DST 歧义解析到较早
  // 的一次，同 lib/dateTime.ts 的已知限制），结束按原时长跟随之；全天标记
  // 原样继承。没有开始时刻就不造一个。
  let spawnStartAt: string | null = null
  let spawnEndAt: string | null = null
  if (nextDate && next.startAt && next.dueAt) {
    const dueDay = new Date(next.dueAt)
    dueDay.setHours(0, 0, 0, 0)
    const nextDay = new Date(nextDate)
    nextDay.setHours(0, 0, 0, 0)
    const dayDiff = Math.round((nextDay.getTime() - dueDay.getTime()) / 86400000)
    const source = new Date(next.startAt)
    const spawnedStart = new Date(
      source.getFullYear(),
      source.getMonth(),
      source.getDate() + dayDiff,
      source.getHours(),
      source.getMinutes(),
      source.getSeconds(),
      source.getMilliseconds()
    )
    spawnStartAt = spawnedStart.toISOString()
    if (next.endAt) {
      const duration = new Date(next.endAt).getTime() - new Date(next.startAt).getTime()
      spawnEndAt = new Date(spawnedStart.getTime() + Math.max(0, duration)).toISOString()
    }
  }
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
      SET title = ?, notes = ?, completed = ?, completed_at = ?, due_at = ?, start_at = ?, end_at = ?, all_day = ?, remind_at = ?, reminded_at = ?, recurrence_rule = ?, project_id = ?, priority = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.notes,
      next.completed ? 1 : 0,
      completedAt,
      next.dueAt,
      next.startAt,
      next.endAt,
      next.allDay ? 1 : 0,
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
        INSERT INTO tasks (id, title, notes, completed, due_at, start_at, end_at, all_day, remind_at, recurrence_rule, project_id, priority, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        spawnedId,
        next.title,
        next.notes,
        nextDate.toISOString(),
        spawnStartAt,
        spawnEndAt,
        next.allDay ? 1 : 0,
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