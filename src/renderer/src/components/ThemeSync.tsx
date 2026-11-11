import { useEffect } from 'react'
import { useThemeStore } from '../stores/useThemeStore'

export function ThemeSync() {
  const theme = useThemeStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const themeColor = document.querySelector('meta[name="theme-color"]')
    themeColor?.setAttribute('content', theme === 'light' ? '#F4F3EF' : '#080A0F')
    void window.polaris.app.setTheme(theme).catch((error) => {
      console.error('Failed to apply theme to the window:', error)
    })
  }, [theme])

  return null
}