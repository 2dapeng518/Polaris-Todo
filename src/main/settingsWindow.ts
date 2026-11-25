import { BrowserWindow, screen, type WebContents } from 'electron'
import { join } from 'node:path'
import { THEME_SYMBOL_COLOR, themeFamily, type AppTheme } from '../shared/themes'
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSection,
  type SettingsSection
} from '../shared/settings'
import { getCurrentLocale } from './locale'
import { getCurrentTheme, themeBackgroundColor } from './theme'

// 设置窗口的唯一 owner。设置是主窗口的一扇独立子窗口（用户决策 2026-11-24）：
// 左侧分类导航 + 右侧当前分类，「关于」固定在最后。
// - 单例：已经开着就唤到前台并切到指定分类，绝不叠出第二扇。
// - 主窗口的子窗口（parent）：永远盖在主窗口上方、随主窗口最小化；非模态。
// - 打开前先把主窗口叫出来（showMainWindow 由 index.ts 经 options 传入）。
// - 「关闭即隐藏、复用」（用户报障 2026-11-25：每次冷加载整包太慢）：Esc / 关闭
//   只是 hide，窗口与已加载的前端包常驻，再开即现；启动时 warmupSettingsWindow
//   后台预热，首次打开也不冷加载。真正销毁只发生在应用退出（before-quit 放行）。
// - 主窗口关进托盘时一并隐藏（index.ts 的 close 处理里调 closeSettingsWindow）。

const WIDTH = 940
// 高度要放得下最长的「快捷键」列表（12 行）而不出纵向滚动条（用户报障 2026-11-25）。
const HEIGHT = 700
const MIN_WIDTH = 720
const MIN_HEIGHT = 620
// 与主窗口 titleBarOverlay 同高：顶部这一条是拖拽区，右上角归系统窗口按钮。
const TITLEBAR_HEIGHT = 48

// 切页脚本是一组固定字符串（section 已在 IPC 边界按注册表白名单校验），
// 不做字符串插值——与 revealAndDispatch 的「固定字符串事件」同一条规矩。
const SECTION_SCRIPTS: Record<SettingsSection, string> = {
  appearance: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'appearance' }))",
  general: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'general' }))",
  hotkey: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'hotkey' }))",
  data: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'data' }))",
  mcp: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'mcp' }))",
  about: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'about' }))"
}

export interface SettingsWindowOptions {
  /** 主窗口句柄：设置窗口以它的子窗口创建（可能尚未建出或已销毁，故可为 null）。 */
  getMainWindow: () => BrowserWindow | null
  /** 打开设置前唤起主窗口（含启动页过渡与托盘唤起），与托盘「设置」同一条路。 */
  showMainWindow: () => void
  /** 设置窗口隐藏后的回调：主窗口据此补推一次更新快照（见 updater.ts）。 */
  onClosed: () => void
}

let settingsWindow: BrowserWindow | null = null
let options: SettingsWindowOptions | null = null
// 退出放行：before-quit 置 true 后，close 不再拦截隐藏，窗口随应用真正销毁。
let allowDestroy = false

export function initSettingsWindow(next: SettingsWindowOptions): void {
  options = next
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
}

/** 设置窗口是否正可见（隐藏复用态下「开着」= 可见，冒烟据此判「开/关」）。 */
export function isSettingsWindowVisible(): boolean {
  const window = getSettingsWindow()
  return window !== null && window.isVisible()
}

/** 某个 webContents 是否就是设置窗口（IPC 的属主判断：主题/语言写回、文件对话框父窗）。 */
export function isSettingsWebContents(contents: WebContents): boolean {
  const window = getSettingsWindow()
  return window !== null && window.webContents === contents
}

/** 主题切换后重画系统窗口按钮的符号色（背景色由 index.ts 统一刷所有窗口）。 */
export function applySettingsWindowTheme(theme: AppTheme): void {
  const window = getSettingsWindow()
  if (!window) return
  window.setTitleBarOverlay({
    color: '#00000000',
    symbolColor: THEME_SYMBOL_COLOR[themeFamily(theme)],
    height: TITLEBAR_HEIGHT
  })
}

/** 「关闭」= 隐藏复用（close 事件里拦截）；这里只触发 close。 */
export function closeSettingsWindow(): void {
  const window = getSettingsWindow()
  if (window) window.close()
}

/** 应用退出前调用（before-quit）：放行 close 拦截，让窗口随退出真正销毁。 */
export function prepareSettingsWindowForQuit(): void {
  allowDestroy = true
}

/** 启动后台预热：建好隐藏窗口并加载前端包，首次打开即现（不冷加载）。 */
export function warmupSettingsWindow(): void {
  if (getSettingsWindow()) return
  createSettingsWindow()
}

export function openSettingsWindow(section: SettingsSection = DEFAULT_SETTINGS_SECTION): void {
  // 主窗口可能藏在托盘/被最小化：设置窗口是它的子窗口，先叫出来。
  options?.showMainWindow()
  const window = getSettingsWindow() ?? createSettingsWindow()
  showSection(window, section)
  if (window.isMinimized()) window.restore()
  showWhenReady(window)
}

/** 建窗（show:false，不自动出场）：预热与首次打开共用。加载默认分类，切页由
 *  openSettingsWindow 的 showSection 负责。 */
function createSettingsWindow(): BrowserWindow {
  const parent = options?.getMainWindow() ?? null
  // 低分辨率屏：默认与最小尺寸不超过主屏工作区，窗口不被顶出屏幕（同主窗口）。
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    width: Math.min(WIDTH, workArea.width),
    height: Math.min(HEIGHT, workArea.height),
    minWidth: Math.min(MIN_WIDTH, workArea.width),
    minHeight: Math.min(MIN_HEIGHT, workArea.height),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    show: false,
    backgroundColor: themeBackgroundColor(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: THEME_SYMBOL_COLOR[themeFamily(getCurrentTheme())],
      height: TITLEBAR_HEIGHT
    },
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  settingsWindow = window

  // 居中在主窗口上；主窗口不可见（启动预热 / 刚从托盘叫出）时退到鼠标所在屏中心。
  const [width, height] = window.getSize()
  const visibleParent =
    parent && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized() ? parent : null
  const anchor = visibleParent
    ? visibleParent.getBounds()
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  window.setPosition(
    Math.round(anchor.x + (anchor.width - width) / 2),
    Math.round(anchor.y + (anchor.height - height) / 2)
  )

  // 关闭即隐藏复用：除非应用退出放行，close 一律拦截成 hide，前端包常驻。
  window.on('close', (event) => {
    if (allowDestroy) return
    event.preventDefault()
    if (!window.isDestroyed()) window.hide()
    options?.onClosed()
  })

  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
  })

  // 主帧加载失败不会有 ready-to-show：把死窗口销毁掉，单例槽位才会让给下一次
  // 打开（同提醒窗的约定）。-3（ABORTED）是快速重载的正常副产物，忽略。
  window.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    if (!window.isDestroyed()) window.destroy()
  })

  loadSettingsWindow(window, DEFAULT_SETTINGS_SECTION)
  return window
}

/** 出场：已加载（预热态）立即 show；还在加载则等首帧画好再 show，避免白闪。 */
function showWhenReady(window: BrowserWindow): void {
  const show = () => {
    if (window.isDestroyed()) return
    window.show()
    window.focus()
  }
  if (window.webContents.isLoading()) window.once('ready-to-show', show)
  else show()
}

function loadSettingsWindow(window: BrowserWindow, section: SettingsSection): void {
  // hash 统一带前导斜杠（#/settings/<分类>）：与渲染层 sectionStore 的
  // replaceState 写法一致——主进程冒烟按 URL 认设置窗口时两种形态不会打架。
  const hash = `/settings/${section}`
  const locale = getCurrentLocale()
  if (process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL']
    void window.loadURL(`${base}${base.includes('?') ? '&' : '?'}locale=${locale}#${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash, query: { locale } })
  }
}

/** 已开着的窗口切页。页面还在加载时初始 hash 已带上分类，这里等 load 完
 *  再补派发一次（幂等），保证「刚开窗又点另一个入口」的那次请求不落空。 */
function showSection(window: BrowserWindow, section: SettingsSection): void {
  const contents = window.webContents
  const dispatch = () => {
    if (contents.isDestroyed()) return
    void contents.executeJavaScript(SECTION_SCRIPTS[section]).catch(() => {
      // 页面尚未可执行时这次切页落空；下次点击入口仍可用，不打断主进程。
    })
  }
  if (contents.isLoading()) contents.once('did-finish-load', dispatch)
  else dispatch()
}

/** IPC 载荷 → 分类：只认注册表里的字面量，其余一律落到第一页。 */
export function settingsSectionFrom(value: unknown): SettingsSection {
  return isSettingsSection(value) ? value : DEFAULT_SETTINGS_SECTION
}
