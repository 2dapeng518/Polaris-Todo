/// <reference types="vite/client" />

import type { PolarisApi } from '@shared/types'

declare global {
  interface Window {
    polaris: PolarisApi
    /** Smoke-test clock injection. Only ever set by runSmokeTest, and deleted
     *  again before it returns; undefined in normal use. */
    __polarisParseNow?: string
  }
}

export {}