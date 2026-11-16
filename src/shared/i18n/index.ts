import { en } from './en'
import { zhCN, type Messages } from './zh'

// 轻量 i18n：不引第三方库。中文是按域拆分的母本（zh.ts 合并），
// 英文词典类型为 Messages，键集合必须与母本一致。
export type { Messages }
export type Locale = 'zh-CN' | 'en'
export type MessageKey = keyof Messages

export const DEFAULT_LOCALE: Locale = 'zh-CN'
export const LOCALES: readonly Locale[] = ['zh-CN', 'en']

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en'
}

/** 系统语言标签 → 界面语言：zh 开头用中文，其余一律英文。 */
export function localeFromLanguageTag(tag: string | undefined | null): Locale {
  return tag && tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const table: Messages = locale === 'en' ? en : zhCN
  return interpolate(table[key] ?? zhCN[key] ?? key, params)
}

/** 主题显示名：中文母本在 shared/themes.ts，英文名在词典；两处都经 t() 取。 */
export function themeLabel(locale: Locale, id: 'dark' | 'light' | 'dusk' | 'sand' | 'sky' | 'green'): string {
  return translate(locale, `themes.${id}.label` as MessageKey)
}

export function themeDesc(locale: Locale, id: 'dark' | 'light' | 'dusk' | 'sand' | 'sky' | 'green'): string {
  return translate(locale, `themes.${id}.desc` as MessageKey)
}

export { zhCN, en }