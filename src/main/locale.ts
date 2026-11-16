import { app } from 'electron'
import { isLocale, localeFromLanguageTag, type Locale } from '../shared/i18n'
import { getMeta, setMeta } from './db'

// 主进程的界面语言记录：托盘、气泡、原生文件对话框都读这里。
// 持久化复用 meta 表（'locale'），不新增迁移。
const META_KEY = 'locale'
const HARNESS = process.env['POLARIS_SMOKE'] || process.env['POLARIS_SHOT'] || process.env['POLARIS_SCREENSHOT']

let current: Locale | null = null

export function initAppLocale(): void {
  // 冒烟与截图必须确定性中文：现有断言与截图全部按中文文本工作。
  if (HARNESS) {
    current = 'zh-CN'
    return
  }
  const stored = getMeta(META_KEY)
  current = isLocale(stored) ? stored : localeFromLanguageTag(app.getLocale())
}

export function getCurrentLocale(): Locale {
  return current ?? 'zh-CN'
}

export function setCurrentLocale(locale: Locale): void {
  current = locale
  setMeta(META_KEY, locale)
}