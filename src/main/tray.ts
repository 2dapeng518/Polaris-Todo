import { Menu, Tray, nativeImage } from 'electron'
import { TRAY_ICON_DATA_URL } from './tray-icon'

let tray: Tray | null = null

export function createTray(onOpen: () => void, onQuit: () => void): Tray {
  if (tray) return tray

  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip('Polaris')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Polaris', click: onOpen },
      { type: 'separator' },
      { label: '退出', click: onQuit }
    ])
  )
  tray.on('click', onOpen)
  return tray
}