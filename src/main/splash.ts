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
// 字标/诗句/状态落定链 1950ms 播完。但 ready-to-show 可能落在样式未应用的
// 首帧（dev 下样式经 splash.ts 模块注入），预算锚点因此可能早于动画真实
// 起点——3300ms 只当保底下限，动画何时结束以页面自己的动画时钟为准：
// 交接前等渲染层的动画播完旗标（__SPLASH_CHAIN_DONE，见 waitForChainDone），
// 主窗口绝不早于动画结束出现。
// 初始化更慢时不额外等——主窗口 ready-to-show 到了就交接（轨道环循环补位），
// 动画不阻塞初始化本身；加载与动画并行，取两者较晚者。
const MIN_VISIBLE_MS = 3300
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
// 交接由 scheduleHandoff 完成——先销毁启动页、再显示主窗口。
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

// 等渲染层的动画播完旗标（splash.html 内联脚本在「一次性链尾 animationend +
// 轨道环第一圈 animationiteration」都到齐后置 __SPLASH_CHAIN_DONE，页面侧另有
// 从动画起跑起算的兜底）。3300ms 预算的锚点是 ready-to-show，可能早于动画
// 真实起点（dev 样式迟到），所以交接前必须问一次渲染层——正常路径旗标早已
// 置位，至多等一个轮询间隔；渲染层 pathology 时 1.5s 竞速兜底，绝不把用户
// 卡在启动页后面。
const CHAIN_DONE_WAIT_CAP_MS = 1500

async function waitForChainDone(splash: BrowserWindow | null): Promise<number> {
  const startedAt = Date.now()
  if (!splash || splash.isDestroyed()) return 0
  const ask = splash.webContents
    .executeJavaScript(
      `(function () {
        if (window.__SPLASH_CHAIN_DONE) return true
        return new Promise(function (resolve) {
          var poll = setInterval(function () {
            if (window.__SPLASH_CHAIN_DONE) {
              clearInterval(poll)
              resolve(true)
            }
          }, 50)
        })
      })()`
    )
    .then(() => true)
    .catch(() => undefined)
  await Promise.race([ask, new Promise<void>((resolve) => setTimeout(resolve, CHAIN_DONE_WAIT_CAP_MS))])
  return Date.now() - startedAt
}

// 补足「首帧起算的最短可见时长」并等到动画播完后交接：先销毁启动页、再
// 显示主窗口。handoffTimer 单例防 ready-to-show 与 reveal 双路重复起计。
function scheduleHandoff(): void {
  if (handoffTimer) return
  const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - paintedAt))
  handoffTimer = setTimeout(() => {
    handoffTimer = null
    if (failsafe) {
      clearTimeout(failsafe)
      failsafe = null
    }
    void (async () => {
      // 主窗口出现前最后一道闸：等页面报「动画播完」（旗标正常路径早已置位）。
      const chainWaitMs = await waitForChainDone(splashWindow)
      const splash = splashWindow
      const mainWindow = pendingMain
      const mainShown = Boolean(mainWindow && !mainWindow.isDestroyed())
      // 先撤启动页、再显主窗口，两步在同一轮事件循环里完成：合成器出的下一帧
      // 里启动页已不存在，主界面与启动页永不同屏。不反过来（主窗口先 show、
      // 宽限几帧再销毁启动页）：启动页只有 360×400，盖不住 1280×840 的主窗口，
      // 主界面会在启动页四周露出来，正是「启动动画没结束就出现了程序界面」。
      // 主窗口此时早已过 ready-to-show，首帧在显示之前就已画好，无需宽限。
      if (splash && !splash.isDestroyed()) splash.destroy()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
      // 交接遥测：与 splash painted 日志的时间差即首帧起算的可见时长；
      // chainWaitMs > 0 说明动画被时钟锚点偏差拖到了预算之外（dev 常见）。
      log.info('splash handoff:', { mainShown, chainWaitMs })
    })()
  }, wait)
}