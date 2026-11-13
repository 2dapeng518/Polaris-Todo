import { useEffect } from 'react'
import { isAppTheme, THEME_WINDOW_BG } from '@shared/themes'
import { useThemeStore } from '../stores/useThemeStore'

export function ThemeSync() {
  const theme = useThemeStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const themeColor = document.querySelector('meta[name="theme-color"]')
    themeColor?.setAttribute('content', THEME_WINDOW_BG[theme])
    void window.polaris.app.setTheme(theme).catch((error) => {
      console.error('Failed to apply theme to the window:', error)
    })
  }, [theme])

  // Follow a theme change made in another window. setState, not setTheme: this
  // must not write back to localStorage and start a loop. Chromium only sends
  // the storage event to contexts that did not write it.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== 'polaris-theme') return
      if (isAppTheme(event.newValue)) {
        useThemeStore.setState({ theme: event.newValue })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 冒烟测试用的确定性主题注入钩子（与 __polarisParseNow 同一约定）：
  // 仅调用 store，不引入任何特权；正常使用时也安全无害。
  useEffect(() => {
    window.__polarisSetTheme = (value: string) => {
      if (isAppTheme(value)) useThemeStore.getState().setTheme(value)
    }
    return () => {
      delete window.__polarisSetTheme
    }
  }, [])

  return null
}
