import { app } from 'electron'
import type { AutoStartState } from '../shared/types'

function isSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

function loginItemArgs(): string[] {
  return app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
}

export function getAutoStartState(): AutoStartState {
  if (!isSupported()) return { enabled: false, supported: false }

  try {
    if (process.platform === 'win32') {
      const settings = app.getLoginItemSettings({
        path: process.execPath,
        args: loginItemArgs()
      })
      return { enabled: settings.openAtLogin, supported: true }
    }

    const settings = app.getLoginItemSettings()
    return { enabled: settings.openAtLogin, supported: true }
  } catch (error) {
    return {
      enabled: false,
      supported: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function setAutoStartState(enabled: boolean): AutoStartState {
  if (!isSupported()) return { enabled: false, supported: false }

  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: loginItemArgs()
      })
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled })
    }

    return getAutoStartState()
  } catch (error) {
    return {
      enabled: false,
      supported: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}