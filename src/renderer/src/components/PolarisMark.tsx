export function PolarisMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="polaris-gradient" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: 'var(--mark-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-b)' }} />
        </linearGradient>
      </defs>
      <path
        d="M12 2.4c.43 5.22 4.38 9.17 9.6 9.6-5.22.43-9.17 4.38-9.6 9.6-.43-5.22-4.38-9.17-9.6-9.6 5.22-.43 9.17-4.38 9.6-9.6Z"
        fill="url(#polaris-gradient)"
      />
      <circle cx="12" cy="12" r="1.35" style={{ fill: 'var(--bg)' }} fillOpacity=".72" />
    </svg>
  )
}