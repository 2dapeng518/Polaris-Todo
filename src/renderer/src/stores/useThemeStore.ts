import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'polaris-theme'

function getInitialTheme(): Theme {
  const fromDocument = document.documentElement.dataset.theme
  if (fromDocument === 'light' || fromDocument === 'dark') return fromDocument

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
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

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
  }
}))