import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const electronPath = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

// 先带 harness 重建，再跑冒烟——根除「改了 src 忘 build、冒烟跑旧产物」的历史坑。
// 直接用当前 Node 执行 electron-vite 入口，不经 npm/cmd shim，Windows 下无 shell 坑。
// 重建失败必须立即报错退出，绝不拿旧 out/ 凑合跑。
const build = spawnSync(
  process.execPath,
  [join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'],
  {
    cwd: root,
    env: { ...process.env, POLARIS_HARNESS: '1' },
    stdio: 'inherit'
  }
)
if (build.error || build.status !== 0) {
  console.error('POLARIS_SMOKE_ERROR harness 重建失败，冒烟中止', build.error ?? `exit ${build.status}`)
  process.exit(1)
}

// 临时 profile 隔离纪律不变：mkdtemp + --user-data-dir，冒烟的删库级操作
// 永远碰不到真实数据库（harness 入口还会二次校验 userData 确为临时目录）。
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