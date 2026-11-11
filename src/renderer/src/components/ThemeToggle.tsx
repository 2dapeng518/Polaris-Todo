import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '../stores/useThemeStore'

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      aria-label="切换主题"
    >
      {theme === 'dark' ? (
        <Sun size={14} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Moon size={14} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  )
}