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

  // Follow a theme change made in another window. setState, not setTheme: this
  // must not write back to localStorage and start a loop. Chromium only sends
  // the storage event to contexts that did not write it.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== 'polaris-theme') return
      if (event.newValue === 'light' || event.newValue === 'dark') {
        useThemeStore.setState({ theme: event.newValue })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return null
}