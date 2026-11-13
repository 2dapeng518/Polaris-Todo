import { nativeTheme } from 'electron'
import { isAppTheme, THEME_WINDOW_BG, type AppTheme } from '../shared/themes'
import { getMeta, setMeta } from './db'

// The main process's single record of the active theme. It lives here rather
// than in index.ts so reminders.ts can read it without importing index back.
let current: AppTheme | null = null

export function initAppTheme(): void {
  const stored = getMeta('theme')
  if (isAppTheme(stored)) current = stored
}

export function getCurrentTheme(): AppTheme {
  return current ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
}

export function setCurrentTheme(theme: AppTheme): void {
  current = theme
  setMeta('theme', theme)
}

// Every window is painted --bg; surfaces inside are drawn by the renderer.
export function themeBackgroundColor(theme: AppTheme = getCurrentTheme()): string {
  return THEME_WINDOW_BG[theme]
}
