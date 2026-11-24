import { useEffect, useRef } from 'react'
import { isLocale } from '@shared/i18n'
import { LOCALE_STORAGE_KEY, useLocaleStore } from '../stores/useLocaleStore'

/** 把界面语言同步到 <html lang>、主进程（托盘/气泡/原生对话框）与其他窗口。 */
export function LocaleSync() {
  const locale = useLocaleStore((state) => state.locale)
  const mounted = useRef(false)

  useEffect(() => {
    document.documentElement.lang = locale
    // 首帧也要同步一次：主进程托盘可能在窗口加载前按 meta 建好了。
    void window.polaris.app.setLocale(locale).catch((error) => {
      console.error('Failed to apply locale to the main process:', error)
    })
    mounted.current = true
  }, [locale])

  // 跟随另一个窗口的语言切换。setState 而非 setLocale：不回写 localStorage，
  // 避免两端互相触发 storage 事件。
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== LOCALE_STORAGE_KEY) return
      if (isLocale(event.newValue)) {
        useLocaleStore.setState({ locale: event.newValue })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 重装/换 profile 后 localStorage 为空：从主进程 meta 权威值回填（meta 在
  // 数据库内，随数据存放位置走）。只在存储键缺失时触发；setLocale 写回
  // localStorage，语言从此与 meta 一致。
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    } catch {
      return
    }
    if (stored !== null) return
    void window.polaris.app
      .getLocale()
      .then((value) => {
        if (isLocale(value) && localStorage.getItem(LOCALE_STORAGE_KEY) === null) {
          useLocaleStore.getState().setLocale(value)
        }
      })
      .catch((error) => {
        console.error('Failed to restore locale from the main process:', error)
      })
  }, [])

  // 冒烟用的确定性语言注入钩子（与 __polarisSetTheme 同一约定）。
  useEffect(() => {
    window.__polarisSetLocale = (value: string) => {
      if (isLocale(value)) useLocaleStore.getState().setLocale(value)
    }
    return () => {
      delete window.__polarisSetLocale
    }
  }, [])

  return null
}