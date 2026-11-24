// 数据存放位置：polaris.db 所在目录的唯一 owner。
//
// 设计边界：
// - 只有任务数据（polaris.db + backups/）跟随指定目录；日志、Chromium 缓存、
//   localStorage 留在默认 userData 不动。meta 表在库内，主题/语言/MCP token
//   随库走——重装后指回同一目录即可整体恢复。
// - 指针文件 data-location.json 落在默认 userData（userData 本身不迁，指针
//   位置固定）。启动时先于 initDatabase 解析；重装后默认 userData 还在则指针
//   直接生效，被清掉就在设置里重新指回。
// - 路径完全放开（用户拍板 2026-11-21）：不拦网盘同步文件夹，活跃库被同步
//   客户端直接同步的损坏风险由用户自担。
// - 运行期不换库：apply 后写指针 + pendingRestart，主进程延迟 relaunch；
//   will-quit 时同步 checkpoint + 覆盖复制，收掉「迁移到退出之间」的最后一刻
//   写入，两个位置的数据永不分叉。
// - 失败绝不半途生效：指针（或删指针）是最后一步，任何复制失败都保持现状，
//   应用继续在旧位置全功能运行，错误只进状态行。
import { app } from 'electron'
import log from 'electron-log/main'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { backupDbTo, checkpointCopyDbSync, writeSyncStampAt } from './db'
import { translate } from '../shared/i18n'
import { getCurrentLocale } from './locale'
import type { DataLocationState } from '../shared/types'

const POINTER_NAME = 'data-location.json'

// writeFileAtomic 依赖注入：模块定义在 index.ts，反向 import 会
// 成环；apply/reset 只在 whenReady 之后发生，注入前调用不可能出现。
export type DataLocationDeps = {
  writeFileAtomic: (filePath: string, content: string) => Promise<void>
}

let deps: DataLocationDeps | null = null
let defaultDir = ''
// 本次会话 initDatabase 实际打开的目录；重启前不因 apply 而变。
let activeDir = ''
// 指针生效中的自定义目录；null = 跑在默认位置。
let pointerDir: string | null = null
// 启动回退：指针存在但目标不可用。只作 state.error 的展示信号，具体路径进日志。
let fallbackFrom: string | null = null
// 已选择待确认的目录（渲染层确认后 apply）；取消即清空。
let offeredDir: string | null = null
let offeredAdopt = false
// 上次操作失败文案（设置行展示）；成功操作清空。
let opError: string | null = null
// 本次会话已 apply，等待重启生效；进程重启后自然归零。
let pendingRestart = false
let restartTarget: string | null = null

const pointerPath = (): string => join(defaultDir, POINTER_NAME)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** 读指针文件。区分三种情形：无文件（全新/从未设置）、指向合法目录、
 *  文件存在但内容或目标不可用（attemptedDir 供日志取证）。 */
function readPointer(): { dir: string | null; pointerExisted: boolean; attemptedDir: string | null } {
  let raw: string
  try {
    raw = readFileSync(pointerPath(), 'utf8')
  } catch {
    return { dir: null, pointerExisted: false, attemptedDir: null }
  }
  let attemptedDir: string | null = null
  try {
    const parsed = JSON.parse(raw) as { directory?: unknown }
    if (typeof parsed?.directory === 'string' && parsed.directory.trim().length > 0) {
      attemptedDir = parsed.directory.trim()
    }
  } catch {
    return { dir: null, pointerExisted: true, attemptedDir: null }
  }
  if (attemptedDir) {
    try {
      if (statSync(attemptedDir).isDirectory()) {
        return { dir: resolve(attemptedDir), pointerExisted: true, attemptedDir }
      }
    } catch {
      // 目标不存在/不可达：按回退处理，路径留在 attemptedDir。
    }
  }
  return { dir: null, pointerExisted: true, attemptedDir }
}

/** 启动解析：whenReady 内、initDatabase 之前调用一次。返回本次会话的
 *  数据目录；指针不可用时回退默认并记 fallbackFrom（state.error 展示）。 */
export function resolveDataDirectory(): string {
  defaultDir = app.getPath('userData')
  const { dir, pointerExisted, attemptedDir } = readPointer()
  if (dir && resolve(dir) !== resolve(defaultDir)) {
    activeDir = dir
    pointerDir = dir
    log.info('Polaris data directory (custom):', dir)
    return dir
  }
  activeDir = defaultDir
  // 指回默认目录是合法选择，不是回退；只有「指针存在但不可用」才报错。
  if (pointerExisted && dir === null) {
    fallbackFrom = attemptedDir ?? POINTER_NAME
    log.error('Polaris data location pointer unusable, falling back to default:', attemptedDir ?? pointerPath())
  } else if (dir) {
    log.info('Polaris data directory (default):', defaultDir)
  }
  return defaultDir
}

/** 运行期查询当前数据目录（initDatabase 已用该值建库）。 */
export function getDataDirectory(): string {
  return activeDir
}

export function initDataLocation(next: DataLocationDeps): void {
  deps = next
}

export function getDataLocationState(): DataLocationState {
  const error =
    opError ??
    (fallbackFrom !== null
      ? translate(getCurrentLocale(), 'dataLocation.fallback')
      : undefined)
  return {
    path: activeDir,
    defaultPath: defaultDir,
    isCustom: pointerDir !== null,
    pendingRestart,
    offered: offeredDir ?? undefined,
    offeredAdopt: offeredDir ? offeredAdopt : undefined,
    error: error || undefined
  }
}

/** 记录待确认的目标：可用性校验（mkdir + 目录 + 写探针）在这里做，渲染层
 *  确认框只负责「复制还是采用」的知情同意。传 null 清空（取消）。 */
export function setDataDirectoryOffer(directory: string | null): DataLocationState {
  offeredDir = null
  offeredAdopt = false
  opError = null
  const value = directory?.trim() ?? ''
  if (!value) return getDataLocationState()
  const target = resolve(value)
  if (target === resolve(activeDir)) {
    opError = translate(getCurrentLocale(), 'dataLocation.samePath')
    return getDataLocationState()
  }
  try {
    mkdirSync(target, { recursive: true })
    if (!statSync(target).isDirectory()) throw new Error('not a directory')
    const probe = join(target, `.polaris-probe-${randomUUID().slice(0, 8)}`)
    writeFileSync(probe, 'x', 'utf8')
    unlinkSync(probe)
  } catch (error) {
    opError = translate(getCurrentLocale(), 'dataLocation.invalid')
    log.warn('Polaris data location probe failed:', error)
    return getDataLocationState()
  }
  offeredDir = target
  offeredAdopt = existsSync(join(target, 'polaris.db'))
  return getDataLocationState()
}

/** 应用待确认位置：目标有库 → 采用（重装恢复路径，指针直接生效）；
 *  目标无库 → 复制当前库（在线一致性备份）+ 自动备份目录跟随。指针是
 *  最后一步——之前的任何失败都让现状原封不动。成功后 pendingRestart，
 *  主进程负责延迟 relaunch。 */
export async function applyDataDirectory(): Promise<DataLocationState> {
  const target = offeredDir
  if (!target || !deps) return getDataLocationState()
  const adopt = offeredAdopt
  try {
    if (!adopt) {
      await backupDbTo(join(target, 'polaris.db'))
      const sourceBackups = join(activeDir, 'backups')
      if (existsSync(sourceBackups)) {
        await cp(sourceBackups, join(target, 'backups'), { recursive: true, force: true })
      }
      // 应用自己落盘的目标库副本随写随记指纹，否则目标旁残留的旧指纹会把
      // 这笔应用内复制误判成外部修改（下次启动弹「检测到数据文件被外部修改」）。
      writeSyncStampAt(join(target, 'polaris.db'))
    }
    await deps.writeFileAtomic(pointerPath(), JSON.stringify({ directory: target }, null, 2))
    offeredDir = null
    offeredAdopt = false
    opError = null
    pendingRestart = true
    restartTarget = target
    log.info('Polaris data location applied:', target, adopt ? '(adopted)' : '(copied)')
    return getDataLocationState()
  } catch (error) {
    // 指针未写，现状不动：应用继续在旧位置运行，错误进状态行。
    opError = translate(getCurrentLocale(), 'dataLocation.copyFailed', { error: messageOf(error) })
    log.error('Polaris data location apply failed:', error)
    return getDataLocationState()
  }
}

/** 恢复默认位置：当前数据复制回默认目录（旧默认库先改名让位，绝不静默
 *  覆盖），然后删除指针。已在默认位置时无事可做。 */
export async function resetDataDirectory(): Promise<DataLocationState> {
  if (pointerDir === null) return getDataLocationState()
  const target = defaultDir
  try {
    const targetDb = join(target, 'polaris.db')
    if (existsSync(targetDb)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(targetDb, `${targetDb}.before-reset-${stamp}`)
    }
    await backupDbTo(targetDb)
    const sourceBackups = join(activeDir, 'backups')
    if (existsSync(sourceBackups)) {
      await cp(sourceBackups, join(target, 'backups'), { recursive: true, force: true })
    }
    // 恢复默认是误报重灾区：默认目录旁躺着上次退出写的旧指纹，复制出的新
    // 文件必然与之不符。随写随记，下次启动不再误报。
    writeSyncStampAt(targetDb)
    unlinkSync(pointerPath())
    opError = null
    pendingRestart = true
    restartTarget = target
    log.info('Polaris data location reset to default:', target)
    return getDataLocationState()
  } catch (error) {
    // 删指针在复制之后：复制失败时指针原样保留，下次启动仍回自定义位置。
    opError = translate(getCurrentLocale(), 'dataLocation.copyFailed', { error: messageOf(error) })
    log.error('Polaris data location reset failed:', error)
    return getDataLocationState()
  }
}

/** 渲染层取消确认框：清空 offer，主进程不残留待确认状态。 */
export function cancelDataDirectoryOffer(): DataLocationState {
  offeredDir = null
  offeredAdopt = false
  opError = null
  return getDataLocationState()
}

/** 测试专用：只翻转会话内存里的「指针生效」旗标（isCustom），让冒烟能断言
 *  「恢复默认」入口的出现与确认取消链路；不触碰 activeDir，也不写磁盘。
 *  生产路径 pointerDir 只在 resolveDataDirectory（启动）时赋值。 */
export function markPointerForTest(directory: string | null): void {
  pointerDir = directory ? resolve(directory) : null
}

/** will-quit 兜底：apply 到退出之间渲染层可能又写了任务。同步 checkpoint +
 *  覆盖复制，保证重启后读到的是最后状态。失败只留痕——db.backup 的快照
 *  仍在，最多丢最后几百毫秒的写入，绝不再回滚指针。 */
export function flushDataLocationOnQuit(): void {
  if (!pendingRestart || !restartTarget) return
  try {
    checkpointCopyDbSync(join(restartTarget, 'polaris.db'))
    // 最终覆盖复制替换了目标文件，指纹随之刷新——apply 时写的已经过期。
    writeSyncStampAt(join(restartTarget, 'polaris.db'))
    log.info('Polaris data location final copy flushed:', restartTarget)
  } catch (error) {
    log.error('Polaris data location final copy failed:', error)
  }
}
