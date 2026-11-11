import { PolarisMark } from './PolarisMark'
import { ThemeToggle } from './ThemeToggle'

export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar-inner">
        <div className="brand">
          <PolarisMark size={22} />
          <span className="brand-name" translate="no">Polaris</span>
        </div>
        <ThemeToggle />
        <div className="titlebar-hint">
          <span className="hint-dot" />
          <span>本地数据库已连接</span>
        </div>
      </div>
    </header>
  )
}