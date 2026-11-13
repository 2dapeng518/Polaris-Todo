import { create } from 'zustand'
import { isAppTheme, partnerTheme, type AppTheme } from '@shared/themes'

export type Theme = AppTheme

const STORAGE_KEY = 'polaris-theme'

function getInitialTheme(): Theme {
  const fromDocument = document.documentElement.dataset.theme
  if (isAppTheme(fromDocument)) return fromDocument

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isAppTheme(stored)) return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

type ThemeState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),

  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage can be unavailable in restricted environments; the theme still applies for this session.
    }
    set({ theme })
  },

  // 快捷切换在对合配对间翻转（dark↔light、dusk↔sand、sky↔green），连点两次必回到原主题。
  toggleTheme: () => {
    get().setTheme(partnerTheme(get().theme))
  }
}))
