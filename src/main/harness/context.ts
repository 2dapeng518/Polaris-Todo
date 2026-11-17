// HarnessContext：生产侧（index.ts）与测试 harness 之间唯一的依赖接口。
// 为什么存在：harness 原本直接读 index.ts 的模块作用量（mainWindow、backupSchema、
// writeFileAtomic、热键/托盘动作），拆文件后不能反向 import 生产入口——那会把
// 整个生产模块拉进 harness 依赖图，形成循环。改为 index.ts 在构建期门内构造
// 本对象并经动态 import 传入，harness 只认这份显式契约。
import type { BrowserWindow } from 'electron'
import type { BackupSchema } from '../index'

export interface HarnessContext {
  // 主窗口句柄。harness 各函数在调用时取一次快照：冒烟/截图全程窗口不会被
  // 销毁重建（hide ≠ destroy），快照与原先直读模块变量语义一致；
  // 保留 null 联合类型，让原有的 !mainWindow 守卫原样成立。
  mainWindow: BrowserWindow | null
  // 备份校验 schema 本体（不是包装函数）：断言用 safeParse 检查 v1/v2 缺省字段。
  backupSchema: BackupSchema
  // 原子写：backupRoundTrip / atomicWriteWorks 断言直接复用生产实现。
  writeFileAtomic: (filePath: string, content: string) => Promise<void>
  // 热键/托盘的真实动作入口：冒烟必须走生产同一条唤起路径，不许第二套。
  revealQuickCapture: () => Promise<void>
  revealSettings: () => Promise<void>
  checkUpdatesFromTray: () => Promise<void>
}

let current: HarnessContext | null = null

// 只由 harness 入口（attachHarness）调用一次；此前任何 harnessContext() 都是编程错误。
export function installHarnessContext(ctx: HarnessContext): void {
  current = ctx
}

export function harnessContext(): HarnessContext {
  if (!current) {
    throw new Error('HarnessContext 未安装：harness 只能经 attachHarness 启动')
  }
  return current
}