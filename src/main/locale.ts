import { app } from 'electron'
import { isLocale, localeFromLanguageTag, type Locale } from '../shared/i18n'
import { getMeta, setMeta } from './db'

// 主进程的界面语言记录：托盘、气泡、原生文件对话框都读这里。
// 持久化复用 meta 表（'locale'），不新增迁移。
const META_KEY = 'locale'
// 测试 env 读取只存在于 harness 构建：生产构建 __POLARIS_HARNESS__ 恒 false，
// 这段被编译期消除，HARNESS 恒 false，语言记录照常走 meta/系统语言。
let HARNESS = false
if (__POLARIS_HARNESS__) {
  HARNESS = Boolean(
    process.env['POLARIS_SMOKE'] || process.env['POLARIS_SHOT'] || process.env['POLARIS_SCREENSHOT']
  )
}

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