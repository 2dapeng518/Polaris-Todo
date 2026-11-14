import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ArrowLeftRight, ChevronDown, Moon, Sun } from 'lucide-react'
import { THEME_META, partnerTheme, themeFamily } from '@shared/themes'
import { useThemeStore } from '../stores/useThemeStore'
import { ThemeMenu } from './ThemeMenu'

// 分体式主题开关：左段是原来的配对快切（一击往返，行为与类名都不变），
// 右段箭头展开六选一。左段必须是文档序第一个 .theme-toggle —— 冒烟有六处
// querySelector('.theme-toggle') 依赖它；右段用别的类名，也不得嵌进左段
// （button 嵌 button 是非法 HTML）。
export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const lastAnnounced = useRef(theme)

  const next = partnerTheme(theme)
  const sameFamily = themeFamily(next) === themeFamily(theme)
  const nextIsDark = themeFamily(next) === 'dark'

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  // 播报节点常驻在这里，不放菜单内部：选中即卸载会把「已切换到 X」吞掉。
  useEffect(() => {
    if (lastAnnounced.current === theme) return
    lastAnnounced.current = theme
    setAnnouncement(`已切换到 ${THEME_META[theme].label}`)
  }, [theme])

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setMenuOpen(true)
  }

  return (
    <div className="theme-switch" onContextMenu={onContextMenu}>
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
      <button
        ref={triggerRef}
        className="theme-menu-trigger"
        onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
        title="全部 6 套颜色主题"
        aria-label={`选择颜色主题（共 6 套，当前：${THEME_META[theme].label}）`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? 'theme-menu' : undefined}
      >
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {menuOpen && <ThemeMenu anchorRef={triggerRef} onClose={closeMenu} />}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}