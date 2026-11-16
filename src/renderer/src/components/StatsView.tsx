import { useEffect, useMemo, useState } from 'react'
import { useTaskStore } from '../stores/useTaskStore'
import { useLocale, useT } from '../stores/useLocaleStore'
import { deriveStats, type StatsRange } from '../lib/stats'
import { EmptyState } from './EmptyState'

const RANGES: StatsRange[] = [7, 30]

export function StatsView() {
  const t = useT()
  const locale = useLocale()
  const tasks = useTaskStore((state) => state.tasks)
  const projects = useTaskStore((state) => state.projects)
  const [range, setRange] = useState<StatsRange>(7)
  // 统计页可能长时间开着：跨过午夜后「今日」不能还是昨天。
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const stats = useMemo(
    () => deriveStats(tasks, projects, now, range, locale),
    [tasks, projects, now, range, locale]
  )

  if (stats.totalDone === 0) return <EmptyState view="stats" />

  const rateText =
    stats.onTimeRate === null ? '—' : `${Math.round(stats.onTimeRate * 100)}%`
  // 柱高按当前区间内的最大值归一；全为 0 时除数兜底为 1。
  const maxCount = Math.max(1, ...stats.trend.map((day) => day.count))

  return (
    <div className="stats-view">
      <div className="stats-kpis" role="group" aria-label={t('stats.kpis')}>
        <div className="stats-kpi" data-stat="today">
          <span className="stats-kpi-label">{t('stats.today')}</span>
          <strong className="stats-kpi-value">{stats.todayDone}</strong>
          <span className="stats-kpi-hint">{t('stats.todayHint')}</span>
        </div>
        <div className="stats-kpi" data-stat="week">
          <span className="stats-kpi-label">{t('stats.week')}</span>
          <strong className="stats-kpi-value">{stats.weekDone}</strong>
          <span className="stats-kpi-hint">{t('stats.weekHint')}</span>
        </div>
        <div className="stats-kpi" data-stat="total">
          <span className="stats-kpi-label">{t('stats.total')}</span>
          <strong className="stats-kpi-value">{stats.totalDone}</strong>
          <span className="stats-kpi-hint">
            {stats.untimed > 0
              ? t('stats.untimedHint', { count: stats.untimed })
              : t('stats.allTimed')}
          </span>
        </div>
        <div className="stats-kpi" data-stat="ontime">
          <span className="stats-kpi-label">{t('stats.onTime')}</span>
          <strong className="stats-kpi-value">{rateText}</strong>
          <span className="stats-kpi-hint">
            {stats.dueCount === 0
              ? t('stats.noDue')
              : t('stats.onTimeHint', { done: stats.onTimeCount, due: stats.dueCount })}
          </span>
        </div>
      </div>

      <section className="stats-panel" aria-labelledby="stats-trend-heading">
        <div className="stats-panel-head">
          <div className="section-label" id="stats-trend-heading">
            <span>{t('stats.trend')}</span>
            <span className="section-count">{stats.trendTotal}</span>
          </div>
          <div className="stats-range" role="group" aria-label={t('stats.range')}>
            {RANGES.map((value) => (
              <button
                key={value}
                type="button"
                className={range === value ? 'active' : ''}
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {t('stats.rangeDays', { days: value })}
              </button>
            ))}
          </div>
        </div>

        <div
          className="stats-chart"
          data-range={range}
          role="img"
          aria-label={t('stats.trendAria', { days: range, total: stats.trendTotal })}
        >
          {stats.trend.map((day) => (
            <div
              className="stats-bar-col"
              key={day.key}
              title={t('stats.barTitle', { label: day.label, count: day.count })}
            >
              <div
                className={`stats-bar${day.count === 0 ? ' is-zero' : ''}`}
                data-count={day.count}
                style={{ height: day.count === 0 ? '3px' : `${(day.count / maxCount) * 100}%` }}
              />
            </div>
          ))}
        </div>

        <div className="stats-chart-axis" data-range={range} aria-hidden="true">
          {stats.trend.map((day, index) => (
            <span key={day.key}>
              {range === 7 || index % 10 === 0 || index === stats.trend.length - 1
                ? day.label
                : ''}
            </span>
          ))}
        </div>

        {stats.untimed > 0 && (
          <p className="stats-note">
            {t('stats.note', { count: stats.untimed })}
          </p>
        )}
      </section>

      <section className="stats-panel" aria-labelledby="stats-dist-heading">
        <div className="stats-panel-head">
          <div className="section-label" id="stats-dist-heading">
            <span>{t('stats.distribution')}</span>
            <span className="section-count">{stats.totalDone}</span>
          </div>
        </div>

        <div className="stats-dist">
          {stats.distribution.map((slice) => {
            const percent = Math.round((slice.count / stats.totalDone) * 100)
            return (
              <div
                className="stats-dist-row"
                key={slice.id ?? 'none'}
                data-dist={slice.id ?? 'none'}
                data-count={slice.count}
              >
                <span className="stats-dist-name">
                  <span
                    className={`stats-dist-dot${slice.color ? '' : ' is-muted'}`}
                    style={slice.color ? { background: slice.color } : undefined}
                    aria-hidden="true"
                  />
                  <span>{slice.name}</span>
                </span>
                <span className="stats-dist-track" aria-hidden="true">
                  <span className="stats-dist-fill" style={{ width: `${percent}%` }} />
                </span>
                <span className="stats-dist-count">
                  {slice.count} · {percent}%
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}