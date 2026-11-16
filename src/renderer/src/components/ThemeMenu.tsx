import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { Check } from './Icon'
import { THEME_META, THEME_ORDER, partnerTheme, themeFamily, type AppTheme } from '@shared/themes'
import { themeLabel } from '@shared/i18n'
import { useThemeStore } from '../stores/useThemeStore'
import { useTaskStore } from '../stores/useTaskStore'
import { useT, useLocale } from '../stores/useLocaleStore'

type ThemeMenuProps = {
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: (restoreFocus: boolean) => void
}

const MENU_WIDTH = 240

// 标题栏右段箭头展开的六选一。非模态：无遮罩、不入 useFocusTrap 的陷阱栈，
// 与日期弹层同档。行是 div[role=menuitemradio] 而不是 button —— 陷阱的 FOCUSABLE
// 选择器数 button 不看 tabindex，六个 button 会污染窄屏详情的 Tab 环。
export function ThemeMenu({ anchorRef, onClose }: ThemeMenuProps) {
  const t = useT()
  const locale = useLocale()
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)

  const menuRef = useRef<HTMLDivElement>(null)
  // 首帧就给出位置，绝不用 visibility:hidden 占位：隐藏的节点不可聚焦，而
  // useLayoutEffect 里 setState 会让 React 先 flush 上一轮的 passive effect，
  // 于是「聚焦当前行」会打在还隐藏着的行上静默失败，Esc 就落到箭头而不是菜单里。
  const [place, setPlace] = useState(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return { top: 0, left: 0 }
    return {
      top: rect.bottom + 6,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12))
    }
  })
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, THEME_ORDER.indexOf(theme)))

  const choose = useCallback(
    (id: AppTheme) => {
      setTheme(id)
      onClose(true)
    },
    [setTheme, onClose]
  )

  // 锚定数学与 TaskDetail.tsx 的 openPopover / 重定位 effect 同源：先按锚点左对齐
  // 并夹在视口内，再用真实高度决定朝上还是朝下。offsetHeight 而非 rect —— pop-in
  // 的 scale 会污染 rect。这里复制而不抽公共 lib：日期选择器那套冒烟覆盖很密，
  // 等第三个浮层出现再抽。
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const element = menuRef.current
    if (!anchor || !element) return

    const rect = anchor.getBoundingClientRect()
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12))
    const reposition = (): void => {
      const height = element.offsetHeight
      const below = rect.bottom + 6
      const above = rect.top - height - 6
      const preferred = below + height <= window.innerHeight - 12 ? below : above
      const top = Math.max(12, Math.min(preferred, window.innerHeight - 12 - height))
      setPlace((prev) =>
        Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5 ? prev : { top, left }
      )
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    observer.observe(element)
    return () => observer.disconnect()
  }, [anchorRef])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (menuRef.current?.contains(target)) return
      if (target?.closest('.theme-switch')) return
      onClose(false)
    }
    const onResize = () => onClose(false)
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  // Ctrl K 不经过指针事件，外点监听拦不住；命令面板一开就主动收起，
  // 免得一次 Esc 收两层。
  useEffect(() => {
    if (paletteOpen) onClose(false)
  }, [paletteOpen, onClose])

  // 焦点跟着 roving index 走。不用 30ms 定时器：这里没有 AnimatePresence，
  // effect 跑的时候节点已经在文档里，同步聚焦是确定性的，也就没有
  // 「重定位重新武装定时器抢焦点」那类竞态。
  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-theme-menu-index="${activeIndex}"]`)
      ?.focus()
  }, [activeIndex])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Esc 必须 stopPropagation：TaskDetail 在 window 上监听 Esc，
    // 不拦就会关掉详情栏而不是这张菜单（同 QuickAdd 那条规矩）。
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
      return
    }
    // Tab 不拦截默认行为：收起菜单，焦点自然流向下一个控件。
    if (event.key === 'Tab') {
      onClose(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(THEME_ORDER[activeIndex])
      return
    }

    const last = THEME_ORDER.length - 1
    let next: number | null = null
    if (event.key === 'ArrowDown') next = activeIndex >= last ? 0 : activeIndex + 1
    else if (event.key === 'ArrowUp') next = activeIndex <= 0 ? last : activeIndex - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    setActiveIndex(next)
  }

  const partner = partnerTheme(theme)
  const sameFamily = themeFamily(theme) === themeFamily(partner)

  return (
    <div
      ref={menuRef}
      id="theme-menu"
      className="theme-menu"
      role="menu"
      aria-label={t('themes.aria')}
      style={{ top: place.top, left: place.left }}
      onKeyDown={onKeyDown}
      // 焦点被别处抢走时也收起。窄屏详情是模态陷阱，它的 Tab 处理会把焦点
      // 拉回详情面板；没有这条，菜单会变成一张点不动、Esc 也够不着的孤儿浮层。
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as HTMLElement | null
        if (nextTarget && (menuRef.current?.contains(nextTarget) || nextTarget.closest('.theme-switch'))) return
        onClose(false)
      }}
    >
      <div className="theme-menu-head">
        <span>{t('themes.menuTitle')}</span>
        <span className="theme-menu-count">{t('themes.menuCount')}</span>
      </div>
      <div className="theme-menu-list">
        {THEME_ORDER.map((id, index) => {
          const meta = THEME_META[id]
          const selected = theme === id
          return (
            <div
              key={id}
              role="menuitemradio"
              aria-checked={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              data-theme-menu-item={id}
              data-theme-menu-index={index}
              className={`theme-menu-item${selected ? ' selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
              onClick={() => choose(id)}
            >
              <span className="theme-swatch" aria-hidden="true" style={{ background: meta.swatch[0] }}>
                <span className="theme-swatch-surface" style={{ background: meta.swatch[1] }} />
                <span className="theme-swatch-dot" style={{ background: meta.swatch[2] }} />
              </span>
              <span className="theme-menu-label">
                {themeLabel(locale, id)}
                <span className="theme-menu-family">
                  {meta.family === 'dark' ? t('themes.darkFamily') : t('themes.lightFamily')}
                </span>
              </span>
              {selected && (
                <span className="theme-option-check" aria-hidden="true">
                  <Check size={12} strokeWidth={2.2} />
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="theme-menu-foot">
        {t('themes.menuFoot', {
          first: themeLabel(locale, theme),
          second: themeLabel(locale, partner)
        })}
        {sameFamily ? t('themes.sameFamily') : ''}
      </div>
    </div>
  )
}