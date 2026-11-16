import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from './Icon'
import { LOCALES, type Locale } from '@shared/i18n'
import { useLocaleStore, useT, useLocale } from '../stores/useLocaleStore'

// 设置页语言行的自绘下拉。原生 <select> 的弹出菜单由系统绘制——深色主题下
// 仍是白底蓝高亮，与六套主题都不搭；这里照 ThemeMenu 的路数用 panel 令牌
// 自绘选项行，背景/描边/悬停/选中全部跟主题走。
// 菜单绝对定位在行内而非 fixed：设置面板自身滚动，锚在行里就跟着滚，
// 不需要 ThemeMenu 那套视口重定位数学。
const OPTION_LABEL_KEY = {
  'zh-CN': 'settings.languageZh',
  en: 'settings.languageEn'
} as const

export function LanguageSelect() {
  const t = useT()
  const locale = useLocale()
  const setLocale = useLocaleStore((state) => state.setLocale)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const openMenu = (): void => {
    setActiveIndex(Math.max(0, LOCALES.indexOf(locale)))
    setOpen(true)
  }

  const choose = (next: Locale): void => {
    setLocale(next)
    close(true)
  }

  // 焦点跟着 roving index 走（同 ThemeMenu：effect 跑时节点已在文档里，
  // 同步聚焦是确定性的，不用定时器）。
  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-language-index="${activeIndex}"]`)
      ?.focus()
  }, [open, activeIndex])

  // 外点收起。焦点离开本包装也收起：设置面板是焦点陷阱，Tab 环会把焦点
  // 拉回面板内控件，不拦的话菜单会变成点不动的孤儿浮层。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (wrapRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Esc 必须 stopPropagation：设置面板在 window 上监听 Esc 关整面板，
    // 不拦就一次 Esc 收两层（同 ThemeMenu 那条规矩）。
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    // Tab 不拦截默认行为：收起菜单，焦点自然流向下一个控件。
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(LOCALES[activeIndex])
      return
    }
    const last = LOCALES.length - 1
    let next: number | null = null
    if (event.key === 'ArrowDown') next = activeIndex >= last ? 0 : activeIndex + 1
    else if (event.key === 'ArrowUp') next = activeIndex <= 0 ? last : activeIndex - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    setActiveIndex(next)
  }

  return (
    <div ref={wrapRef} className="settings-language">
      <button
        ref={triggerRef}
        type="button"
        className="settings-language-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('settings.language')}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        <span>{t(OPTION_LABEL_KEY[locale])}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="settings-language-menu"
          role="listbox"
          aria-label={t('settings.language')}
          onKeyDown={onMenuKeyDown}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget as HTMLElement | null
            if (nextTarget && wrapRef.current?.contains(nextTarget)) return
            setOpen(false)
          }}
        >
          {LOCALES.map((id, index) => {
            const selected = locale === id
            return (
              <div
                key={id}
                role="option"
                aria-selected={selected}
                tabIndex={index === activeIndex ? 0 : -1}
                data-language-index={index}
                className={`settings-language-option${selected ? ' selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
                onClick={() => choose(id)}
              >
                <span>{t(OPTION_LABEL_KEY[id])}</span>
                {selected && (
                  <span className="settings-language-check" aria-hidden="true">
                    <Check size={12} strokeWidth={2.2} />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
