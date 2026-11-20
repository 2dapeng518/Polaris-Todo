// L0 单设备云端镜像：唯一 owner。镜像 mcp.ts 的意图/状态分离——
// meta 记录用户意图与上次结果，内存记录实际写入门控与错误。
//
// 设计边界（设计文档 §15）：
// - 只写不读、零网络代码；载荷复用备份序列化（schemaVersion 3）。
// - 目标只有一个 <folder>/latest.json，滚动覆盖；原子写复用 writeFileAtomic。
// - 活库 polaris.db 绝不进同步文件夹：选目录时就拒绝包含 userData 的路径。
// - 文件夹不可用时静默暂停：开关保持开、错误进状态，应用全功能照常。
import { app } from 'electron'
import log from 'electron-log/main'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  exportBackup,
  getMeta,
  getWriteRevision,
  importBackup,
  listDemoSeedIds,
  removeDemoSeedRows,
  setMeta
} from './db'
import { shouldMirror } from '../shared/mirror'
import { translate } from '../shared/i18n'
import { getCurrentLocale } from './locale'
import type { BackupData, CloudMirrorState, ImportResult } from '../shared/types'
import type { BackupSchema } from './index'

const ENABLED_KEY = 'cloud_mirror_enabled'
const FOLDER_KEY = 'cloud_mirror_folder'
const LAST_KEY = 'cloud_mirror_last'
const ERROR_KEY = 'cloud_mirror_error'
const MIRROR_FILE = 'latest.json'

// 写修订变化去抖 30s；轮询 1s 只做一次单行 meta SELECT，成本可忽略。
// 测试通过 setMirrorMinGapMs 注入小值，生产路径永远走 30s。
export const MIRROR_MIN_GAP_MS = 30_000
const TICK_MS = 1_000

export type MirrorDeps = {
  buildBackupPayload: () => BackupData
  writeFileAtomic: (filePath: string, content: string) => Promise<void>
}

let deps: MirrorDeps | null = null
let timer: NodeJS.Timeout | null = null
let dirty = false
let writing = false
let disposed = false
// 用户意图的内存镜像：tick 关闭时完全不碰数据库；setMirrorEnabled 是唯一写入口。
let enabled = false
// 恢复守卫：重装后指回网盘、本机仍只有教学示例时，必须先恢复再写，
// 否则第一份快照就会用示例数据覆盖云端唯一的历史。
let recoveryHold = false
let lastAttemptAt: number | null = null
let lastError: string | null = null
let lastSeenRevision = 0
let minGapMs = MIRROR_MIN_GAP_MS

const enabledFlag = (): boolean => getMeta(ENABLED_KEY) === '1'

const folderPath = (): string | null => {
  const value = getMeta(FOLDER_KEY)
  return value && value.trim().length > 0 ? value : null
}

const readLastAt = (): string | null => {
  const value = getMeta(LAST_KEY)
  return value && Number.isFinite(Date.parse(value)) ? value : null
}

function setLastError(message: string | null): void {
  lastError = message
  setMeta(ERROR_KEY, message ?? '')
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** 选目录硬守卫：目标必须是真实目录，且绝不能是 userData 本身、userData 的
 *  子目录，或 userData 的父目录（父目录会把整个活库卷进同步范围）。
 *  Windows 路径大小写不敏感，realpath 之后再统一小写比较，避免换一种大小写
 *  就绕过守卫。 */
async function isUsableMirrorFolder(folder: string): Promise<boolean> {
  try {
    const info = await stat(folder)
    if (!info.isDirectory()) return false
    const [targetRaw, userDataRaw] = await Promise.all([
      realpath(folder),
      realpath(app.getPath('userData'))
    ])
    const norm = (value: string): string =>
      process.platform === 'win32' ? value.toLowerCase() : value
    const target = norm(resolve(targetRaw))
    const userData = norm(resolve(userDataRaw))
    if (
      target === userData ||
      target.startsWith(userData + sep) ||
      userData.startsWith(target + sep)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** 本机是否仍是「只有首启教学示例」的库：demo_seeded 旗标在，且每个项目/
 *  任务/标签/子任务 id 都在种子清单里。清单缺失（旧库）或解析失败一律返回
 *  false——恢复提示宁可不出现，也绝不误清用户数据。 */
export function isDemoOnlyLibrary(): boolean {
  if (getMeta('demo_seeded') !== '1') return false
  const ids = listDemoSeedIds()
  if (!ids) return false
  const taskIds = new Set(ids.tasks)
  const projectIds = new Set(ids.projects)
  const tagIds = new Set(ids.tags)
  const subtaskIds = new Set(ids.subtasks)
  if (taskIds.size === 0 && projectIds.size === 0) return false
  const data = exportBackup()
  return (
    data.projects.every((project) => projectIds.has(project.id)) &&
    data.tasks.every((task) => taskIds.has(task.id)) &&
    data.tags.every((tag) => tagIds.has(tag.id)) &&
    data.subtasks.every((subtask) => subtaskIds.has(subtask.id))
  )
}

/** 镜像目标文件路径；尚未选目录时为 null。 */
export function mirrorLatestPath(): string | null {
  const folder = folderPath()
  return folder ? join(folder, MIRROR_FILE) : null
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

/** 恢复候选：目录里已有 latest.json，且本机仍是首启教学示例。
 *  fileExists 先于导出快照——普通开启路径不该为此做一次全库序列化。 */
async function recoveryCandidate(folder: string): Promise<boolean> {
  return (await fileExists(join(folder, MIRROR_FILE))) && isDemoOnlyLibrary()
}

/** 写一份快照。返回是否真的写成功；失败时开关保持开、错误进状态，
 *  等下一次 30s 重试（或用户再次开启/选目录时立即重试）。 */
async function writeSnapshot(force = false): Promise<boolean> {
  if (!deps || disposed || writing) return false
  if (!enabled) return false
  const folder = folderPath()
  if (!folder) return false

  // 恢复守卫（force 只给「刚导入成功」用）：本机仍是教学示例、当前目录还
  // 没成功镜像过、且已有 latest.json —— 先别写，等用户恢复或产生真实数据。
  // 守卫跳过时把 dirty 清零，避免每秒重复做一次全库序列化；下一次写修订
  // 变化会重新标脏，届时若已有用户数据则自动放行。
  if (!force && (recoveryHold || readLastAt() === null)) {
    if (await recoveryCandidate(folder)) {
      recoveryHold = true
      dirty = false
      return false
    }
    recoveryHold = false
  }
  if (force) recoveryHold = false

  writing = true
  lastAttemptAt = Date.now()
  const target = join(folder, MIRROR_FILE)
  try {
    if (!(await isUsableMirrorFolder(folder))) {
      throw new Error(translate(getCurrentLocale(), 'mirror.folderUnavailable', { path: folder }))
    }
    // 先读修订号再序列化：若序列化期间有写入落地，当前修订号会比这个值新，
    // 下一 tick 会再次标脏补写。方向保证「多写」而不是「漏写」。
    const revisionAtStart = getWriteRevision()
    const payload = deps.buildBackupPayload()
    await deps.writeFileAtomic(target, JSON.stringify(payload, null, 2))
    dirty = false
    recoveryHold = false
    lastSeenRevision = revisionAtStart
    setMeta(LAST_KEY, new Date().toISOString())
    if (lastError !== null) setLastError(null)
    log.info('Cloud mirror written:', target)
    return true
  } catch (error) {
    const message = translate(getCurrentLocale(), 'mirror.writeFailed', {
      error: messageOf(error)
    })
    // 同一错误只留一条日志：静默重试不该按 30s 刷屏。
    if (lastError !== message) log.warn(message)
    setLastError(message)
    dirty = true
    return false
  } finally {
    writing = false
  }
}

function tick(): void {
  if (disposed || !enabled) return
  const revision = getWriteRevision()
  if (revision !== lastSeenRevision) {
    lastSeenRevision = revision
    dirty = true
  }
  if (!dirty) return
  const due = shouldMirror({
    enabled,
    folder: folderPath(),
    dirty,
    lastAttemptAt,
    now: Date.now(),
    minGapMs
  })
  if (due) void writeSnapshot()
}

export function initMirror(injected: MirrorDeps): void {
  deps = injected
  disposed = false
  dirty = false
  writing = false
  recoveryHold = false
  minGapMs = MIRROR_MIN_GAP_MS
  enabled = enabledFlag()
  lastSeenRevision = getWriteRevision()
  const last = getMeta(LAST_KEY)
  lastAttemptAt = last && Number.isFinite(Date.parse(last)) ? Date.parse(last) : null
  lastError = getMeta(ERROR_KEY) || null

  if (timer) clearInterval(timer)
  if (enabled) {
    dirty = true
    // 启动写一份：上次退出期间的修改一律补进镜像，不受 30s 去抖限制。
    // 恢复守卫在 writeSnapshot 内部生效。
    void writeSnapshot()
  }
  timer = setInterval(tick, TICK_MS)
}

export function disposeMirror(): void {
  disposed = true
  if (timer) clearInterval(timer)
  timer = null
  deps = null
}

/** 测试专用：把去抖间隔缩到毫秒级，避免测试真等 30 秒。 */
export function setMirrorMinGapMs(value: number): void {
  minGapMs = Number.isFinite(value) && value >= 0 ? value : MIRROR_MIN_GAP_MS
}

export async function getMirrorState(): Promise<CloudMirrorState> {
  const enabledNow = enabledFlag()
  const folder = folderPath()
  const lastMirrorAt = readLastAt()
  const latest = folder ? join(folder, MIRROR_FILE) : null
  const folderOk = folder ? await isUsableMirrorFolder(folder) : true
  // 文件夹被外部移走时不必等下一次写失败：设置页读状态就能看到暂停原因。
  // 应用其余功能完全不受影响，error 只替换描述行文案。
  const error =
    lastError ??
    (enabledNow && folder && !folderOk
      ? translate(getCurrentLocale(), 'mirror.folderUnavailable', { path: folder })
      : null)
  // 恢复提示只对「本目录从未成功镜像过 + 仅教学示例 + 已有快照」成立：
  // 一旦写过，latest.json 就是自己的产物，不需要恢复；这也避免恢复完成后
  // 提示还赖着不走。
  const recoveryAvailable =
    latest !== null &&
    lastMirrorAt === null &&
    (await fileExists(latest)) &&
    isDemoOnlyLibrary()
  return {
    enabled: enabledNow,
    folder,
    lastMirrorAt,
    pending: enabledNow && dirty,
    recoveryAvailable,
    error: error ?? undefined
  }
}

export async function setMirrorEnabled(next: boolean): Promise<CloudMirrorState> {
  if (next !== enabled) {
    // 开关变化时清掉恢复守卫；关闭后重新打开会重新判定（目录可能已经换了）。
    recoveryHold = false
  }
  setMeta(ENABLED_KEY, next ? '1' : '0')
  enabled = next
  if (!next) {
    dirty = false
    lastAttemptAt = null
    setLastError(null)
    return getMirrorState()
  }
  // 开启即写一份；但先做恢复检测：重装后指回网盘时，第一份快照绝不能
  // 用教学示例覆盖云端历史。命中守卫时开关保持开、状态提示恢复。
  dirty = true
  lastAttemptAt = null
  const folder = folderPath()
  if (folder && readLastAt() === null && (await recoveryCandidate(folder))) {
    recoveryHold = true
    dirty = false
  } else {
    recoveryHold = false
    await writeSnapshot()
  }
  return getMirrorState()
}

export async function setMirrorFolderPath(folder: string | null): Promise<CloudMirrorState> {
  const value = folder ? folder.trim() : ''
  if (!value) {
    setMeta(FOLDER_KEY, '')
    dirty = false
    recoveryHold = false
    lastAttemptAt = null
    setLastError(null)
    return getMirrorState()
  }
  if (!(await isUsableMirrorFolder(value))) {
    // 保留上一个可用目录：一次选错不该把正在工作的镜像关掉。
    setLastError(translate(getCurrentLocale(), 'mirror.folderInvalid'))
    return getMirrorState()
  }
  const previous = folderPath()
  setMeta(FOLDER_KEY, value)
  if (previous !== value) {
    // 换目录等于换了一份云端历史：清掉「本目录写过」的印记，重新做恢复检测。
    setMeta(LAST_KEY, '')
    lastAttemptAt = null
  }
  setLastError(null)
  dirty = true
  if (enabled) {
    if (readLastAt() === null && (await recoveryCandidate(value))) {
      recoveryHold = true
      dirty = false
    } else {
      recoveryHold = false
      await writeSnapshot()
    }
  }
  return getMirrorState()
}

/** 立即补写一次（恢复导入后调用）：不等 30s 去抖，并解除恢复守卫——
 *  此时本地已经不是「仅教学示例」，写回的是刚合并完的真实数据。 */
export async function flushMirrorNow(): Promise<boolean> {
  if (!enabled) return false
  dirty = true
  return writeSnapshot(true)
}

/** 读取镜像快照并整体校验，再按 ID 非破坏性合并。clearDemo 只在恢复路径
 *  为 true：先确认本机仅有教学示例，再在导入成功后精确清掉这些种子行；
 *  快照里本来就有的 id 必须保留，否则恢复同一份快照会把库清空。 */
export async function importMirrorFile(
  source: string,
  schema: BackupSchema,
  maxBytes: number,
  clearDemo = false
): Promise<ImportResult> {
  try {
    const info = await stat(source)
    if (!info.isFile()) {
      return { ok: false, error: translate(getCurrentLocale(), 'mirror.importNotFile') }
    }
    if (info.size > maxBytes) {
      return {
        ok: false,
        error: translate(getCurrentLocale(), 'native.importTooLarge', {
          limit: maxBytes / (1024 * 1024)
        })
      }
    }
    const raw = await readFile(source, 'utf8')
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return { ok: false, error: translate(getCurrentLocale(), 'mirror.invalidJson') }
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      return { ok: false, error: translate(getCurrentLocale(), 'mirror.invalidBackup') }
    }
    const wasDemoOnly = isDemoOnlyLibrary()
    const counts = importBackup(parsed.data)
    let demoSeedsRemoved = false
    if (clearDemo && wasDemoOnly) {
      const keep = new Set<string>()
      for (const project of parsed.data.projects) keep.add(project.id)
      for (const task of parsed.data.tasks) keep.add(task.id)
      for (const tag of parsed.data.tags ?? []) keep.add(tag.id)
      for (const subtask of parsed.data.subtasks ?? []) keep.add(subtask.id)
      demoSeedsRemoved = removeDemoSeedRows(keep)
    }
    return { ok: true, ...counts, demoSeedsRemoved }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}