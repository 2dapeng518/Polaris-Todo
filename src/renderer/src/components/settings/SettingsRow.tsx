import type { ReactNode } from 'react'

type SettingsRowProps = {
  title: ReactNode
  /** 行描述；alert 时整行替换为错误文案（全文另进 title）。 */
  desc?: ReactNode
  /** 描述是错误/不支持提示：落同一行换危险色（零增高）。 */
  alert?: boolean
  /** 右侧控件（开关、下拉、按钮组）。 */
  children?: ReactNode
}

// 设置页里的一行：左边标题 + 描述，右边控件。各分类页共用，行高只由内容决定——
// 独立窗口里一页只有一个分类，不再有「全部挤进一屏」的行数预算。
export function SettingsRow({ title, desc, alert, children }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{title}</div>
        {desc !== undefined && (
          <div
            className={`settings-row-desc ${alert ? 'is-error' : ''}`}
            role={alert ? 'alert' : undefined}
            title={typeof desc === 'string' ? desc : undefined}
          >
            {desc}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

type SwitchProps = {
  checked: boolean
  /** 开关的无障碍名称（行标题可能带计数等装饰，名称这里给干净的）。 */
  label: string
  disabled?: boolean
  onToggle: () => void
}

export function Switch({ checked, label, disabled, onToggle }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="switch-thumb" />
    </button>
  )
}

type SwitchRowProps = {
  title: string
  desc: string
  alert?: boolean
  checked: boolean
  label: string
  disabled?: boolean
  onToggle: () => void
}

export function SwitchRow({ title, desc, alert, checked, label, disabled, onToggle }: SwitchRowProps) {
  return (
    <SettingsRow title={title} desc={desc} alert={alert}>
      <Switch checked={checked} label={label} disabled={disabled} onToggle={onToggle} />
    </SettingsRow>
  )
}
