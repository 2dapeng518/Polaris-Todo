/// <reference types="vite/client" />

import type { PolarisApi } from '@shared/types'

declare global {
  interface Window {
    polaris: PolarisApi
  }
}

export {}