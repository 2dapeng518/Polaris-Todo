import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const electronPath = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const child = spawn(electronPath, [root], {
  env: { ...process.env, POLARIS_SMOKE: '1' },
  stdio: 'inherit'
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})