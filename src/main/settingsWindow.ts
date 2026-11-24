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

// 设置窗口的唯一 owner。设置不再是主窗口里的浮层面板，而是一扇独立的窗口
// （用户决策 2026-11-24）：左侧分类导航 + 右侧当前分类，「关于」是最后一个分类。
// - 单例：已经开着就唤到前台并切到指定分类，绝不叠出第二扇。
// - 主窗口的子窗口（parent）：永远盖在主窗口上方、随主窗口最小化；非模态，
//   可以开着设置同时操作主窗口。
// - 打开前先把主窗口叫出来（showMainWindow 由 index.ts 经 options 传入）：主窗口
//   藏在托盘时直接开设置，这扇没有可见属主的窗口在任务栏上没有自己的按钮，
//   被别的窗口盖住后就找不回来了。
// - 主窗口关进托盘时一并关闭（index.ts 的 close 处理里调 closeSettingsWindow）。

const WIDTH = 940
const HEIGHT = 660
const MIN_WIDTH = 720
const MIN_HEIGHT = 520
// 与主窗口 titleBarOverlay 同高：顶部这一条是拖拽区，右上角归系统窗口按钮。
const TITLEBAR_HEIGHT = 48

// 切页脚本是一组固定字符串（section 已在 IPC 边界按注册表白名单校验），
// 不做字符串插值——与 revealAndDispatch 的「固定字符串事件」同一条规矩。
const SECTION_SCRIPTS: Record<SettingsSection, string> = {
  appearance: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'appearance' }))",
  general: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'general' }))",
  data: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'data' }))",
  mcp: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'mcp' }))",
  about: "window.dispatchEvent(new CustomEvent('polaris:settings-section', { detail: 'about' }))"
}

export interface SettingsWindowOptions {
  /** 主窗口句柄：设置窗口以它的子窗口创建（可能尚未建出或已销毁，故可为 null）。 */
  getMainWindow: () => BrowserWindow | null
  /** 打开设置前唤起主窗口（含启动页过渡与托盘唤起），与托盘「设置」同一条路。 */
  showMainWindow: () => void
  /** 设置窗口关闭后的回调：主窗口据此补推一次更新快照（见 updater.ts）。 */
  onClosed: () => void
}

let settingsWindow: BrowserWindow | null = null
let options: SettingsWindowOptions | null = null

export function initSettingsWindow(next: SettingsWindowOptions): void {
  options = next
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
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

export function closeSettingsWindow(): void {
  const window = getSettingsWindow()
  if (window) window.close()
}

export function openSettingsWindow(section: SettingsSection = DEFAULT_SETTINGS_SECTION): void {
  // 主窗口可能藏在托盘/被最小化：设置窗口是它的子窗口，先叫出来。
  options?.showMainWindow()
  const current = getSettingsWindow()
  if (current) {
    showSection(current, section)
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
    return
  }

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

  // 居中在主窗口上；主窗口不可见（刚从托盘叫出、还在启动页过渡里）时退到
  // 鼠标所在屏的工作区中心。
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

  // 首帧画好再出场：backgroundColor 已是主题底色，没有白闪。
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    window.show()
    window.focus()
  })

  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
    options?.onClosed()
  })

  // 主帧加载失败不会有 ready-to-show：把死窗口销毁掉，单例槽位才会让给下一次
  // 打开（同提醒窗的约定）。-3（ABORTED）是快速重载的正常副产物，忽略。
  window.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    if (!window.isDestroyed()) window.destroy()
  })

  loadSettingsWindow(window, section)
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
 *  再补派发一次（幂等），保证「刚开窗又点另一个入口」的那次请求不落空。
 *  渲染层的监听器在模块求值期注册（早于 load 事件），did-finish-load 之后派发必有人接。 */
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
