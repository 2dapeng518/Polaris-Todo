import { Check } from '../Icon'
import { THEME_META, THEME_ORDER } from '@shared/themes'
import { themeDesc, themeLabel } from '@shared/i18n'
import { useThemeStore } from '../../stores/useThemeStore'
import { useLocale, useT } from '../../stores/useLocaleStore'
import { LanguageSelect } from '../LanguageSelect'
import { SettingsRow } from './SettingsRow'

// 「外观」：六套主题 + 界面语言。主题不再是塞在半幅横条里的六枚色样——独立
// 窗口里放得下「色样 + 名字」的六张小卡，名字不必只活在 title 里；气质描述
// 仍进 title。data-theme-option / aria-pressed / .theme-option 类名沿用。
export function AppearanceSection() {
  const t = useT()
  const locale = useLocale()
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-label" id="settings-theme-label">
          {t('settings.theme')}
        </div>
        <div className="settings-row-desc" title={t('settings.themeDesc')}>
          {t('settings.themeDesc')}
        </div>
        <div
          className="theme-picker settings-theme-grid"
          role="group"
          aria-labelledby="settings-theme-label"
        >
          {THEME_ORDER.map((id) => {
            const meta = THEME_META[id]
            const selected = theme === id
            const label = themeLabel(locale, id)
            return (
              <button
                key={id}
                type="button"
                data-theme-option={id}
                aria-pressed={selected}
                aria-label={label}
                title={`${label} · ${themeDesc(locale, id)}`}
                className={`theme-option ${selected ? 'selected' : ''}`}
                onClick={() => setTheme(id)}
              >
                <span className="theme-swatch" aria-hidden="true" style={{ background: meta.swatch[0] }}>
                  <span className="theme-swatch-surface" style={{ background: meta.swatch[1] }} />
                  <span className="theme-swatch-dot" style={{ background: meta.swatch[2] }} />
                </span>
                {selected && (
                  <span className="theme-option-check" aria-hidden="true">
                    <Check size={9} strokeWidth={2.6} />
                  </span>
                )}
                <span className="theme-option-name">{label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="settings-card">
        <SettingsRow title={t('settings.language')} desc={t('settings.languageDesc')}>
          <span className="settings-language-wrap" title={t('settings.languageDesc')}>
            <LanguageSelect />
          </span>
        </SettingsRow>
      </section>
    </>
  )
}
