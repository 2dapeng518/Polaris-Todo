import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell, type WebContents } from 'electron'
import log from 'electron-log/main'
import { join } from 'node:path'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getAutoStartState, setAutoStartState } from './autostart'
import {
  exportBackup,
  getMeta,
  getWriteRevision,
  importBackup,

  closeDatabase,
  detectExternalDbChange,
  initDatabase,
  purgeExpiredDeleted,
  setMeta,
  writeDbSyncStamp
} from './db'
import { csvExportFromBackup } from '../shared/csvExport'
import { registerIpc } from './ipc'
import { disposeMcp, getMcpState, getMcpToken, initMcp, regenerateMcpToken, setMcpEnabled } from './mcp'
import {
  applyDataDirectory,
  cancelDataDirectoryOffer,
  flushDataLocationOnQuit,
  getDataDirectory,
  getDataLocationState,
  initDataLocation,
  resetDataDirectory,
  resolveDataDirectory,
  setDataDirectoryOffer
} from './dataLocation'
import { describeTrayCheck, disposeUpdater, initUpdater, manualCheckForUpdates, refreshUpdateState } from './updater'
import {
  applySettingsWindowTheme,
  closeSettingsWindow,
  getSettingsWindow,
  initSettingsWindow,
  isSettingsWebContents,
  openSettingsWindow,
  settingsSectionFrom
} from './settingsWindow'
import {
  disposeGlobalHotkey,
  getGlobalHotkeyState,
  initGlobalHotkey,
  probeHotkeyAccelerators,
  setGlobalHotkeyAccelerator,
  setGlobalHotkeyEnabled
} from './hotkey'
import { getCurrentTheme, initAppTheme, setCurrentTheme, themeBackgroundColor } from './theme'
import { getCurrentLocale, initAppLocale, setCurrentLocale } from './locale'
import { translate, type Locale } from '../shared/i18n'
import type { BackupData } from '../shared/types'
import { AUTO_BACKUP_PREFIX, isAutoBackupFileName } from '../shared/backupNames'
import { hasSplashWindow, openSplashWindow, revealMainWindow } from './splash'
import { isAppTheme, THEME_SYMBOL_COLOR, themeFamily } from '../shared/themes'
import { dismissReminder, startReminderScheduler } from './reminders'
import { createTray, showTrayBalloon, updateTrayLocale } from './tray'
import { TRAY_ICON_DATA_URL } from './tray-icon'

// 持久化日志尽早初始化：文件落 userData/logs/main.log（electron-log 默认路径），
// 单文件 1MB 上限，写满轮转为 main.old.log（默认保留一份旧档，最多占 ~2MB）。
// 生产与开发都写文件——打包后 stdout 无处可去，更新失败/DB 异常靠文件取证；
// console 传输保留（开发体验不变）。生产主进程模块一律用 log.*，不再裸 console；
// harness/ 目录的 console 是冒烟输出协议（POLARIS_SMOKE_*）的一部分，不在此列。
log.initialize()
log.transports.file.maxSize = 1024 * 1024

// 仅类型导出：harness 的 HarnessContext 要引用同一份 schema 类型（safeParse
// 检查 v1/v2 缺省字段）。类型在编译期擦除，不产生任何运行时反向依赖。
export type BackupSchema = typeof backupSchema

// 备份文件整体校验：版本号/来源标识 + 项目/任务字段，重复任务必须带截止。
// 校验通过才落库，非法文件整体拒绝，绝不部分写入。
const backupTaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(500),
    notes: z.string().max(20000),
    completed: z.boolean(),
    completedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    remindAt: z.string().nullable(),
    remindedAt: z.string().nullable(),
    recurrenceRule: z.string().nullable(),
    projectId: z.string().nullable(),
    priority: z.number().int().min(0).max(3),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable()
  })
  .refine((task) => !task.recurrenceRule || task.dueAt, '重复任务需要截止时间')

const backupSubtaskSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string().min(1).max(500),
  completed: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string()
})

const backupTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  createdAt: z.string()
})

const backupTaskTagSchema = z.object({
  taskId: z.string().min(1),
  tagId: z.string().min(1)
})

const backupSchema = z.object({
  // v1（无 subtasks）与 v2（无 tags）都继续可导入；v3 起带标签与关联。
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  app: z.literal('polaris'),
  exportedAt: z.string(),
  projects: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(80),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      sortOrder: z.number().int(),
      createdAt: z.string(),
      updatedAt: z.string()
    })
  ),
  tasks: z.array(backupTaskSchema),
  // 旧备份没有这两个字段，缺省即「没有标签数据」。
  tags: z.array(backupTagSchema).optional().default([]),
  taskTags: z.array(backupTaskTagSchema).optional().default([]),
  // 旧备份没有这个字段，缺省即「没有检查清单数据」。
  subtasks: z.array(backupSubtaskSchema).optional().default([])
})

// 原子写：先写同目录临时文件再 rename（同文件系统内 rename 是原子操作），
// 避免导出写到一半崩溃留下半截备份。失败时清理临时文件，不留垃圾。
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(tempPath, content, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

// 导入读取上限：备份 JSON 50MB。readFile 前先 stat，超限明确报错，
// 绝不把超大文件整个读进内存。
const IMPORT_JSON_MAX_BYTES = 50 * 1024 * 1024

// ---------- 导航守卫 ----------
// 外链白名单：只放行 https/http/mailto，其余协议（file:/javascript:/自定义协议等）
// 一律拒绝，不交给系统打开。
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

function openExternalSafe(url: string): void {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) void shell.openExternal(url)
  } catch {
    // 非法 URL 直接拒绝。
  }
}

// 应用自身页面：dev server 同源 URL，或打包后 renderer 目录内的本地文件
// （主窗口 index.html 与启动页 splash.html 都在这个目录里，query/hash 不限）。
function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url)
    const devBase = process.env['ELECTRON_RENDERER_URL']
    if (devBase) return target.origin === new URL(devBase).origin
    if (target.protocol !== 'file:') return false
    const rendererDir = join(__dirname, '../renderer').replace(/\\/g, '/').toLowerCase()
    const filePath = fileURLToPath(target).replace(/\\/g, '/').toLowerCase()
    return filePath.startsWith(`${rendererDir}/`)
  } catch {
    return false
  }
}

// 所有窗口（主窗口/提醒窗/启动页）共用一套守卫：
// - setWindowOpenHandler：新窗一律拒绝，外链走白名单 openExternal；
// - will-navigate：放行应用自身 URL，其余拦截后走同一份白名单——
//   更新说明里 DOMPurify 后的 <a href> 不再把整个应用同窗导航走。
function guardWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternalSafe(url)
  })
}

// web-contents-created 在每个窗口的 webContents 诞生时触发（早于任何加载），
// 因此提醒窗与启动页无需各自重复设置，天然被同一份守卫覆盖。
app.on('web-contents-created', (_event, contents) => {
  guardWebContents(contents)
})

// 进程级兜底留痕：未处理的 Promise 拒绝与未捕获异常只记日志，不让主进程
// 静默崩溃（启动链本身的失败由 whenReady 的 catch 负责报错退出）。
process.on('unhandledRejection', (reason) => {
  log.error('Polaris unhandled rejection:', reason)
})
process.on('uncaughtException', (error) => {
  log.error('Polaris uncaught exception:', error)
})

// data:export 与启动自动备份共用的同一份序列化逻辑，不新造格式。
function buildBackupPayload(): BackupData {
  const { projects, tasks, tags, taskTags, subtasks } = exportBackup()
  return {
    schemaVersion: 3,
    app: 'polaris',
    exportedAt: new Date().toISOString(),
    projects,
    tasks,
    tags,
    taskTags,
    subtasks
  }
}

// 自动备份：启动时 + 运行期每小时兜底检查，最新一份超过设定周期（或不存在）
// 才写一份，复用导出序列化 + 原子写，保留最近 21 份（对齐 Csv 的保留份数）。
// 周期可配（meta auto_backup_interval_hours，0 = 关闭），存 meta 表不进迁移；
// 运行期兜底修掉「托盘长驻几天不重启就不备份」的空窗。失败只留痕，不阻塞启动。
const AUTO_BACKUP_KEEP = 21
const AUTO_BACKUP_INTERVAL_META = 'auto_backup_interval_hours'
const AUTO_BACKUP_INTERVAL_CHOICES = [0, 12, 24, 72, 168]
const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000

function readAutoBackupIntervalHours(): number {
  // 没设置过（键不存在）要落到默认档：getMeta 对缺失键返回 null，而 Number(null)
  // 是 0，直接转会把「从未设置」当成用户选了「关闭」，自动备份静默停摆。
  const stored = getMeta(AUTO_BACKUP_INTERVAL_META)
  const raw = stored ? Number(stored) : NaN
  return AUTO_BACKUP_INTERVAL_CHOICES.includes(raw) ? raw : 24
}

async function runAutoBackup(): Promise<void> {
  try {
    const intervalHours = readAutoBackupIntervalHours()
    if (intervalHours <= 0) return
    const dir = join(getDataDirectory(), 'backups')
    await mkdir(dir, { recursive: true })
    const listBackups = async (): Promise<string[]> =>
      (await readdir(dir))
        .filter((name) => name.startsWith(AUTO_BACKUP_PREFIX) && name.endsWith('.json'))
        .sort()
    const existing = await listBackups()
    const latest = existing[existing.length - 1]
    if (latest) {
      const info = await stat(join(dir, latest))
      if (Date.now() - info.mtimeMs < intervalHours * 60 * 60 * 1000) return
    }
    // 文件名用 ISO 时间戳（冒号/点换成连字符，Windows 合法），字典序即时间序。
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `${AUTO_BACKUP_PREFIX}${stamp}.json`
    await writeFileAtomic(join(dir, backupName), JSON.stringify(buildBackupPayload(), null, 2))
    // 里程碑留痕：备份写成才记一条，跳过（周期内已有）不记，不刷屏。
    log.info('Polaris auto backup written:', backupName)
    const after = await listBackups()
    for (const name of after.slice(0, Math.max(0, after.length - AUTO_BACKUP_KEEP))) {
      await unlink(join(dir, name)).catch(() => {})
    }
  } catch (error) {
    log.error('Polaris auto backup failed:', error)
  }
}

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// 数据目录切换后的自动重启：延迟让 invoke 响应与状态文案先落地（同 updater
// install 的延迟节奏）。harness 构建不真重启，保持冒烟确定性。
// relaunch 自带 --polaris-relaunch-wait 旗标：Electron 在旧主进程退出的瞬间
// 就拉起新实例，而旧实例的 GPU/工具等子进程往往还要几百毫秒才死透——新实例
// 的渲染进程会与它们在同一个默认 userData 上抢 GPU 缓存 / Local Storage 锁，
// 首帧后整体僵死。带旗标的实例在启动最前面同步等旧进程退场，再请求单实例
// 锁、走正常启动链。
// dev（electron-vite）下自动重启无法闭环，只能保持运行 + 待重启状态行：
// - app.quit() 会连带 electron-vite 与 vite server 一起退场，relaunch 拉起的
//   孤儿实例继承的 ELECTRON_RENDERER_URL 指向已死端口，两扇窗只能加载错误页
//   /空白（用户实测；"splash painted" 实为错误页首帧，chainWaitMs 卡满竞速
//   兜底）。
// - electron-vite 的主进程热重启是可选项（dev -w），且其重启是 child.kill()
//   硬杀——will-quit 不触发，退出收拢链（checkpoint / 关库 / 指纹）全部跳过，
//   下次启动误报「数据文件在应用外被改动」；为一次数据切换给整个 dev 工作流
//   引入 -w 不值当。
// 所以 dev 下切换后保持运行，状态行如实显示「重启后生效」，数据指针已落盘，
// 开发者手动重启 dev 即在新位置换库。打包版走完整自动重启（见下方 relaunch）。
let relaunchTimer: NodeJS.Timeout | null = null
function scheduleRelaunch(state: { pendingRestart: boolean }): void {
  if (relaunchTimer) clearTimeout(relaunchTimer)
  relaunchTimer = null
  if (!state.pendingRestart) return
  if (__POLARIS_HARNESS__) return
  if (!app.isPackaged) return
  relaunchTimer = setTimeout(() => {
    app.relaunch({ args: [RELAUNCH_WAIT_ARG, ...process.argv.slice(1)] })
    isQuitting = true
    app.quit()
  }, 800)
}

const RELAUNCH_WAIT_ARG = '--polaris-relaunch-wait'
const RELAUNCH_WAIT_MS = 2000
const isRelaunchBoot = process.argv.includes(RELAUNCH_WAIT_ARG)

// 关窗是否驻留托盘（meta 持久化，默认开）。关掉后关窗=退出应用，提醒随之停止。
const closeToTrayEnabled = (): boolean => getMeta('close_to_tray') !== '0'

// --hidden 自启静默进托盘；harness 构建下三个测试 env 强制可见窗口。
// 生产构建 __POLARIS_HARNESS__ 恒 false，这段 env 读取被编译期消除，自启行为不变。
let startHidden = process.argv.includes('--hidden')
if (__POLARIS_HARNESS__) {
  startHidden =
    startHidden &&
    !process.env['POLARIS_SMOKE'] &&
    !process.env['POLARIS_SHOT'] &&
    !process.env['POLARIS_SCREENSHOT']
}

// 渲染层首帧的语言来自 URL：主进程的 meta 记录是权威值。
const withLocale = (url: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}locale=${getCurrentLocale()}`

// relaunch 启动的实例先等旧实例彻底退场（子进程释放 GPU 缓存 / Local Storage
// 锁），再请求锁、走启动链。Atomics.wait 是启动期的一次性阻塞：此刻尚无窗口
// 与异步任务，等待本身无副作用；旧实例退场通常 <1s，2s 足够宽。
if (isRelaunchBoot) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RELAUNCH_WAIT_MS)
  log.info('relaunch boot: previous instance exit grace elapsed')
}
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

function createWindow(): void {
  // 低分辨率屏：默认与最小尺寸不得超过当前屏幕工作区，
  // 否则窗口被 minHeight 顶出屏幕，下缘永远够不到。
  const workArea = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: Math.min(1280, workArea.width),
    height: Math.min(840, workArea.height),
    icon: nativeImage.createFromDataURL(TRAY_ICON_DATA_URL),
    minWidth: Math.min(980, workArea.width),
    minHeight: Math.min(640, workArea.height),
    show: false,
    backgroundColor: themeBackgroundColor(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: THEME_SYMBOL_COLOR[themeFamily(getCurrentTheme())],
      height: 48
    },
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (hasSplashWindow()) {
      if (mainWindow) revealMainWindow(mainWindow)
      return
    }
    if (!startHidden) mainWindow?.show()
  })

  // 主帧真正加载失败时也要收起启动页，把主窗口（哪怕是错误页）交给用户，
  // 不能让人永远挡在启动页后面。-3 (ABORTED) 是快速重载的正常副产物，忽略。
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && hasSplashWindow() && mainWindow) {
      revealMainWindow(mainWindow)
    }
  })

  // 分辨率变化/外接屏热插拔：按窗口所在屏的新工作区重收最小尺寸，
  // 非最大化的超界窗口拉回屏内。最大化窗口由系统贴合工作区，不动。
  screen.on('display-metrics-changed', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const wa = screen.getDisplayMatching(mainWindow.getBounds()).workAreaSize
    mainWindow.setMinimumSize(Math.min(980, wa.width), Math.min(640, wa.height))
    if (!mainWindow.isMaximized()) {
      const [w, h] = mainWindow.getSize()
      const nw = Math.min(w, wa.width)
      const nh = Math.min(h, wa.height)
      if (nw !== w || nh !== h) mainWindow.setSize(nw, nh)
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && closeToTrayEnabled()) {
      event.preventDefault()
      // 设置窗口是主窗口的子窗口：主窗口进托盘时它一并收起，不独自留在屏幕上。
      closeSettingsWindow()
      mainWindow?.hide()
    }
  })

  // 新窗拦截与同窗导航守卫统一在 web-contents-created 里注册（guardWebContents），
  // 主窗口/提醒窗/启动页共用同一份外链白名单，这里不再单独设置。

  // 界面语言随地址传给渲染层：主进程的 meta 记录是权威值，渲染层首帧据此
  // 初始化（冒烟/截图模式下 initAppLocale 默认确定性 zh-CN，POLARIS_LOCALE 可覆盖）。
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(withLocale(process.env['ELECTRON_RENDERER_URL']))
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { locale: getCurrentLocale() }
    })
  }

  // 测试 harness 入口：__POLARIS_HARNESS__ 由 electron.vite.config.ts 的 define 在构建期注入。
  // 生产构建恒为 false，整个分支连同动态 import 被 DCE 消除——harness（含删库级
  // 操作）不落生产产物；harness 构建（POLARIS_HARNESS=1）里由 harness 内部按 env 分流。
  // 动态 import 在微任务里解析，did-finish-load 来自事件循环，不可能抢在前面。
  if (__POLARIS_HARNESS__) {
    const win = mainWindow
    void import('./harness')
      .then((h) => {
        h.attachHarness({
          mainWindow: win,
          backupSchema,
          writeFileAtomic,
          revealQuickCapture,
          revealSettings,
          checkUpdatesFromTray,
          getSettingsWindow
        })
      })
      .catch((error: unknown) => {
        log.error('Polaris harness attach failed:', error)
      })
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  // 启动页还在时走同一条过渡，避免托盘/第二实例把主窗口直接怼到启动页前面。
  if (hasSplashWindow()) {
    revealMainWindow(mainWindow)
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// 主进程 → 渲染层的动作统一走这条路：先按现有路径唤起窗口，等页面可执行，
// 再用 executeJavaScript 派发一个固定字符串事件，不插值、不加 IPC。
// 目前只有全局热键（polaris:quick-add）走这条路；不许出现第二条聚焦/唤起路径。
async function revealAndDispatch(script: string): Promise<void> {
  showMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return

  const contents = mainWindow.webContents
  if (contents.isLoading()) {
    await new Promise<void>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        contents.removeListener('did-finish-load', finish)
        resolve()
      }
      timer = setTimeout(finish, 3000)
      contents.once('did-finish-load', finish)
    })
  }
  if (contents.isDestroyed()) return

  await contents.executeJavaScript(script).catch(() => {
    // 页面尚未可执行时这次触发落空，下次再点仍可用；不打断主进程。
  })
}

// 全局热键的唯一动作：N 键那条 polaris:quick-add 事件原样送进渲染层
// （detail.forceToday 让它切回「今天」）。
async function revealQuickCapture(): Promise<void> {
  await revealAndDispatch(
    "window.dispatchEvent(new CustomEvent('polaris:quick-add', { detail: { forceToday: true } }))"
  )
}

// 托盘「设置」：先唤起主窗口，再打开设置窗口（设置窗口是主窗口的子窗口，
// 不能在没有可见属主的情况下独自出现）。已开着就唤到前台，不叠第二扇。
async function revealSettings(): Promise<void> {
  showMainWindow()
  openSettingsWindow()
}

// 托盘「检查更新」：手动检查永远给答案 —— 气泡负责「已是最新/失败/不支持」
// 这类不值得开窗的结果；只有更新值得看（发现/下载中/已就绪）才唤起主窗口，
// 弹窗本身仍由渲染层既有的 update:state 推送驱动，这里不另做 UI。
async function checkUpdatesFromTray(): Promise<void> {
  const result = await manualCheckForUpdates()
  const feedback = describeTrayCheck(result)
  showTrayBalloon('Polaris', feedback.balloon)
  if (feedback.surface) showMainWindow()
}

app.on('second-instance', () => {
  if (app.isReady()) {
    showMainWindow()
  } else {
    void app.whenReady().then(showMainWindow)
  }
})

// 原生文件对话框的父窗：谁发起就挂在谁上面——设置窗口里点导出/导入/选目录，
// 对话框是设置窗口的模态框，主窗口照常可用；发起方不是窗口（或已销毁）时
// 退回主窗口，主窗口也可能为 null，此时走无父窗重载，不用非空断言。
function ownerWindowOf(contents?: WebContents): BrowserWindow | null {
  const owner = contents ? BrowserWindow.fromWebContents(contents) : null
  if (owner && !owner.isDestroyed()) return owner
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function showOpenDialogSafe(
  options: Electron.OpenDialogOptions,
  contents?: WebContents
): Promise<Electron.OpenDialogReturnValue> {
  const owner = ownerWindowOf(contents)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

function showSaveDialogSafe(
  options: Electron.SaveDialogOptions,
  contents?: WebContents
): Promise<Electron.SaveDialogReturnValue> {
  const owner = ownerWindowOf(contents)
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}

// 全局设置（主题/语言）的写回属主：主窗口，或设置窗口（用户在那里点色样、
// 换语言）。提醒窗口只读跟随，回传的同步值一律不回写。
function ownsGlobalSettings(contents: WebContents): boolean {
  if (mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents) return true
  return isSettingsWebContents(contents)
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  // 启动里程碑：版本 + 是否打包 + userData 位置，一条定位用户机器环境。
  log.info(`Polaris ${app.getVersion()} starting (packaged: ${app.isPackaged}, userData: ${app.getPath('userData')})`)

  // 数据目录先于建库解析：指针文件在默认 userData，指向 polaris.db 的家。
  // 指针不可用时回退默认并记 fallback（后面有一次性提示框），建库照常。
  const dataDirectory = resolveDataDirectory()
  // 外部变更检测（开库之前）：指纹与磁盘现状不一致 = 文件在上次退出后被
  // 外部动过（其他设备的网盘同步 / 上次未正常退出）。无指纹（首次运行/
  // 刚换数据目录）返回 null，不构成信号。
  const externalDbChange = detectExternalDbChange(dataDirectory)
  // 损坏库会被改名隔离并重建空库；quarantinedPath 非空时启动后告知用户。
  const { quarantinedPath } = initDatabase(dataDirectory)
  // Missed retention windows are caught up on launch, same as missed reminders.
  purgeExpiredDeleted(new Date().toISOString())
  initAppTheme()
  initAppLocale()
  registerIpc()

  ipcMain.handle('app:get-locale', () => getCurrentLocale())

  ipcMain.handle('app:set-locale', (event, locale: string) => {
    if (locale !== 'zh-CN' && locale !== 'en') return getCurrentLocale()
    // 只有主窗口与设置窗口拥有全局语言；提醒窗口回传自身同步值时不回写。
    if (!ownsGlobalSettings(event.sender)) return getCurrentLocale()
    setCurrentLocale(locale)
    updateTrayLocale(locale)
    return locale
  })

  ipcMain.handle('app:set-theme', (event, theme: string) => {
    if (!isAppTheme(theme)) return
    // Only the main window and the settings window own the global theme; a
    // reminder window echoing its own synced value must not write it back.
    if (!ownsGlobalSettings(event.sender)) return
    setCurrentTheme(theme)

    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(themeBackgroundColor(theme))
    }

    mainWindow?.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: THEME_SYMBOL_COLOR[themeFamily(theme)],
      height: 48
    })
    applySettingsWindowTheme(theme)
  })

  // 设置窗口（分类载荷按 shared/settings.ts 注册表白名单，手检无 zod）：
  // 打开 = 单例唤起 + 切页；关闭 = Esc / harness。窗口生命周期全在 settingsWindow.ts。
  ipcMain.handle('app:open-settings', (_event, section: unknown) => {
    openSettingsWindow(settingsSectionFrom(section))
  })

  ipcMain.handle('app:close-settings', () => closeSettingsWindow())

  // 重装后 localStorage 为空，渲染层据此回填 meta 权威值（见 ThemeSync）。
  ipcMain.handle('app:get-theme', () => getCurrentTheme())

  // CSV 导出：Csv 规范列 + 本应用扩展列（shared/csvExport），活任务一键
  // 导出供备份/搬家；回收站不随 CSV 走；子任务走 INDENT 2 紧随父任务。
  ipcMain.handle('data:export-csv', async (event) => {
    try {
      const text = csvExportFromBackup(exportBackup())
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const target = await showSaveDialogSafe({
        title: translate(getCurrentLocale(), 'native.csvExportTitle'),
        defaultPath: `polaris-todo-${stamp}.csv`,
        filters: [
          { name: translate(getCurrentLocale(), 'native.csvFilter'), extensions: ['csv'] }
        ]
      }, event.sender)
      if (target.canceled || !target.filePath) return { saved: false }
      await writeFileAtomic(target.filePath, text)
      return { saved: true, path: target.filePath }
    } catch (error) {
      return { saved: false, error: String(error) }
    }
  })

  ipcMain.handle('reminder:dismiss', () => {
    dismissReminder()
  })

  ipcMain.handle('app:get-autostart', () => getAutoStartState())

  // 以下三个开关照 app:set-mcp 的正确写法做 typeof 校验：
  // Boolean('false') 为 true，字符串陷阱会把非法载荷当成「开」。
  ipcMain.handle('app:set-autostart', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return getAutoStartState()
    return setAutoStartState(enabled)
  })

  ipcMain.handle('app:get-close-to-tray', () => closeToTrayEnabled())

  ipcMain.handle('app:set-close-to-tray', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return closeToTrayEnabled()
    setMeta('close_to_tray', enabled ? '1' : '0')
    return enabled
  })

  ipcMain.handle('app:get-global-hotkey', () => getGlobalHotkeyState())

  ipcMain.handle('app:set-global-hotkey', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return getGlobalHotkeyState()
    return setGlobalHotkeyEnabled(enabled)
  })

  // 快捷键自定义：载荷形状校验在 hotkey.ts（同一把尺子量渲染层录制器与 IPC）；
  // 探测通道只收字符串数组，非法项在模块里被过滤，注册痕迹即探即清。
  ipcMain.handle('app:set-global-hotkey-accelerator', (_event, accelerator: unknown) =>
    setGlobalHotkeyAccelerator(accelerator)
  )

  ipcMain.handle('app:probe-global-hotkeys', (_event, candidates: unknown) => {
    if (!Array.isArray(candidates)) return []
    return probeHotkeyAccelerators(
      candidates.filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length <= 40)
    )
  })

  // Read-only, no payload to validate. The renderer must never hardcode a version
  // string: app.getVersion() reads the packaged package.json, so a release bump
  // reaches the settings panel without a code edit.
  ipcMain.handle('app:get-version', () => app.getVersion())

  // 数据备份：导出全量 JSON；导入按 ID 非破坏性合并。文件对话框与读写都在主进程，
  // 渲染层只发起 invoke；文件内容经 zod 整体校验后才落库。
  ipcMain.handle('app:get-mcp', () => getMcpState())

  ipcMain.handle('app:set-mcp', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return getMcpState()
    return setMcpEnabled(enabled)
  })

  // MCP bearer token：两条通道都无载荷可校验（同 app:get-version 的只读风格）；
  // regenerate 是显式动作通道，不接受参数——旧 token 立即作废由 mcp.ts 保证。
  ipcMain.handle('app:mcp-token-get', () => getMcpToken())

  ipcMain.handle('app:mcp-token-regenerate', () => regenerateMcpToken())

  // 写修订号只读探针：无载荷可校验（同 app:get-version 的只读风格），
  // 单行主键 SELECT。渲染层 focus 时先比对它，变了才全量重拉（迁移 7 触发器维护）。
  ipcMain.handle('data:revision', () => getWriteRevision())

  ipcMain.handle('data:export', async (event) => {
    try {
      // 与启动自动备份共用同一份序列化（buildBackupPayload），不新造格式。
      const backup = buildBackupPayload()
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const target = await showSaveDialogSafe({
        title: translate(getCurrentLocale(), 'native.exportTitle'),
        defaultPath: `polaris-backup-${stamp}.json`,
        filters: [
          { name: translate(getCurrentLocale(), 'native.jsonFilter'), extensions: ['json'] }
        ]
      }, event.sender)
      if (target.canceled || !target.filePath) return { saved: false }
      await writeFileAtomic(target.filePath, JSON.stringify(backup, null, 2))
      return { saved: true, path: target.filePath }
    } catch (error) {
      return { saved: false, error: String(error) }
    }
  })

  ipcMain.handle('data:import', async (event) => {
    try {
      const source = await showOpenDialogSafe({
        title: translate(getCurrentLocale(), 'native.importTitle'),
        properties: ['openFile'],
        filters: [
          { name: translate(getCurrentLocale(), 'native.jsonFilter'), extensions: ['json'] }
        ]
      }, event.sender)
      if (source.canceled || !source.filePaths[0]) return { ok: false, canceled: true }
      // readFile 前先查大小：超过 50MB 明确拒绝，不整文件读进内存。
      const info = await stat(source.filePaths[0])
      if (info.size > IMPORT_JSON_MAX_BYTES) {
        return {
          ok: false,
          error: translate(getCurrentLocale(), 'native.importTooLarge', {
            limit: IMPORT_JSON_MAX_BYTES / (1024 * 1024)
          })
        }
      }
      const raw = await readFile(source.filePaths[0], 'utf8')
      const parsed = backupSchema.parse(JSON.parse(raw))
      const counts = importBackup(parsed)
      return { ok: true, ...counts }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  // ---------- 自动备份管理（设置页备份区） ----------
  // list 只读元数据不解析内容，列备份是廉价操作；导入/另存以文件名为唯一入口，
  // isAutoBackupFileName 在 join 之前拒绝路径穿越，渲染层拿不到 backups 之外的文件。
  const backupsDir = (): string => join(getDataDirectory(), 'backups')

  const assertAutoBackupName = (name: unknown): string => {
    if (typeof name !== 'string' || !isAutoBackupFileName(name)) {
      throw new Error(translate(getCurrentLocale(), 'native.invalidBackupName'))
    }
    return name
  }

  ipcMain.handle('backups:list', async () => {
    try {
      const dir = backupsDir()
      await mkdir(dir, { recursive: true })
      // 文件名即时间戳，字典序倒排 = 新到旧。
      const names = (await readdir(dir)).filter(isAutoBackupFileName).sort().reverse()
      const items = await Promise.all(
        names.map(async (name) => {
          const info = await stat(join(dir, name))
          return { name, mtimeMs: info.mtimeMs, sizeBytes: info.size }
        })
      )
      return { ok: true, items }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('backups:import', async (_event, name: unknown) => {
    try {
      const filePath = join(backupsDir(), assertAutoBackupName(name))
      // 与 data:import 同一套大小门禁与校验链，不另造导入语义。
      const info = await stat(filePath)
      if (info.size > IMPORT_JSON_MAX_BYTES) {
        return {
          ok: false,
          error: translate(getCurrentLocale(), 'native.importTooLarge', {
            limit: IMPORT_JSON_MAX_BYTES / (1024 * 1024)
          })
        }
      }
      const raw = await readFile(filePath, 'utf8')
      const parsed = backupSchema.parse(JSON.parse(raw))
      const counts = importBackup(parsed)
      return { ok: true, ...counts }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('backups:save-as', async (event, name: unknown) => {
    try {
      const fileName = assertAutoBackupName(name)
      const filePath = join(backupsDir(), fileName)
      const info = await stat(filePath)
      if (info.size > IMPORT_JSON_MAX_BYTES) {
        return {
          saved: false,
          error: translate(getCurrentLocale(), 'native.importTooLarge', {
            limit: IMPORT_JSON_MAX_BYTES / (1024 * 1024)
          })
        }
      }
      const target = await showSaveDialogSafe({
        title: translate(getCurrentLocale(), 'native.exportTitle'),
        defaultPath: fileName,
        filters: [
          { name: translate(getCurrentLocale(), 'native.jsonFilter'), extensions: ['json'] }
        ]
      }, event.sender)
      if (target.canceled || !target.filePath) return { saved: false }
      await writeFileAtomic(target.filePath, await readFile(filePath, 'utf8'))
      return { saved: true, path: target.filePath }
    } catch (error) {
      return { saved: false, error: String(error) }
    }
  })

  ipcMain.handle('backups:open-data-dir', async () => {
    // harness 构建恒不真开资源管理器（与 splash/updater 的惰性约定一致）；
    // 生产构建 __POLARIS_HARNESS__ 恒 false，此分支被编译期消除。
    if (__POLARIS_HARNESS__) return { opened: false }
    try {
      // openPath 成功返回空串，失败返回系统错误原文。打开的是数据目录
      // （polaris.db 所在），自定义位置时跟随数据目录而非 userData。
      const error = await shell.openPath(getDataDirectory())
      return error ? { opened: false, error } : { opened: true }
    } catch (error) {
      return { opened: false, error: String(error) }
    }
  })

  // 逐份删除：门禁与 list/import 同源（只接受自动备份文件名，杜绝路径穿越
  // 与误删手动导出）；失败带原因原文，成功幂等（文件不存在也算删除完成）。
  ipcMain.handle('backups:delete', async (_event, name: unknown) => {
    try {
      const filePath = join(backupsDir(), assertAutoBackupName(name))
      await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      return { deleted: true }
    } catch (error) {
      return { deleted: false, error: String(error) }
    }
  })

  // 自动备份周期：meta 表持久化（不进迁移），只接受预设档位；非法值原样
  // 返回当前生效值，渲染层无需先读再写。
  ipcMain.handle('backups:get-interval', () => readAutoBackupIntervalHours())

  ipcMain.handle('backups:set-interval', (_event, hours: unknown) => {
    if (typeof hours === 'number' && AUTO_BACKUP_INTERVAL_CHOICES.includes(hours)) {
      setMeta(AUTO_BACKUP_INTERVAL_META, String(hours))
      log.info('Polaris auto backup interval set:', hours)
    }
    return readAutoBackupIntervalHours()
  })

  ipcMain.handle('app:open-notices-dir', async () => {
    // 与 backups:open-data-dir 同一套 harness 门控。NOTICE 与 licenses/ 经
    // extraResources 落在安装目录 resources/（=process.resourcesPath）；
    // 开发态两份都在仓库根（app.getAppPath()），打包前后都能打开。
    if (__POLARIS_HARNESS__) return { opened: false }
    try {
      const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
      const error = await shell.openPath(join(base, 'licenses'))
      return error ? { opened: false, error } : { opened: true }
    } catch (error) {
      return { opened: false, error: String(error) }
    }
  })

  // ---------- 数据存放位置（设置页备份区） ----------
  // 语义都在 dataLocation.ts（唯一 owner），这里只做对话框、调度与重启，
  // 手检无 zod。set 的可选路径参数是测试受控入口（预加载层
  // 不暴露）；apply/reset 之后 scheduleRelaunch 自动重启生效。
  initDataLocation({ writeFileAtomic })

  ipcMain.handle('data-location:get', () => getDataLocationState())

  ipcMain.handle('data-location:set', async (event, directory: unknown) => {
    if (directory != null && typeof directory !== 'string') return getDataLocationState()
    if (typeof directory === 'string') return setDataDirectoryOffer(directory)
    const picked = await showOpenDialogSafe({
      title: translate(getCurrentLocale(), 'native.dataLocationTitle'),
      defaultPath: getDataDirectory(),
      properties: ['openDirectory', 'createDirectory']
    }, event.sender)
    if (picked.canceled || !picked.filePaths[0]) return getDataLocationState()
    return setDataDirectoryOffer(picked.filePaths[0])
  })

  ipcMain.handle('data-location:apply', async () => {
    const state = await applyDataDirectory()
    scheduleRelaunch(state)
    return state
  })

  ipcMain.handle('data-location:reset', async () => {
    const state = await resetDataDirectory()
    scheduleRelaunch(state)
    return state
  })

  ipcMain.handle('data-location:cancel', () => cancelDataDirectoryOffer())

  // 启动页先于主窗口创建：页面极小，先画出来；主窗口加载并行进行，互不阻塞。
  // 自启（--hidden）要静默进托盘，三个测试模式要保持确定性，均跳过。
  // 生产构建里 __POLARIS_HARNESS__ 恒 false，harness 恒为 false，
  // 启动页/自动备份的行为与从前完全一致；env 读取只存在于 harness 构建。
  let harness = false
  if (__POLARIS_HARNESS__) {
    harness = Boolean(
      process.env['POLARIS_SMOKE'] ||
      process.env['POLARIS_SHOT'] ||
      process.env['POLARIS_SCREENSHOT']
    )
  }
  if (!startHidden && !harness) {
    openSplashWindow(getCurrentTheme(), app.getVersion(), () => mainWindow)
  }

  // 设置窗口以主窗口为父：在主窗口建出之前装配，句柄经 getter 延迟取。
  initSettingsWindow({
    getMainWindow: () => mainWindow,
    showMainWindow,
    // 设置窗口关掉后主窗口的更新弹窗副本才可能露出来：补推一次快照，
    // 让「在设置里点过稍后/跳过」的版本把被盖住的那份一并收起。
    onClosed: () => refreshUpdateState()
  })

  createWindow()
  createTray({
    onOpen: showMainWindow,
    onOpenSettings: () => void revealSettings(),
    onCheckUpdates: () => void checkUpdatesFromTray(),
    onQuit: () => app.quit()
  })
  startReminderScheduler()
  // 窗口和托盘就绪后再注册：处理器要靠 showMainWindow 把窗口叫出来。
  initMcp()
  // 在线更新：未打包（dev/冒烟/截图）时完全惰性，不发网络请求。
  initUpdater({
    getWindow: () => mainWindow,
    // 设置窗口也收快照：关于页的状态行与更新弹窗都在那里（它盖在主窗口上方）。
    getExtraWindows: () => {
      const settings = getSettingsWindow()
      return settings ? [settings] : []
    },
    onBeforeInstall: () => {
      // quitAndInstall 要真退出：掀掉「关窗驻托盘」的拦路标记。
      isQuitting = true
    }
  })
  initGlobalHotkey(() => {
    void revealQuickCapture()
  })

  // 灾难恢复告知：原库已损坏并被改名隔离，当前运行的是重建空库。
  // locale 记录随旧库丢失，initAppLocale 只能按系统语言兜底，所以正文
  // 双语并列（zh+en），确保任何语言的用户都读得懂；标题按当前 locale。
  if (quarantinedPath) {
    const corruptDetail = (locale: Locale): string =>
      translate(locale, 'native.dbCorruptDetail', { path: quarantinedPath })
    void dialog.showMessageBox({
      type: 'warning',
      title: translate(getCurrentLocale(), 'native.dbCorruptTitle'),
      message: translate(getCurrentLocale(), 'native.dbCorruptTitle'),
      detail: `${corruptDetail('zh-CN')}\n\n${corruptDetail('en')}`
    })
  }

  // 数据目录回退告知：指针存在但目标不可用，本次启动跑在默认位置。
  // locale 此刻尚未初始化（initAppLocale 在建库之后），正文双语并列展示，
  // 与隔离通知同一模式；具体回退原因已进日志。
  if (getDataLocationState().error) {
    const fallbackDetail = (locale: Locale): string => translate(locale, 'dataLocation.fallback')
    void dialog.showMessageBox({
      type: 'warning',
      title: translate(getCurrentLocale(), 'dataLocation.fallbackTitle'),
      message: translate(getCurrentLocale(), 'dataLocation.fallbackTitle'),
      detail: `${fallbackDetail('zh-CN')}\n\n${fallbackDetail('en')}`
    })
  }

  // 外部变更告知：数据文件在上次退出后被外部修改（其他设备同步 / 未正常
  // 退出），本次启动以磁盘上的文件为准。locale 未就绪，双语并列展示；
  // 隔离重建时数据库的故事已由隔离对话框讲过，这里让位不再叠加。
  if (externalDbChange === true && !quarantinedPath) {
    const externalDetail = (locale: Locale): string => translate(locale, 'dataLocation.externalChange')
    void dialog.showMessageBox({
      type: 'warning',
      title: translate(getCurrentLocale(), 'dataLocation.externalChangeTitle'),
      message: translate(getCurrentLocale(), 'dataLocation.externalChangeTitle'),
      detail: `${externalDetail('zh-CN')}\n\n${externalDetail('en')}`
    })
  }

  // 启动自动备份：超过 24h 才写，失败只留痕。测试模式跳过，保持 harness
  // 的临时 profile 确定性（与 splash/updater 的惰性约定一致）。
  if (!harness) {
    void runAutoBackup()
    // 运行期兜底：托盘长驻不重启也会按设定周期补备份（每小时廉价检查一次，
    // readdir + stat，周期未到即返回）。
    setInterval(() => void runAutoBackup(), AUTO_BACKUP_CHECK_MS)
  }

  app.on('activate', () => {
    showMainWindow()
  })
}).catch((error: unknown) => {
  // 启动链任何一步失败都不能静默死亡：留痕 + 双语报错 + 退出。
  // locale 可能尚未初始化（initAppLocale 之前就抛错），双语兜底。
  log.error('Polaris startup failed:', error)
  const startupDetail = (locale: Locale): string =>
    translate(locale, 'native.startupFailedDetail', { error: String(error) })
  dialog.showErrorBox(
    `${translate('zh-CN', 'native.startupFailedTitle')} / ${translate('en', 'native.startupFailedTitle')}`,
    `${startupDetail('zh-CN')}\n\n${startupDetail('en')}`
  )
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  // 数据目录切换的最后一刻写入先收尾（同步 checkpoint + 覆盖复制），
  // flush 依赖仍打开的 db 句柄，必须排最前。
  flushDataLocationOnQuit()
  // 全局热键是进程级资源，退出时显式注销，别留给下一个实例。
  disposeGlobalHotkey()
  disposeMcp()
  disposeUpdater()
  screen.removeAllListeners('display-metrics-changed')
  // 最后才关库：显式 checkpoint + 关闭——SQLite 收尾删掉 -wal/-shm 旁车，数据目录只剩单个
  // polaris.db，网盘同步不再有三件套版本错位；随后记录收拢后的指纹供
  // 下次启动做外部变更检测。关库失败只留痕，进程照常退出。
  closeDatabase()
  writeDbSyncStamp()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  // 测试模式关窗即退出；生产构建这段 env 读取被编译期消除，只剩托盘开关判断。
  let harnessQuit = false
  if (__POLARIS_HARNESS__) {
    harnessQuit = Boolean(
      process.env['POLARIS_SMOKE'] ||
      process.env['POLARIS_SHOT'] ||
      process.env['POLARIS_SCREENSHOT']
    )
  }
  if (harnessQuit) {
    app.quit()
  } else if (!closeToTrayEnabled()) {
    // 不驻留托盘时，关窗即退出（否则进程无窗无托盘空转）。
    app.quit()
  }
})
