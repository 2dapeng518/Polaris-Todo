import { useCallback } from 'react'
import { create } from 'zustand'
import {
  DEFAULT_LOCALE,
  isLocale,
  localeFromLanguageTag,
  translate,
  type Locale,
  type MessageKey
} from '@shared/i18n'

export const LOCALE_STORAGE_KEY = 'polaris-locale'

// 冒烟模式由主进程在加载 URL 上带 locale=zh-CN，保证语言确定；普通启动按
// 已存值 → 系统语言回退。
function getInitialLocale(): Locale {
  try {
    const forced = new URLSearchParams(window.location.search).get('locale')
    if (isLocale(forced)) return forced
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(stored)) return stored
    return localeFromLanguageTag(navigator.language)
  } catch {
    return DEFAULT_LOCALE
  }
}

type LocaleState = {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: getInitialLocale(),

  setLocale: (locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // 存储不可用时保持会话内切换。
    }
    set({ locale })
  }
}))

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/** 订阅 locale 并返回绑定的 t；切换语言时整棵组件树重渲染。 */
export function useT(): Translate {
  const locale = useLocaleStore((state) => state.locale)
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  )
}

export function useLocale(): Locale {
  return useLocaleStore((state) => state.locale)
}