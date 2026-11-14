import { execFileSync } from 'node:child_process'

// Keep the legacy entry point in sync with the master app icon generator.
execFileSync(process.execPath, ['scripts/make-app-icon.mjs'], { stdio: 'inherit' })
