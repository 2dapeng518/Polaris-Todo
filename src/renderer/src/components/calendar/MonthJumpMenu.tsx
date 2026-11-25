import { useEffect, useRef, useState } from 'react'
import { addMonths, format, isSameMonth } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import type { Locale } from '@shared/i18n'
import { useLocale, useT } from '../../stores/useLocaleStore'
import { monthLabel } from '../../lib/dateTime'
import { useAnchoredPopover } from '../../lib/useAnchoredPopover'
import { ChevronLeft, ChevronRight } from '../Icon'

// 弹层月份格的短标签：中文「11月」，英文 "Nov"。
function shortMonthLabel(month: Date, locale: Locale): string {
  return locale === 'en'
    ? format(month, 'MMM', { locale: enUS })
    : format(month, 'M月', { locale: zhCN })
}

// 年月快速跳转（日历套件 P1.4）：月份标签本身是下拉触发器，弹层里切年份 +
// 点月份格子。锚定浮层走公共 useAnchoredPopover；Esc 在浮层根上
// stopPropagation 只关自己（同 ThemeMenu 的路由约定）。
type MonthJumpMenuProps = {
  month: Date
  onPick: (month: Date) => void
}

export function MonthJumpMenu({ month, onPick }: MonthJumpMenuProps) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => month.getFullYear())
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 248,
    estimatedHeight: 264,
    outsideIgnoreSelector: '[data-calendar-jump]',
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  // 打开瞬间把弹层里的年份对齐当前月；不开时不占心智。
  useEffect(() => {
    if (open) setYear(month.getFullYear())
  }, [open, month])

  const pick = (candidate: Date): void => {
    onPick(candidate)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="calendar-month calendar-month-jump"
        data-calendar-jump
        data-calendar-month
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('calendar.jump.open')}
        onClick={() => setOpen((value) => !value)}
      >
        {/* 翻月播报复用可见的月份标签本身（旧 span 的 data-calendar-month /
            aria-live 约定原样保留，冒烟按它取文案）。 */}
        <span aria-live="polite">{monthLabel(month, locale)}</span>
        <ChevronRight size={10} className="calendar-month-caret" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="calendar-jump"
          style={{ top: place.top, left: place.left }}
          role="dialog"
          aria-label={t('calendar.jump.open')}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
            // React 根先于 window 监听拿到 Esc：只关下拉，不外溢。
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          <div className="calendar-jump-year">
            <button
              type="button"
              className="calendar-nav"
              aria-label={t('calendar.prevMonth')}
              onClick={() => setYear((value) => value - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span className="calendar-jump-yearnum" aria-live="polite">{year}</span>
            <button
              type="button"
              className="calendar-nav"
              aria-label={t('calendar.nextMonth')}
              onClick={() => setYear((value) => value + 1)}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="calendar-jump-grid" role="listbox" aria-label={t('calendar.jump.open')}>
            {Array.from({ length: 12 }, (_, index) => {
              const candidate = new Date(year, index, 1)
              const isCurrent = isSameMonth(candidate, month)
              return (
                <button
                  key={index}
                  type="button"
                  role="option"
                  className={`calendar-jump-month ${isCurrent ? 'is-current' : ''}`}
                  aria-selected={isCurrent}
                  onClick={() => {
                    // 同年同月 = 只是收起；否则跳到同月同日（月末自动钳制由调用方处理）。
                    pick(addMonths(month, (candidate.getFullYear() - month.getFullYear()) * 12 + index - month.getMonth()))
                  }}
                >
                  {shortMonthLabel(candidate, locale)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
