import { useEffect, useRef, useState } from 'react'
import { useT } from '../../stores/useLocaleStore'
import { useAnchoredPopover } from '../../lib/useAnchoredPopover'
import { Switch } from '../settings/SettingsRow'
import { SlidersHorizontal } from '../Icon'

// 显示设置弹层（日历套件 P3.4）：月格信息层的开关面板（农历/节假日/周数）。
// 开关即时生效并记住（useCalendarStore 持久化）。锚定浮层走公共 hook，
// Esc 在浮层根上 stopPropagation 只关自己（同 ThemeMenu 路由约定）。
type CalendarDisplayMenuProps = {
  showLunar: boolean
  showHolidays: boolean
  showWeekNumbers: boolean
  onLunar: (show: boolean) => void
  onHolidays: (show: boolean) => void
  onWeekNumbers: (show: boolean) => void
}

export function CalendarDisplayMenu({
  showLunar,
  showHolidays,
  showWeekNumbers,
  onLunar,
  onHolidays,
  onWeekNumbers
}: CalendarDisplayMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 236,
    estimatedHeight: 148,
    outsideIgnoreSelector: '[data-calendar-display]',
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => popoverRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, popoverRef])

  const rows: Array<{ key: string; label: string; value: boolean; on: (v: boolean) => void }> = [
    { key: 'lunar', label: t('calendar.display.lunar'), value: showLunar, on: onLunar },
    { key: 'holidays', label: t('calendar.display.holidays'), value: showHolidays, on: onHolidays },
    { key: 'weekNumbers', label: t('calendar.display.weekNumbers'), value: showWeekNumbers, on: onWeekNumbers }
  ]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`calendar-tool-button ${open ? 'is-active' : ''}`}
        data-calendar-display
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('calendar.display.title')}
        title={t('calendar.display.title')}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="calendar-display"
          style={{ top: place.top, left: place.left }}
          role="dialog"
          aria-label={t('calendar.display.title')}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          <div className="calendar-display-title">{t('calendar.display.title')}</div>
          {rows.map((row) => (
            <div key={row.key} className="calendar-display-row">
              <span className="calendar-display-label">{row.label}</span>
              <Switch checked={row.value} label={row.label} onToggle={() => row.on(!row.value)} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
