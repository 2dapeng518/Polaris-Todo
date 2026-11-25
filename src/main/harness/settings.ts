// 设置窗口的冒烟/截图助手。设置是独立的子窗口（主窗口里已经没有设置面板）：
// 所有针对设置的脚本都在设置窗口的 webContents 里执行，这里负责开窗、等就绪、
// 切页、关窗与收尾——各段断言只写自己关心的操作，不再各自拼「点开面板 / 点关闭」
// 的样板。只在 POLARIS_HARNESS=1 构建里存在（见 index.ts 的门控动态 import）。

import type { BrowserWindow } from 'electron'
import { DEFAULT_SETTINGS_SECTION, type SettingsSection } from '../../shared/settings'
import { closeSettingsWindow, isSettingsWindowVisible } from '../settingsWindow'
import { harnessContext } from './context'
import { settledFrames, waitForCondition } from './util'

/** 关掉可能残留的设置窗口：每段断言都从「不可见」的干净态开始（关闭=隐藏复用）。 */
export async function ensureSettingsClosed(): Promise<void> {
  closeSettingsWindow()
  await waitForCondition(() => !isSettingsWindowVisible(), 4000)
}

/**
 * 经真实 UI（主窗口侧栏的「设置」按钮）打开设置窗口并切到指定分类，
 * 等页面可交互后返回句柄；超时返回 null，由调用方计入断言失败。
 */
export async function openSettingsFor(
  section: SettingsSection = DEFAULT_SETTINGS_SECTION
): Promise<BrowserWindow | null> {
  const { mainWindow, getSettingsWindow } = harnessContext()
  if (!mainWindow) return null
  await ensureSettingsClosed()
  await mainWindow.webContents.executeJavaScript(`document.querySelector('.settings-item')?.click()`)
  const ready = await waitForCondition(async () => {
    const window = getSettingsWindow()
    if (!window) return false
    const contents = window.webContents
    if (contents.isDestroyed() || contents.isLoading() || !window.isVisible()) return false
    return Boolean(
      await contents.executeJavaScript(`Boolean(document.querySelector('.settings-window .settings-nav'))`)
    )
  }, 10000)
  if (!ready) return null
  await showSettingsSection(section)
  return getSettingsWindow()
}

/** 在已开着的设置窗口里点导航切页，等目标页挂载并沉降两帧。 */
export async function showSettingsSection(section: SettingsSection): Promise<boolean> {
  const window = harnessContext().getSettingsWindow()
  if (!window) return false
  const contents = window.webContents
  await contents
    .executeJavaScript(`document.querySelector('[data-settings-section="${section}"]')?.click()`)
    .catch(() => {})
  const shown = await waitForCondition(
    () =>
      contents.executeJavaScript(
        `Boolean(document.querySelector('.settings-page[data-settings-page="${section}"]'))`
      ),
    4000
  )
  if (shown) await settledFrames(contents)
  return shown
}

/**
 * 收尾：关窗，再让主窗口补一次 focus。设置窗口里的导入等写入由主窗口的
 * 修订号门在获得焦点时拉取——真实使用里关掉设置窗口焦点自然回到主窗口，
 * 冒烟里应用未必在前台，所以主动派发一次 focus 事件，断言主界面数据前不必
 * 各自再补。
 */
export async function closeSettingsAndSettle(): Promise<void> {
  const { mainWindow } = harnessContext()
  closeSettingsWindow()
  await waitForCondition(() => !isSettingsWindowVisible(), 4000)
  if (!mainWindow || mainWindow.isDestroyed()) return
  await mainWindow.webContents
    .executeJavaScript(`window.dispatchEvent(new Event('focus'))`)
    .catch(() => {})
  await settledFrames(mainWindow.webContents)
}

/**
 * 「开设置 → 跑断言 → 关设置」的统一外壳。run 拿到设置窗口句柄后在它的
 * 页面里执行脚本；无论成败都会关窗收尾。fallback 是开窗失败时的返回值。
 */
export async function withSettings<T>(
  section: SettingsSection,
  fallback: T,
  run: (settings: BrowserWindow) => Promise<T>
): Promise<T> {
  const settings = await openSettingsFor(section)
  if (!settings) return fallback
  try {
    return await run(settings)
  } finally {
    await closeSettingsAndSettle()
  }
}
