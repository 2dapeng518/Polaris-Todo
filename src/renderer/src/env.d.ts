/// <reference types="vite/client" />

import type { PolarisApi } from '@shared/types'

declare global {
  interface Window {
    polaris: PolarisApi
    /** Smoke-test clock injection. Only ever set by runSmokeTest, and deleted
     *  again before it returns; undefined in normal use. */
    __polarisParseNow?: string
    /** 冒烟测试用的确定性主题注入；由 ThemeSync 挂载，仅调用主题 store。 */
    __polarisSetTheme?: (theme: string) => void
    /** 冒烟测试用的确定性语言注入；由 LocaleSync 挂载。 */
    __polarisSetLocale?: (locale: string) => void
  }
}

export {}