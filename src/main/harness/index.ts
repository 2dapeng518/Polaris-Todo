// harness 入口：index.ts 在 `if (__POLARIS_HARNESS__)` 门内动态 import 本模块。
// 生产构建里该分支被 define + DCE 整体消除，本目录任何代码都不进生产包；
// harness 构建（POLARIS_HARNESS=1）里在这里按具体 env 分流，触发时机与
// 原先 createWindow 内的三段注册完全一致（SCREENSHOT 1800ms / SHOT 1400ms /
// SMOKE 立即），三个 env 相互独立，可同时设置。
import { app } from 'electron'
import { tmpdir } from 'node:os'
import { basename, resolve, sep } from 'node:path'
import { installHarnessContext, type HarnessContext } from './context'
import { captureAndQuit, captureDemo } from './capture'
import { runSmokeTest } from './smoke'

// 删库防护：冒烟会软删全部任务并清空回收站，只允许跑在临时 profile 上。
// smoke.mjs 用 mkdtempSync(tmpdir()/polaris-smoke-*) + --user-data-dir 隔离；
// 若有人手动设 POLARIS_SMOKE=1 却指向真实数据目录，这里直接拒绝执行。
// 判定取「系统临时目录之下」或「polaris-smoke- 前缀目录名」二者之一，
// 正常冒烟两条都满足，不会误伤；大小写不敏感比较照顾 Windows 路径。
function isTempSmokeProfile(): boolean {
  const userData = resolve(app.getPath('userData')).toLowerCase()
  const tempRoot = resolve(tmpdir()).toLowerCase()
  return (
    userData === tempRoot ||
    userData.startsWith(tempRoot + sep.toLowerCase()) ||
    basename(userData).startsWith('polaris-smoke-')
  )
}

export function attachHarness(ctx: HarnessContext): void {
  installHarnessContext(ctx)
  const contents = ctx.mainWindow?.webContents
  if (!contents) return

  if (process.env['POLARIS_SMOKE']) {
    if (!isTempSmokeProfile()) {
      console.error(
        'POLARIS_SMOKE_ERROR',
        new Error(
          `拒绝执行冒烟：userData（${app.getPath('userData')}）不是临时目录。` +
            '冒烟包含删库级操作，请经 npm run smoke（mkdtemp + --user-data-dir）启动。'
        )
      )
      app.exit(1)
      return
    }
    contents.once('did-finish-load', () => {
      void runSmokeTest()
    })
  }

  if (process.env['POLARIS_SCREENSHOT']) {
    contents.once('did-finish-load', () => {
      setTimeout(() => {
        void captureAndQuit()
      }, 1800)
    })
  }

  const shot = process.env['POLARIS_SHOT']
  if (shot) {
    contents.once('did-finish-load', () => {
      setTimeout(() => {
        void captureDemo(shot)
      }, 1400)
    })
  }
}