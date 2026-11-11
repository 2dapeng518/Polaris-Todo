import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const electronPath = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const userData = mkdtempSync(join(tmpdir(), 'polaris-smoke-'))

const child = spawn(electronPath, [`--user-data-dir=${userData}`, root], {
  env: { ...process.env, POLARIS_SMOKE: '1' },
  stdio: 'inherit'
})

child.on('exit', (code) => {
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    // The profile can stay behind if a renderer is still releasing a file.
  }
  process.exit(code ?? 1)
})