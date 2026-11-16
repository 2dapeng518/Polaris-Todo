import { useEffect, useMemo, useState } from 'react'
import { useTaskStore } from '../stores/useTaskStore'
import { deriveStats, type StatsRange } from '../lib/stats'
import { EmptyState } from './EmptyState'

const RANGES: StatsRange[] = [7, 30]

export function StatsView() {
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
    () => deriveStats(tasks, projects, now, range),
    [tasks, projects, now, range]
  )

  if (stats.totalDone === 0) return <EmptyState view="stats" />

  const rateText =
    stats.onTimeRate === null ? '—' : `${Math.round(stats.onTimeRate * 100)}%`
  // 柱高按当前区间内的最大值归一；全为 0 时除数兜底为 1。
  const maxCount = Math.max(1, ...stats.trend.map((day) => day.count))

  return (
    <div className="stats-view">
      <div className="stats-kpis" role="group" aria-label="关键数字">
        <div className="stats-kpi" data-stat="today">
          <span className="stats-kpi-label">今日完成</span>
          <strong className="stats-kpi-value">{stats.todayDone}</strong>
          <span className="stats-kpi-hint">按完成时刻统计</span>
        </div>
        <div className="stats-kpi" data-stat="week">
          <span className="stats-kpi-label">本周完成</span>
          <strong className="stats-kpi-value">{stats.weekDone}</strong>
          <span className="stats-kpi-hint">周一至今天</span>
        </div>
        <div className="stats-kpi" data-stat="total">
          <span className="stats-kpi-label">累计完成</span>
          <strong className="stats-kpi-value">{stats.totalDone}</strong>
          <span className="stats-kpi-hint">
            {stats.untimed > 0 ? `其中 ${stats.untimed} 项未记录时刻` : '全部已记录时刻'}
          </span>
        </div>
        <div className="stats-kpi" data-stat="ontime">
          <span className="stats-kpi-label">按时完成率</span>
          <strong className="stats-kpi-value">{rateText}</strong>
          <span className="stats-kpi-hint">
            {stats.dueCount === 0
              ? '没有设过截止时间的完成记录'
              : `${stats.onTimeCount}/${stats.dueCount} 项在截止前完成`}
          </span>
        </div>
      </div>

      <section className="stats-panel" aria-labelledby="stats-trend-heading">
        <div className="stats-panel-head">
          <div className="section-label" id="stats-trend-heading">
            <span>完成趋势</span>
            <span className="section-count">{stats.trendTotal}</span>
          </div>
          <div className="stats-range" role="group" aria-label="时间范围">
            {RANGES.map((value) => (
              <button
                key={value}
                type="button"
                className={range === value ? 'active' : ''}
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {value} 天
              </button>
            ))}
          </div>
        </div>

        <div
          className="stats-chart"
          data-range={range}
          role="img"
          aria-label={`最近 ${range} 天完成趋势，共完成 ${stats.trendTotal} 项`}
        >
          {stats.trend.map((day) => (
            <div className="stats-bar-col" key={day.key} title={`${day.label} · ${day.count} 项`}>
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
            早期完成的任务未记录时刻，不计入趋势与按时完成率（共 {stats.untimed} 项）。
          </p>
        )}
      </section>

      <section className="stats-panel" aria-labelledby="stats-dist-heading">
        <div className="stats-panel-head">
          <div className="section-label" id="stats-dist-heading">
            <span>项目分布</span>
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