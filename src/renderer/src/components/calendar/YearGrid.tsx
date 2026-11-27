import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { Task } from '@shared/types'
import type { Locale } from '@shared/i18n'
import { useT } from '../../stores/useLocaleStore'
import { parseDayKey } from '../../stores/useCalendarStore'
import { dayKey, monthMatrix, weekdayLabels } from '../../lib/dateTime'

// 年视图：12 个迷你月格，任务日浅色底标记；点日期钻取日视图，
// 点月份标题切月视图。只读总览，不做拖拽。
//
// 键盘：365 天里只有「漫游日」一个 Tab 停留点，方向键在年内逐日/逐周移动，
// Enter/空格钻取；12 个月份标题是独立按钮。跨年由工具栏翻页，不在格内越界。
type YearGridProps = {
  year: number
  anchorKey: string
  now: Date
  locale: Locale
  byDay: Map<string, Task[]>
  onSelectDay: (day: Date) => void
  onSelectMonth: (month: Date) => void
}

export function YearGrid({
  year,
  anchorKey,
  now,
  locale,
  byDay,
  onSelectDay,
  onSelectMonth
}: YearGridProps) {
  const t = useT()
  const todayKey = dayKey(now)
  const anchor = useMemo(() => parseDayKey(anchorKey), [anchorKey])
  const [focusDay, setFocusDay] = useState(anchor)
  const focusRequest = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // 锚点被外部改了（工具栏翻年/「今天」/月标题钻取）时漫游日跟随。
  useEffect(() => {
    setFocusDay(anchor)
  }, [anchorKey])

  useLayoutEffect(() => {
    if (!focusRequest.current) return
    focusRequest.current = false
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-year-date="${dayKey(focusDay)}"]`)
      ?.focus()
  }, [focusDay])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    const target = event.target as HTMLElement
    if (!target.dataset.yearDate) return
    const move = (next: Date): void => {
      // 先拦掉默认滚动：年在边界时（12/31 → 次年 1/1）不移动，但页面也不该
      // 因为方向键滚一下。
      event.preventDefault()
      if (next.getFullYear() !== year) return
      focusRequest.current = true
      setFocusDay(next)
    }
    if (event.key === 'ArrowLeft') return move(addDays(focusDay, -1))
    if (event.key === 'ArrowRight') return move(addDays(focusDay, 1))
    if (event.key === 'ArrowUp') return move(addDays(focusDay, -7))
    if (event.key === 'ArrowDown') return move(addDays(focusDay, 7))
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectDay(focusDay)
    }
  }

  // 504 格（12×42）在 shell 每分钟 tick 时都会重渲染；把月矩阵与 dayKey 预先
  // 算好，避免每分钟 504 次 date-fns format。weekday 标签同理。
  const weekdays = useMemo(() => weekdayLabels(locale), [locale])
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, monthIndex) => {
        const month = new Date(year, monthIndex, 1)
        return {
          monthIndex,
          month,
          title:
            locale === 'en'
              ? format(month, 'MMMM', { locale: enUS })
              : `${monthIndex + 1}月`,
          cells: monthMatrix(month).map((day) => ({ day, key: dayKey(day) }))
        }
      }),
    [year, locale]
  )

  return (
    <div
      className="year-grid"
      data-year-grid
      ref={gridRef}
      role="group"
      aria-label={t('calendar.yearAria', { year })}
      onKeyDown={onKeyDown}
    >
      {months.map(({ monthIndex, month, title, cells }) => {
        return (
          <section
            key={monthIndex}
            className="year-month"
            data-year-month={monthIndex}
            aria-label={title}
          >
            <button
              type="button"
              className="year-month-title"
              onClick={() => onSelectMonth(month)}
            >
              {title}
            </button>
            <div className="year-weekdays" aria-hidden="true">
              {weekdays.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="year-days">
              {cells.map(({ day, key }) => {
                const inMonth = day.getMonth() === monthIndex
                const count = inMonth ? (byDay.get(key)?.length ?? 0) : 0
                const isToday = key === todayKey
                const isRoving = inMonth && isSameDay(day, focusDay)
                return (
                  <div
                    key={key}
                    className={`year-cell${inMonth ? '' : ' is-out'}${
                      isToday ? ' is-today' : ''
                    }${count > 0 ? ' has-tasks' : ''}${isRoving ? ' is-roving' : ''}`}
                    role={inMonth ? 'button' : undefined}
                    aria-hidden={inMonth ? undefined : true}
                    data-year-date={inMonth ? key : undefined}
                    tabIndex={inMonth ? (isRoving ? 0 : -1) : undefined}
                    aria-label={
                      inMonth
                        ? t('calendar.cellAria', {
                            month: monthIndex + 1,
                            day: day.getDate(),
                            count
                          })
                        : undefined
                    }
                    aria-current={isToday ? 'date' : undefined}
                    onClick={inMonth ? () => onSelectDay(day) : undefined}
                  >
                    <span className="year-daynum">{day.getDate()}</span>
                    {count > 0 && <span className="year-dot" aria-hidden="true" />}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}