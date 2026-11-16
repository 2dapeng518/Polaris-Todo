import { useT } from '../stores/useLocaleStore'

export function ProgressRing({ value, label }: { value: number; label: string }) {
  const t = useT()
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, value))
  const offset = circumference * (1 - clamped)

  return (
    <div className="progress-ring" title={t('views.progressTitle', { label })}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="var(--ring-track)"
          strokeWidth="3"
        />
        <circle
          className="progress-ring-value"
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <div className="progress-label">
        <strong>{label}</strong>
        <span>{t('views.progressLabel')}</span>
      </div>
    </div>
  )
}