import { app, ipcMain, Notification, powerMonitor, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import type { UpdateState, UpdateStatus } from '../shared/types'
import { normalizeReleaseNotes, shouldAutoCheck, smoothSpeed } from '../shared/update'
import { translate, type Locale } from '../shared/i18n'
import { getMeta, setMeta } from './db'
import { getCurrentLocale } from './locale'

// 在线更新的唯一所有者。渠道是 GitHub Releases（electron-builder.yml 的
// publish），客户端只认 Release 资产里的 latest.yml：比对 semver → 后台下载
// （blockmap 差量）→ 用户确认后 quitAndInstall。NSIS 按用户安装，更新不弹 UAC。
//
// 状态快照单向推给窗口（update:state：主窗口 + 开着的设置窗口），渲染层不自己
// 推算进度；「跳过此版本」记在 meta，自动检查命中它保持安静，手动检查永远给答案。
// 「稍后」记在本次运行的内存里（dismissedVersion）：设置成了独立窗口后，弹窗
// 副本在每个窗口各有一份，「稍后」必须跨窗口一致，否则在设置里点过稍后、关掉
// 设置窗口，主窗口里被盖住的那份又会冒出来。
// 开发/未打包环境没有更新通道：status = unsupported，绝不发网络请求，
// 冒烟与截图模式因此完全确定。

const META_SKIPPED = 'update_skipped_version'
const CHECK_INTERVAL = 4 * 60 * 60 * 1000 // 兜底轮询：每 4 小时
const WAKE_CHECK_MIN_GAP = 30 * 60 * 1000 // 焦点/唤醒补查的节流下限

let status: UpdateStatus = 'idle'
let latestVersion: string | null = null
let percent: number | null = null
let transferred: number | null = null
let total: number | null = null
let bytesPerSecond: number | null = null
let releaseNotes: string | null = null
let lastError: string | null = null
let timer: NodeJS.Timeout | null = null
let lastCheckAt: number | null = null
let dismissedVersion: string | null = null
let getWindow: (() => BrowserWindow | null) | null = null
let getExtraWindows: (() => BrowserWindow[]) | null = null
let initialized = false

function supported(): boolean {
  return app.isPackaged
}

function state(): UpdateState {
  return {
    status: supported() ? status : 'unsupported',
    currentVersion: app.getVersion(),
    latestVersion,
    percent,
    transferred,
    total,
    bytesPerSecond,
    releaseNotes,
    skippedVersion: getMeta(META_SKIPPED),
    dismissedVersion,
    error: lastError
  }
}

/** 向所有挂着更新界面的窗口补推一次当前快照（设置窗口关闭时调用）。 */
export function refreshUpdateState(): void {
  push()
}

function push(): void {
  const windows = [getWindow?.() ?? null, ...(getExtraWindows?.() ?? [])]
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue
    window.webContents.send('update:state', state())
  }
}

function patch(next: Partial<{
  status: UpdateStatus
  latestVersion: string | null
  percent: number | null
  transferred: number | null
  total: number | null
  bytesPerSecond: number | null
  releaseNotes: string | null
  error: string | null
}>): void {
  if (next.status !== undefined) status = next.status
  if (next.latestVersion !== undefined) latestVersion = next.latestVersion
  if (next.percent !== undefined) percent = next.percent
  if (next.transferred !== undefined) transferred = next.transferred
  if (next.total !== undefined) total = next.total
  if (next.bytesPerSecond !== undefined) bytesPerSecond = next.bytesPerSecond
  if (next.releaseNotes !== undefined) releaseNotes = next.releaseNotes
  if (next.error !== undefined) lastError = next.error
  push()
}

/** 检查更新。结果既走返回值（设置页手动检查要立刻拿到答案，
 *  包括被跳过的版本），也走事件推送（自动检查驱动弹窗）。
 *  「跳过此版本」的安静规则由渲染层用 shouldSurfaceUpdate 执行：
 *  主进程只报告事实，不打扰与否是展示层的决定。
 *  manual：用户主动问就重新给机会——清掉本次运行的「稍后」记账。 */
async function check(manual = false): Promise<UpdateState> {
  if (manual) dismissedVersion = null
  if (!supported()) return state()
  if (status === 'checking' || status === 'downloading') return state()
  // 发起即记时（含失败）：节流闸按「上次发起」算，网络坏了也不至于
  // 每次焦点切换都重试打网。手动检查同样盖章，30 分钟内不重复补查。
  lastCheckAt = Date.now()
  patch({
    status: 'checking',
    error: null,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null
  })
  try {
    // autoDownload 开着：update-available 后紧接着自动下载。
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // 检查失败留痕：用户机器上「更新一直不动」靠日志取证（气泡只给截断文案）。
    log.error('Polaris update check failed:', error)
    patch({ status: 'error', error: String(error) })
  }
  return state()
}

/** 托盘菜单的手动检查入口：与设置页脚走同一个 check()，结果只走返回值，
 *  气泡文案与是否唤起窗口由调用方按 describeTrayCheck 决定。 */
export function manualCheckForUpdates(): Promise<UpdateState> {
  return check(true)
}

export interface TrayCheckFeedback {
  /** 气泡正文：手动检查永远给答案，包括「已是最新」和失败。 */
  balloon: string
  /** 是否唤起主窗口：只有更新值得看时才打扰，最新/失败/不支持都安静。 */
  surface: boolean
}

/** 纯函数，harness 断言直接对状态表逐条验证；错误文案截断，气泡不放整段堆栈。
 *  locale 默认中文：现有 harness 直调不传参也不会变。 */
export function describeTrayCheck(state: UpdateState, locale: Locale = 'zh-CN'): TrayCheckFeedback {
  switch (state.status) {
    case 'unsupported':
      return { balloon: translate(locale, 'updater.unsupported'), surface: false }
    case 'checking':
      return { balloon: translate(locale, 'updater.checking'), surface: false }
    case 'available':
      return {
        balloon: translate(locale, 'updater.available', { version: state.latestVersion ?? '' }),
        surface: true
      }
    case 'downloading':
      return {
        balloon: translate(locale, 'updater.downloading', {
          version: state.latestVersion ?? '',
          percent: state.percent ?? 0
        }),
        surface: true
      }
    case 'downloaded':
      return {
        balloon: translate(locale, 'updater.downloaded', { version: state.latestVersion ?? '' }),
        surface: true
      }
    case 'up-to-date':
      return { balloon: translate(locale, 'updater.upToDate', { version: state.currentVersion }), surface: false }
    case 'error':
      return {
        balloon: translate(locale, 'updater.error', {
          error: (state.error ?? translate(locale, 'updater.unknownError')).slice(0, 120)
        }),
        surface: false
      }
    default:
      return { balloon: translate(locale, 'updater.unknown'), surface: false }
  }
}

/** 点「立即重启」进入安装前的系统通知文案。纯函数，harness 直接断言中英字面量。
 *  投递用 Electron Notification 而非 showTrayBalloon：托盘随进程退出销毁，
 *  气泡会跟着没；Notification 进 Windows 操作中心，进程退了通知还在，
 *  正好覆盖「窗口消失、等待装完」的那几秒。 */
export function installingNotice(version: string, locale: Locale = 'zh-CN'): { title: string; body: string } {
  return {
    title: translate(locale, 'updater.installingTitle', { version }),
    body: translate(locale, 'updater.installingBody')
  }
}

/** 窗口聚焦 / 系统唤醒时的补查：应用常驻托盘，4 小时兜底轮询太粗，
 *  发版后用户一打开窗口就该尽快发现新版本；休眠期间 setInterval 不走，
 *  唤醒也必须补一次。30 分钟节流，频繁切焦点不会打爆 GitHub。 */
function wakeCheck(): void {
  if (!supported()) return
  if (shouldAutoCheck(lastCheckAt, Date.now(), WAKE_CHECK_MIN_GAP)) void check()
}

export function initUpdater(options: {
  getWindow: () => BrowserWindow | null
  /** 额外收快照的窗口（开着的设置窗口）；可为空数组。 */
  getExtraWindows?: () => BrowserWindow[]
  /** quitAndInstall 前把主窗口的「关闭即驻托盘」拦路标记掀掉。 */
  onBeforeInstall: () => void
}): void {
  if (initialized) return
  initialized = true
  getWindow = options.getWindow
  getExtraWindows = options.getExtraWindows ?? null

  autoUpdater.autoDownload = true
  // 用户没点「立即重启」也没关系：下次正常退出时静默装上。
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true
  // electron-updater 内部日志（检查/下载/校验各步）一并落文件：
  // 打包后更新失败的唯一取证来源。每次检查只几行，不刷屏。
  autoUpdater.logger = log

  autoUpdater.on('update-available', (info) => {
    // 里程碑：发现新版本（下载随之自动开始）。
    log.info('Polaris update available:', info.version)
    // 跳过过的版本也照常下载（退出时静默安装），只是渲染层不为它弹窗。
    patch({
      status: 'available',
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      percent: 0,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      error: null
    })
  })

  autoUpdater.on('update-not-available', () => {
    patch({
      status: 'up-to-date',
      latestVersion: null,
      percent: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      releaseNotes: null,
      error: null
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    // 逐事件速度抖动会让剩余时间乱跳：主进程先做指数平滑，快照里只放
    // 平滑后的值，渲染层与冒烟看到的是同一份稳定数字。
    bytesPerSecond = smoothSpeed(bytesPerSecond, progress.bytesPerSecond)
    patch({
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    // 里程碑：下载完成，等用户重启或下次退出静默安装。
    log.info('Polaris update downloaded:', info.version)
    patch({
      status: 'downloaded',
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) ?? releaseNotes,
      percent: 100,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      error: null
    })
  })

  autoUpdater.on('error', (error) => {
    // 下载/校验阶段的失败留痕（检查阶段的拒绝在 check() 的 catch 里记）。
    log.error('Polaris updater error:', error)
    patch({
      status: 'error',
      error: String(error),
      transferred: null,
      total: null,
      bytesPerSecond: null
    })
  })

  ipcMain.handle('update:get-state', () => state())

  ipcMain.handle('update:check', () => check(true))

  ipcMain.handle('update:skip', (_event, version: unknown) => {
    // 跳过的是渲染层正在展示的版本，由调用方指明；只接受版本号形状的短字符串。
    if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) && version.length <= 50) {
      setMeta(META_SKIPPED, version)
    }
    push()
    return state()
  })

  // 「稍后」只记账不推送：本窗口的弹窗由渲染层自己收起；别的窗口那份副本
  // 等下一次快照（设置窗口关闭时的补推 / 后续下载进度）带上来再收。
  ipcMain.handle('update:dismiss', (_event, version: unknown) => {
    if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) && version.length <= 50) {
      dismissedVersion = version
    }
  })

  ipcMain.handle('update:install', () => {
    // 未打包或没下载完就点重启：不动进程，报错给渲染层。
    if (!supported() || status !== 'downloaded') {
      patch({ error: translate(getCurrentLocale(), 'updater.notReady') })
      return
    }
    options.onBeforeInstall()
    // 先发系统通知告知「窗口会消失几秒、装好自动重开」，别让用户以为崩了。
    const notice = installingNotice(latestVersion ?? app.getVersion(), getCurrentLocale())
    new Notification({ title: notice.title, body: notice.body }).show()
    // 缓 ~800ms 再退出：系统通知投递是异步的，立刻 quit 会把 toast 一起带走。
    // isSilent=true：/S 静默安装，不弹 NSIS 向导（含用户/目录选择页）；
    // isForceRunAfter=true：装完自动拉起新版。按机器安装的老用户仍会有一次 UAC 确认。
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800)
  })

  if (!supported()) return
  // 启动后缓 10 秒再查：让主窗口、数据库、托盘先就位，更新检查不抢首屏。
  setTimeout(() => void check(), 10_000)
  timer = setInterval(() => void check(), CHECK_INTERVAL)
  // 焦点用 app 级事件：不依赖某个窗口实例存活，启动页聚焦也天然被节流挡住。
  app.on('browser-window-focus', wakeCheck)
  powerMonitor.on('resume', wakeCheck)
}

export function disposeUpdater(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  app.removeListener('browser-window-focus', wakeCheck)
  powerMonitor.removeListener('resume', wakeCheck)
}