import { ArrowLeftRight, Moon, Sun } from 'lucide-react'
import { THEME_META, partnerTheme, themeFamily } from '@shared/themes'
import { useThemeStore } from '../stores/useThemeStore'

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)
  const next = partnerTheme(theme)
  const sameFamily = themeFamily(next) === themeFamily(theme)
  const nextIsDark = themeFamily(next) === 'dark'

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={`切换到 ${THEME_META[next].label}`}
      aria-label={`切换主题（当前：${THEME_META[theme].label}）`}
    >
      {sameFamily ? (
        <ArrowLeftRight size={14} strokeWidth={1.8} aria-hidden="true" />
      ) : nextIsDark ? (
        <Moon size={14} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Sun size={14} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  )
}
