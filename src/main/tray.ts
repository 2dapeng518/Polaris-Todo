import { Menu, Tray, nativeImage } from 'electron'
import { translate, type Locale } from '../shared/i18n'
import { getCurrentLocale } from './locale'
import { TRAY_ICON_DATA_URL } from './tray-icon'

// 托盘菜单是窗口藏起来时唯一的入口，所以「设置」「检查更新」直接放进来：
// 不必先唤起主窗口再翻设置页。「关于」留在设置里，菜单保持四项不膨胀。
let tray: Tray | null = null
let menu: Menu | null = null
let currentActions: TrayActions | null = null

export interface TrayActions {
  onOpen: () => void
  onOpenSettings: () => void
  onCheckUpdates: () => void
  onQuit: () => void
}

function buildMenu(actions: TrayActions, locale: Locale): Menu {
  return Menu.buildFromTemplate([
    { label: translate(locale, 'tray.open'), click: actions.onOpen },
    { label: translate(locale, 'tray.settings'), click: actions.onOpenSettings },
    { label: translate(locale, 'tray.checkUpdates'), click: actions.onCheckUpdates },
    { type: 'separator' },
    { label: translate(locale, 'tray.quit'), click: actions.onQuit }
  ])
}

export function createTray(actions: TrayActions): Tray {
  if (tray) return tray

  currentActions = actions
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip('Polaris')
  menu = buildMenu(actions, getCurrentLocale())
  tray.setContextMenu(menu)
  tray.on('click', actions.onOpen)
  return tray
}

/** 切换界面语言后按同一组动作重建菜单，托盘文案立刻跟上。 */
export function updateTrayLocale(locale: Locale): void {
  if (!tray || tray.isDestroyed() || !currentActions) return
  menu = buildMenu(currentActions, locale)
  tray.setContextMenu(menu)
}

/** 托盘气泡（Windows 上走系统通知）。托盘不在或已销毁时安静跳过，
 *  绝不因为一条反馈把主进程打断。 */
export function showTrayBalloon(title: string, content: string): void {
  if (!tray || tray.isDestroyed()) return
  tray.displayBalloon({ title, content })
}

/** 冒烟用：读实际构建出来的菜单项标签（分隔线不算入口），不是常量的副本。 */
export function getTrayMenuLabels(): string[] {
  return menu ? menu.items.filter((item) => item.type !== 'separator').map((item) => item.label) : []
}