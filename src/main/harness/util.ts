// 冒烟与截图共用的等待原语：有界轮询 + 两帧沉降。
// waitForCondition 超时返回 false 而不是抛错，让整轮跑完、报出所有失败。

import { type WebContents } from 'electron'

// 等一个可观测条件，而不是赌固定延时。超时返回 false 让调用方计入断言，
// 不抛错 —— 冒烟要跑完并报出全部失败项，而不是在第一个超时处中断。
// 探测本身可能打在正在导航或已销毁的窗口上，那种失败按「还没就绪」处理。
export async function waitForCondition(
  probe: () => boolean | Promise<boolean>,
  timeout = 6000,
  interval = 50
): Promise<boolean> {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      if (await probe()) return true
    } catch {
      // 窗口正在导航或已关闭，继续等。
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

// 截图前的绘制栅栏：两帧 rAF 保证合成器真的画过，而不是 DOM 刚提交就截图。
// 必须带超时兜底 —— 窗口被遮挡时 rAF 会被节流，裸等这个 Promise 会挂死整轮冒烟。
export async function settledFrames(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return
  await Promise.race([
    contents
      .executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'
      )
      .catch(() => false),
    new Promise((resolve) => setTimeout(resolve, 1000))
  ])
}
