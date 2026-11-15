import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { themeBackgroundColor } from './theme'
import type { AppTheme } from '../shared/themes'

// 启动动画：主窗口就绪前的品牌过渡。独立小窗加载第二渲染入口 splash.html，
// 创建即返回，页面加载与主窗口并行，不阻塞主进程初始化。
// 主题来自主进程 meta（getCurrentTheme），经 query 注入页面首帧内联脚本；
// 窗口 backgroundColor 再兜底一层——两层保证首帧即正确主题，无白闪。
// --hidden 自启与 POLARIS_SMOKE / POLARIS_SHOT / POLARIS_SCREENSHOT 下不创建。

const SPLASH_WIDTH = 360
const SPLASH_HEIGHT = 400
// 最短可见时长：让约 2s 的启动动画（汇聚 → 点亮 → 字标落定）播完再交接，
// 落在 1–3s 的动画预算内。初始化更慢时没有上限——轨道环循环等待，
// 主窗口 ready-to-show 到了才交接，动画不阻塞初始化本身。
const MIN_VISIBLE_MS = 2000
// 淡出时长取设计系统的 200ms standard 档。
const FADE_MS = 200
// 兜底：渲染层加载失败或卡死时，不能把用户永远挡在启动页后面。
const FAILSAFE_MS = 12_000

let splashWindow: BrowserWindow | null = null
let shownAt = 0
let revealing = false
let failsafe: NodeJS.Timeout | null = null

// 低层创建：只建窗 + 加载，不管理生命周期。POLARIS_SHOT=splash 逐主题截图
// 也走这里，与生产启动页共用同一份窗口参数和页面。
export function createSplashWindow(theme: AppTheme, version: string): BrowserWindow {
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    center: true,
    // thickFrame 保持默认 true：Windows 11 DWM 据此画圆角与原生阴影，
    // 与提醒窗同一套约定，不设 transparent。
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: themeBackgroundColor(theme),
    // 无 preload：启动页不发起任何 IPC，主题与版本号都走 query。
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL('/splash.html', process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('theme', theme)
    url.searchParams.set('v', version)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/splash.html'), {
      query: { theme, v: version }
    })
  }

  return win
}

export function openSplashWindow(
  theme: AppTheme,
  version: string,
  getMainWindow: () => BrowserWindow | null
): void {
  if (splashWindow && !splashWindow.isDestroyed()) return

  revealing = false
  shownAt = Date.now()
  const win = createSplashWindow(theme, version)
  splashWindow = win
  // showInactive：启动页不抢焦点，主窗口 show() 时再正常接管。
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  win.on('closed', () => {
    if (splashWindow === win) splashWindow = null
    if (failsafe) {
      clearTimeout(failsafe)
      failsafe = null
    }
  })
  failsafe = setTimeout(() => reveal(getMainWindow()), FAILSAFE_MS)
}

export function hasSplashWindow(): boolean {
  return splashWindow !== null && !splashWindow.isDestroyed()
}

// 主窗口就绪（或主帧加载失败、或被托盘/第二实例唤起）时调用：
// 补足最短可见时长后主窗口先 show，启动页置顶淡出，交叉过渡无空帧。
export function revealMainWindow(mainWindow: BrowserWindow): void {
  reveal(mainWindow)
}

function reveal(mainWindow: BrowserWindow | null): void {
  if (revealing || !hasSplashWindow()) return
  revealing = true
  if (failsafe) {
    clearTimeout(failsafe)
    failsafe = null
  }

  const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt))
  setTimeout(() => {
    const splash = splashWindow
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 淡出期间保持启动页在主窗口之上，否则淡出会被新激活的主窗口盖住。
      if (splash && !splash.isDestroyed()) splash.setAlwaysOnTop(true, 'floating')
      mainWindow.show()
      mainWindow.focus()
    }
    fadeOut(splash)
  }, wait)
}

function fadeOut(splash: BrowserWindow | null): void {
  if (!splash || splash.isDestroyed()) return
  // 还没画出来就直接销毁，避免迟到的首帧以半透明状态闪现。
  if (!splash.isVisible()) {
    splash.destroy()
    return
  }

  const start = Date.now()
  const timer = setInterval(() => {
    if (splash.isDestroyed()) {
      clearInterval(timer)
      return
    }
    const t = Math.min(1, (Date.now() - start) / FADE_MS)
    splash.setOpacity(1 - t)
    if (t >= 1) {
      clearInterval(timer)
      splash.destroy()
    }
  }, 16)
}