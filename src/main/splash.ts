import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
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
// 最短可见时长：从启动页首帧（ready-to-show）起算，而非建窗时刻——
// 页面加载（字体/样式）不再吃掉动画预算（旧 2000ms 从建窗算，加载几百毫秒
// 后动画只播到一半就被交接，用户报障「没转完就启动」）。
// 3300ms = 轨道环第一整圈（spin 900ms 延迟 + 2400ms 周期）；汇聚 → 点亮 →
// 字标/标语/状态落定链 1950ms 内完成，故交接时动画必已转完落定。
// 初始化更慢时不额外等——主窗口 ready-to-show 到了就交接（轨道环循环补位），
// 动画不阻塞初始化本身；加载与动画并行，取两者较晚者。
const MIN_VISIBLE_MS = 3300
// 淡出时长取设计系统的 200ms standard 档。
const FADE_MS = 200
// 兜底：渲染层加载失败或卡死时，不能把用户永远挡在启动页后面。
const FAILSAFE_MS = 12_000

let splashWindow: BrowserWindow | null = null
// 首帧时刻（0 = 尚未画出）：最短可见时长的计时原点。
let paintedAt = 0
let revealing = false
let pendingMain: BrowserWindow | null = null
let handoffTimer: NodeJS.Timeout | null = null
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
  paintedAt = 0
  pendingMain = null
  const win = createSplashWindow(theme, version)
  splashWindow = win
  // showInactive：启动页不抢焦点，主窗口 show() 时再正常接管。
  // 首帧即计时原点：若主窗口已先就绪（revealing），画出来立刻开始计最短可见。
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    paintedAt = Date.now()
    win.showInactive()
    log.info('splash painted')
    if (revealing) scheduleHandoff()
  })
  win.on('closed', () => {
    if (splashWindow === win) splashWindow = null
    if (failsafe) {
      clearTimeout(failsafe)
      failsafe = null
    }
    if (handoffTimer) {
      clearTimeout(handoffTimer)
      handoffTimer = null
    }
  })
  // 兜底：首帧永远不来（渲染卡死）时把计时原点视作已到期满，立即交接，
  // 不能把用户永远挡在启动页后面。
  failsafe = setTimeout(() => {
    if (!hasSplashWindow()) return
    if (paintedAt === 0) paintedAt = Date.now() - MIN_VISIBLE_MS
    revealing = true
    pendingMain = getMainWindow()
    scheduleHandoff()
  }, FAILSAFE_MS)
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
  pendingMain = mainWindow
  // 首帧已画出就立刻计等待；还没画出则等 ready-to-show 回调里起计
  // （主窗口先就绪的快机器上，动画预算从首帧完整起算，不被加载偷走）。
  if (paintedAt > 0) scheduleHandoff()
}

// 补足「首帧起算的最短可见时长」后交接：主窗口先 show，启动页置顶淡出，
// 交叉过渡无空帧。handoffTimer 单例防 ready-to-show 与 reveal 双路重复起计。
function scheduleHandoff(): void {
  if (handoffTimer) return
  const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - paintedAt))
  handoffTimer = setTimeout(() => {
    handoffTimer = null
    if (failsafe) {
      clearTimeout(failsafe)
      failsafe = null
    }
    const splash = splashWindow
    const mainWindow = pendingMain
    const mainShown = Boolean(mainWindow && !mainWindow.isDestroyed())
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 淡出期间保持启动页在主窗口之上，否则淡出会被新激活的主窗口盖住。
      if (splash && !splash.isDestroyed()) splash.setAlwaysOnTop(true, 'floating')
      mainWindow.show()
      mainWindow.focus()
    }
    // 交接遥测：与 splash painted 日志的时间差即首帧起算的可见时长。
    log.info('splash handoff:', { mainShown })
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