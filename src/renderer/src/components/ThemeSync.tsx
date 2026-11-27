import { useEffect, useRef } from 'react'
import { isAppTheme, THEME_WINDOW_BG } from '@shared/themes'
import { useThemeStore } from '../stores/useThemeStore'

export function ThemeSync() {
  const theme = useThemeStore((state) => state.theme)
  const mounted = useRef(false)
  // 全新 profile（localStorage 为空）时，首帧主题只是系统偏好的兜底；meta
  // （随数据库走）才是权威。先推本地值会把随数据目录迁过来的主题覆盖掉，
  // 后面再读 meta 读到的已经是自己刚写的值。等回填后的主题变化再推。
  const skipInitialPush = useRef(false)

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = theme
    }
    // 主题切换淡变：支持 View Transitions 且非 reduced-motion 时走一次性 cross-fade，
    // 否则立即应用。首帧不淡变（初始主题已由 index.html 内联脚本落定）。
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const startViewTransition = (
      document as Document & { startViewTransition?: (update: () => void) => unknown }
    ).startViewTransition
    if (mounted.current && startViewTransition && !reduceMotion) {
      startViewTransition.call(document, apply)
    } else {
      apply()
    }
    mounted.current = true
    const themeColor = document.querySelector('meta[name="theme-color"]')
    themeColor?.setAttribute('content', THEME_WINDOW_BG[theme])
    let stored: string | null = null
    try {
      stored = localStorage.getItem('polaris-theme')
    } catch {
      stored = null
    }
    if (stored === null && !skipInitialPush.current) {
      skipInitialPush.current = true
      return
    }
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

  // 重装/换 profile 后 localStorage 为空：从主进程 meta 权威值回填（meta 在
  // 数据库内，随数据存放位置走）。只在存储键缺失（全新 profile）时触发，
  // 正常启动不产生第二次往返，也不与内联脚本/存储事件打架。setTheme 会把
  // 值写回 localStorage，并向主进程回显同值（setCurrentTheme 幂等）。
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem('polaris-theme')
    } catch {
      return
    }
    if (stored !== null) return
    void window.polaris.app
      .getTheme()
      .then((value) => {
        if (isAppTheme(value) && localStorage.getItem('polaris-theme') === null) {
          useThemeStore.getState().setTheme(value)
        }
      })
      .catch((error) => {
        console.error('Failed to restore theme from the main process:', error)
      })
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
