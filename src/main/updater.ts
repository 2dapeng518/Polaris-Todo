import { app, ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState, UpdateStatus } from '../shared/types'
import { normalizeReleaseNotes } from '../shared/update'
import { getMeta, setMeta } from './db'

// 在线更新的唯一所有者。渠道是 GitHub Releases（electron-builder.yml 的
// publish），客户端只认 Release 资产里的 latest.yml：比对 semver → 后台下载
// （blockmap 差量）→ 用户确认后 quitAndInstall。NSIS 按用户安装，更新不弹 UAC。
//
// 状态快照单向推给主窗口（update:state），渲染层不自己推算进度；
// 「跳过此版本」记在 meta，自动检查命中它保持安静，手动检查永远给答案。
// 开发/未打包环境没有更新通道：status = unsupported，绝不发网络请求，
// 冒烟与截图模式因此完全确定。

const META_SKIPPED = 'update_skipped_version'
const CHECK_INTERVAL = 4 * 60 * 60 * 1000 // 启动查一次，之后每 4 小时

let status: UpdateStatus = 'idle'
let latestVersion: string | null = null
let percent: number | null = null
let releaseNotes: string | null = null
let lastError: string | null = null
let timer: NodeJS.Timeout | null = null
let getWindow: (() => BrowserWindow | null) | null = null
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
    releaseNotes,
    skippedVersion: getMeta(META_SKIPPED),
    error: lastError
  }
}

function push(): void {
  const window = getWindow?.()
  if (!window || window.isDestroyed()) return
  window.webContents.send('update:state', state())
}

function patch(next: Partial<{ status: UpdateStatus; latestVersion: string | null; percent: number | null; releaseNotes: string | null; error: string | null }>): void {
  if (next.status !== undefined) status = next.status
  if (next.latestVersion !== undefined) latestVersion = next.latestVersion
  if (next.percent !== undefined) percent = next.percent
  if (next.releaseNotes !== undefined) releaseNotes = next.releaseNotes
  if (next.error !== undefined) lastError = next.error
  push()
}

/** 检查更新。结果既走返回值（设置页手动检查要立刻拿到答案，
 *  包括被跳过的版本），也走事件推送（自动检查驱动弹窗）。
 *  「跳过此版本」的安静规则由渲染层用 shouldSurfaceUpdate 执行：
 *  主进程只报告事实，不打扰与否是展示层的决定。 */
async function check(): Promise<UpdateState> {
  if (!supported()) return state()
  if (status === 'checking' || status === 'downloading') return state()
  patch({ status: 'checking', error: null, percent: null })
  try {
    // autoDownload 开着：update-available 后紧接着自动下载。
    await autoUpdater.checkForUpdates()
  } catch (error) {
    patch({ status: 'error', error: String(error) })
  }
  return state()
}

/** 托盘菜单的手动检查入口：与设置页脚走同一个 check()，结果只走返回值，
 *  气泡文案与是否唤起窗口由调用方按 describeTrayCheck 决定。 */
export function manualCheckForUpdates(): Promise<UpdateState> {
  return check()
}

export interface TrayCheckFeedback {
  /** 气泡正文：手动检查永远给答案，包括「已是最新」和失败。 */
  balloon: string
  /** 是否唤起主窗口：只有更新值得看时才打扰，最新/失败/不支持都安静。 */
  surface: boolean
}

/** 纯函数，冒烟直接对状态表逐条验证；错误文案截断，气泡不放整段堆栈。 */
export function describeTrayCheck(state: UpdateState): TrayCheckFeedback {
  switch (state.status) {
    case 'unsupported':
      return { balloon: '当前环境不提供在线更新', surface: false }
    case 'checking':
      return { balloon: '正在检查更新，请稍候', surface: false }
    case 'available':
      return { balloon: `发现新版本 v${state.latestVersion}，正在后台下载`, surface: true }
    case 'downloading':
      return { balloon: `新版本 v${state.latestVersion} 下载中（${state.percent ?? 0}%）`, surface: true }
    case 'downloaded':
      return { balloon: `新版本 v${state.latestVersion} 已就绪，重启即可安装`, surface: true }
    case 'up-to-date':
      return { balloon: `已是最新版本 v${state.currentVersion}`, surface: false }
    case 'error':
      return { balloon: `检查更新失败：${(state.error ?? '未知错误').slice(0, 120)}`, surface: false }
    default:
      return { balloon: '更新状态未知，请稍后再试', surface: false }
  }
}

export function initUpdater(options: {
  getWindow: () => BrowserWindow | null
  /** quitAndInstall 前把主窗口的「关闭即驻托盘」拦路标记掀掉。 */
  onBeforeInstall: () => void
}): void {
  if (initialized) return
  initialized = true
  getWindow = options.getWindow

  autoUpdater.autoDownload = true
  // 用户没点「立即重启」也没关系：下次正常退出时静默装上。
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('update-available', (info) => {
    // 跳过过的版本也照常下载（退出时静默安装），只是渲染层不为它弹窗。
    patch({
      status: 'available',
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      percent: 0,
      error: null
    })
  })

  autoUpdater.on('update-not-available', () => {
    patch({ status: 'up-to-date', latestVersion: null, percent: null, releaseNotes: null, error: null })
  })

  autoUpdater.on('download-progress', (progress) => {
    patch({ status: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    patch({
      status: 'downloaded',
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) ?? releaseNotes,
      percent: 100,
      error: null
    })
  })

  autoUpdater.on('error', (error) => {
    patch({ status: 'error', error: String(error) })
  })

  ipcMain.handle('update:get-state', () => state())

  ipcMain.handle('update:check', () => check())

  ipcMain.handle('update:skip', (_event, version: unknown) => {
    // 跳过的是渲染层正在展示的版本，由调用方指明；只接受版本号形状的短字符串。
    if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) && version.length <= 50) {
      setMeta(META_SKIPPED, version)
    }
    push()
    return state()
  })

  ipcMain.handle('update:install', () => {
    // 未打包或没下载完就点重启：不动进程，报错给渲染层。
    if (!supported() || status !== 'downloaded') {
      patch({ error: '更新尚未就绪，无法安装' })
      return
    }
    options.onBeforeInstall()
    // isSilent=true：/S 静默安装，不弹 NSIS 向导（含用户/目录选择页）；
    // isForceRunAfter=true：装完自动拉起新版。按机器安装的老用户仍会有一次 UAC 确认。
    autoUpdater.quitAndInstall(true, true)
  })

  if (!supported()) return
  // 启动后缓 10 秒再查：让主窗口、数据库、托盘先就位，更新检查不抢首屏。
  setTimeout(() => void check(), 10_000)
  timer = setInterval(() => void check(), CHECK_INTERVAL)
}

export function disposeUpdater(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}