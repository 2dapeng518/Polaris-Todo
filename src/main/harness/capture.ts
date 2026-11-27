// 截图 harness：POLARIS_SHOT / POLARIS_SCREENSHOT 的全部截图助手。
// 只在 POLARIS_HARNESS=1 构建里存在（define + DCE 剥离，见 electron.vite.config.ts），
// 生产包不含本目录任何代码。窗口句柄经 HarnessContext 注入，不反向引用 index.ts。

import { app } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createSplashWindow } from '../splash'
import { THEME_ORDER } from '../../shared/themes'
import { checkRemindersNow, dismissReminder, getReminderWindow } from '../reminders'
import { setMcpEnabled } from '../mcp'
import { getCurrentLocale } from '../locale'
import type { SettingsSection } from '../../shared/settings'
import { harnessContext } from './context'
import { settledFrames } from './util'
import { closeSettingsAndSettle, openSettingsFor } from './settings'

// 截图脚本按文本找元素：中英文界面都要命中，候选词并列（中文在前，冒烟不受影响）。
function findByText(selector: string, candidates: string[]): string {
  return `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => ${JSON.stringify(candidates)}.some((c) => el.textContent.includes(c)))`
}

function shotEn(): boolean {
  return getCurrentLocale() === 'en'
}

async function captureTo(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return
  // 被遮挡/后台窗口的 BeginFrame 被 Chromium 节流，capturePage 会拿到整帧
  // 黑图（长种子流程的 calendar 分支尤易触发）：先亮窗要焦点，再等两帧
  // 渲染落地（1s 兜底）再拍。
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  await settledFrames(mainWindow.webContents)
  const image = await mainWindow.webContents.capturePage()
  await writeFile(join(process.cwd(), filename), image.toPNG())
}

// 设置窗口各页的截图模式（light- 前缀变体同理）：设置是独立的子窗口，
// 截的是它自己的 webContents，不是主窗口。
const SETTINGS_SHOTS: Record<string, SettingsSection> = {
  settings: 'appearance',
  'settings-general': 'general',
  'settings-data': 'data',
  'settings-mcp': 'mcp',
  'settings-about': 'about'
}

async function captureSettingsScreenshot(filename: string, section: SettingsSection): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  // MCP 页要连令牌块一起入镜：先经生产入口启用，拍完恢复关闭（meta 回到 off）。
  const mcpShot = section === 'mcp'
  if (mcpShot) setMcpEnabled(true)
  try {
    const settings = await openSettingsFor(section)
    if (!settings) return
    await new Promise((resolve) => setTimeout(resolve, 500))
    const image = await settings.webContents.capturePage()
    await writeFile(join(process.cwd(), filename), image.toPNG())
  } finally {
    await closeSettingsAndSettle()
    if (mcpShot) setMcpEnabled(false)
  }
}

// 快捷键独立分类页：键帽式列表（全局热键 + 应用内快捷键，逐行铅笔改键）。
async function captureHotkeyScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return
  const settings = await openSettingsFor('hotkey')
  if (!settings) return
  try {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const image = await settings.webContents.capturePage()
    await writeFile(join(process.cwd(), filename), image.toPNG())
  } finally {
    await closeSettingsAndSettle()
  }
}

// 侧栏收起态（仅深色档）：点真实的收起按钮，拍完点回去，profile 不留状态。
async function captureSidebarCollapsedScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(`document.querySelector('.sidebar-collapse')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 450))
  await captureTo(filename)
  await mainWindow.webContents.executeJavaScript(`document.querySelector('.sidebar-collapse')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 300))
}

async function captureThemePaletteScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.search-trigger')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
  await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.command-input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(shotEn() ? 'theme' : '主题')});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await captureTo(filename)
}

async function captureThemeMenuScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.theme-menu-trigger')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 450))
  await captureTo(filename)
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.theme-menu-trigger')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 250))
}

async function captureRecurrenceScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.task-title')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  await mainWindow.webContents.executeJavaScript(
    `${findByText('.detail-row', ['重复', 'Repeat'])}?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 350))
  await mainWindow.webContents.executeJavaScript(
    `(() => { const chip = ${findByText('.detail-chip', ['每周', 'Weekly'])}; if (chip) { chip.focus(); chip.click(); } })()`
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
  await captureTo(filename)
  await mainWindow.webContents.executeJavaScript(
    `${findByText('.detail-chip', ['不重复', "Doesn't repeat"])}?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.detail-close')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 200))
}

async function captureToastScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.task-delete')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 550))
  await captureTo(filename)
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.toast-action')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
}

async function captureReminderDetailScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.task-title')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  await mainWindow.webContents.executeJavaScript(
    `${findByText('.detail-row', ['提醒', 'Reminder'])}?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 350))
  await captureTo(filename)

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.detail-close')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
}

async function captureReminderScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  const taskId = await mainWindow.webContents.executeJavaScript(`(async () => {
    const tasks = await window.polaris.tasks.list();
    const task = tasks.find((candidate) => !candidate.completed);
    if (!task) return null;
    await window.polaris.tasks.update({
      id: task.id,
      remindAt: new Date(Date.now() - 60000).toISOString()
    });
    return task.id;
  })()`)

  if (!taskId) {
    await captureTo(filename)
    return
  }

  checkRemindersNow()
  await new Promise((resolve) => setTimeout(resolve, 2200))

  const reminderWindow = getReminderWindow()
  if (reminderWindow) {
    const image = await reminderWindow.webContents.capturePage()
    await writeFile(join(process.cwd(), filename), image.toPNG())
  }

  await mainWindow.webContents.executeJavaScript(
    `window.polaris.tasks.update({ id: ${JSON.stringify(taskId)}, remindAt: null })`
  )
  dismissReminder()
}

// 回收站截图：种两条已删任务 → 进回收站 → （可选）打开彻底删除确认 → 截图 →
// 硬删自清场并路由回今天。confirm 变体截确认弹窗。
async function captureTrashScreenshot(filename: string, confirm: boolean): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return
  const wc = mainWindow.webContents

  const ids = await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const projects = await window.polaris.projects.list();
    const polaris = projects.find((p) => p.name === 'Polaris');
    const personal = projects.find((p) => ['个人', 'Personal'].includes(p.name));
    const due = new Date();
    due.setHours(23, 59, 0, 0);
    const seeds = ${JSON.stringify(
      shotEn()
        ? [
            { title: 'Archive the old design drafts', project: 'polaris' },
            { title: 'Cancel the weekend dinner', project: 'personal' }
          ]
        : [
            { title: '归档旧版设计稿', project: 'polaris' },
            { title: '取消周末的聚餐', project: 'personal' }
          ]
    )}.map((s) => ({ title: s.title, projectId: s.project === 'polaris' ? (polaris ? polaris.id : null) : (personal ? personal.id : null) }));
    const created = [];
    for (const seed of seeds) {
      const task = await window.polaris.tasks.create({ title: seed.title, dueAt: due.toISOString(), projectId: seed.projectId });
      await window.polaris.tasks.remove(task.id);
      created.push(task.id);
    }
    window.dispatchEvent(new Event('focus'));
    await sleep(400);
    ${findByText('.nav-item', ['回收站', 'Trash'])}?.click();
    for (let i = 0; i < 40 && document.querySelectorAll('.trash-item').length < 2; i++) await sleep(50);
    await sleep(450);
    return created;
  })()`)

  if (confirm) {
    await wc.executeJavaScript(`document.querySelector('.trash-item .trash-purge')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await captureTo(filename)

  // 自清场：关掉可能开着的确认弹窗，硬删种子行，路由回今天。
  await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('.confirm-actions button')?.click();
    await sleep(250);
    for (const id of ${JSON.stringify(ids)}) await window.polaris.tasks.deleteForever(id);
    window.dispatchEvent(new Event('focus'));
    await sleep(300);
    ${findByText('.nav-item', ['今天', 'Today'])}?.click();
    await sleep(300);
  })()`)
}

// One shot per parse-strip state, so the quiet states get reviewed too.
const PARSE_SHOTS: Record<string, string> = {
  parse: '下周三下午3点交季度报告 #Polaris !高',
  'parse-past': '2025年10月1日补记 #Polaris',
  'parse-notice': '排期 #工作室装修',
  'parse-blocked': '明天下午3点'
}

async function captureParseScreenshot(filename: string, text: string): Promise<void> {
  const { mainWindow } = harnessContext()
  await mainWindow?.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.quick-add input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 800))
  await captureTo(filename)
}

async function captureDuePickerScreenshot(filename: string, confirm: boolean): Promise<void> {
  const { mainWindow } = harnessContext()
  await mainWindow?.webContents.executeJavaScript(`document.querySelector('.task-title')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 700))
  if (confirm) {
    await mainWindow?.webContents.executeJavaScript(`(async () => {
      const repeat = ${findByText('.detail-row', ['重复', 'Repeat'])};
      repeat?.click();
      await new Promise((r) => setTimeout(r, 300));
      ${findByText('.detail-chip', ['每天', 'Daily'])}?.click();
      await new Promise((r) => setTimeout(r, 300));
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  await mainWindow?.webContents.executeJavaScript(`(() => {
    ${findByText('.detail-row', ['截止', 'Due'])}?.click();
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 450))
  if (confirm) {
    await mainWindow?.webContents.executeJavaScript(
      `document.querySelector('.detail-popover-clear')?.click()`
    )
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  await captureTo(filename)
}

// 日历截图：首启示例只落在今天/明天，月历太稀疏。自种一批散布全月的任务
// （含逾期与一条已完成），截完硬删清场、路由回今天——与回收站截图同一套路。
async function captureCalendarScreenshot(filename: string): Promise<void> {
  const seeded = await seedCalendarTasks()
  const { mainWindow } = harnessContext()
  const wc = mainWindow?.webContents
  await captureTo(filename)
  if (!wc) return
  // 黑帧诊断（主进程侧打印——渲染层 console 不回传 stdout）：截图那一刻
  // 渲染器里的日历是否真实存在、窗口可见性状态、有无渲染层未捕获错误。
  const dbg = await wc
    .executeJavaScript(
      `({ cells: document.querySelectorAll('.calendar-cell').length, body: document.body.innerHTML.length, vis: document.visibilityState, title: document.querySelector('.view-title')?.textContent ?? null, errors: window.__shotErrors ?? [] })`
    )
    .catch((error) => String(error))
  console.log('POLARIS_SHOT_CAL_DEBUG', JSON.stringify(dbg))
  await cleanupCalendarSeeds(seeded.ids)
}

// 日历套件子视图截图（calendar-week / calendar-multiweek / calendar-day /
// calendar-multiday / calendar-list / calendar-board）：同一份种子，切到
// 指定子视图截一张，清理后回到「今天」+ 月视图。
async function captureCalendarModeScreenshot(submode: string, filename: string): Promise<void> {
  const seeded = await seedCalendarTasks()
  const ids = seeded.ids
  const { mainWindow } = harnessContext()
  const wc = mainWindow?.webContents
  if (!wc) return
  await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tab = document.querySelector('[data-calendar-mode-tab="${submode}"]');
    if (tab) tab.click();
    for (let i = 0; i < 40 && !document.querySelector('[data-timegrid], [data-calendar-list], [data-calendar-board], [data-multiweek]'); i++) await sleep(50);
    await sleep(450);
  })()`)
  await captureTo(filename)
  await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const monthTab = document.querySelector('[data-calendar-mode-tab="month"]');
    if (monthTab) monthTab.click();
    await sleep(150);
  })()`)
  await cleanupCalendarSeeds(ids)
}

async function cleanupCalendarSeeds(ids: string[]): Promise<void> {
  const { mainWindow } = harnessContext()
  const wc = mainWindow?.webContents
  if (!wc) return
  await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const id of ${JSON.stringify(ids)}) {
      // deleteForever 只删软删行（防误删活跃任务的护栏）：先软删再硬删。
      await window.polaris.tasks.remove(id);
      await window.polaris.tasks.deleteForever(id);
    }
    window.dispatchEvent(new Event('focus'));
    await sleep(300);
    ${findByText('.nav-item', ['今天', 'Today'])}?.click();
    await sleep(300);
  })()`)
}

async function seedCalendarTasks(): Promise<{ ids: string[]; errors: string[] }> {
  const { mainWindow } = harnessContext()
  const wc = mainWindow?.webContents
  if (!wc) return { ids: [], errors: [] }
  return (await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 渲染层未捕获错误收集器：shot 的诊断要随结果回传主进程（渲染层
    // console 不回传 stdout）。
    window.__shotErrors = [];
    window.addEventListener('error', (e) => { window.__shotErrors.push(String(e.error?.stack || e.message)); });
    window.addEventListener('unhandledrejection', (e) => { window.__shotErrors.push('rejection: ' + String(e.reason)); });
    const projects = await window.polaris.projects.list();
    const polaris = projects.find((p) => p.name === 'Polaris');
    const personal = projects.find((p) => ['个人', 'Personal'].includes(p.name));
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const at = (day, hour) => new Date(y, m, day, hour, 0, 0, 0).toISOString();
    const seeds = ${JSON.stringify(
      shotEn()
        ? [
            { title: 'Compile market research notes', day: 3, hour: 10, project: 'polaris', priority: 1 },
            { title: 'Submit the expense report', day: 8, hour: 17, project: 'personal', priority: 2 },
            { title: 'Design review meeting', day: 12, hour: 14, project: 'polaris', priority: 3 },
            { title: 'Water the plants', day: 15, hour: 9, project: 'personal', priority: 0 },
            { title: 'Ship the patch release', day: 19, hour: 20, project: 'polaris', priority: 3 },
            { title: 'Weekend grocery list', day: 22, hour: 11, project: 'personal', priority: 1 },
            { title: 'Finish "Designing Design"', day: 26, hour: 21, project: 'personal', priority: 0 },
            { title: 'Monthly review', day: 28, hour: 16, project: 'polaris', priority: 2 }
          ]
        : [
            { title: '整理市场调研笔记', day: 3, hour: 10, project: 'polaris', priority: 1 },
            { title: '提交报销单', day: 8, hour: 17, project: 'personal', priority: 2 },
            { title: '设计评审会', day: 12, hour: 14, project: 'polaris', priority: 3 },
            { title: '给绿植浇水', day: 15, hour: 9, project: 'personal', priority: 0 },
            { title: '发布补丁版本', day: 19, hour: 20, project: 'polaris', priority: 3 },
            { title: '周末采购清单', day: 22, hour: 11, project: 'personal', priority: 1 },
            { title: '读完《设计中的设计》', day: 26, hour: 21, project: 'personal', priority: 0 },
            { title: '月度回顾', day: 28, hour: 16, project: 'polaris', priority: 2 }
          ]
    )}.map((s) => ({ title: s.title, dueAt: at(s.day, s.hour), projectId: s.project === 'polaris' ? (polaris ? polaris.id : null) : (personal ? personal.id : null), priority: s.priority }));
    const created = [];
    for (const seed of seeds) {
      const task = await window.polaris.tasks.create(seed);
      created.push(task.id);
    }
    // 给周视图加一条带计划时间段的任务 + 一条全天任务，让时间轴/全天行有内容。
    const startAt = new Date(y, m, Math.min(now.getDate() + 1, 28), 10, 0, 0, 0).toISOString();
    const endAt = new Date(y, m, Math.min(now.getDate() + 1, 28), 11, 30, 0, 0).toISOString();
    const timed = await window.polaris.tasks.create({ title: ${JSON.stringify(shotEn() ? 'Focus block: calendar suite' : '专注时段：日历套件')}, dueAt: startAt, startAt, endAt });
    created.push(timed.id);
    const allDayStart = new Date(y, m, Math.min(now.getDate() + 1, 28), 0, 0, 0, 0).toISOString();
    const allDayEnd = new Date(y, m, Math.min(now.getDate() + 1, 28), 23, 59, 0, 0).toISOString();
    const allDay = await window.polaris.tasks.create({ title: ${JSON.stringify(shotEn() ? 'Team offsite (all day)' : '团队外出（全天）')}, dueAt: allDayStart, startAt: allDayStart, endAt: allDayEnd, allDay: true });
    created.push(allDay.id);
    await window.polaris.tasks.toggle(created[3], true);
    window.dispatchEvent(new Event('focus'));
    await sleep(400);
    ${findByText('.nav-item', ['日历', 'Calendar'])}?.click();
    for (let i = 0; i < 40 && !document.querySelector('.calendar-grid, [role="gridcell"], [data-timegrid]'); i++) await sleep(50);
    await sleep(450);
    return { ids: created, errors: window.__shotErrors };
  })()`)) as { ids: string[]; errors: string[] }
}

export async function captureDemo(mode: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) {
    app.quit()
    return
  }

  // 截图证据：记录当前语言与首个导航文本，事后凭日志核对中英文界面，不依赖目视图片。
  console.log('POLARIS_SHOT_LOCALE', getCurrentLocale())
  const navText = await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.nav-item')?.textContent ?? ''`
  )
  console.log('POLARIS_SHOT_NAV', navText)

  try {
    if (mode === 'splash') {
      // 启动页逐主题截图：与生产共用 createSplashWindow，截完即销毁，
      // 不触碰主窗口主题，也不走 openSplashWindow 的过渡生命周期。
      for (const id of THEME_ORDER) {
        const win = createSplashWindow(id, app.getVersion())
        await new Promise<void>((resolve) => {
          win.once('ready-to-show', () => resolve())
        })
        win.showInactive()
        // 动画约 2s 播完；深色主题额外截一帧 500ms 的汇聚中段作为动效证据。
        if (id === 'dark') {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const early = await win.webContents.capturePage()
          await writeFile(join(process.cwd(), 'screenshot-splash-dark-early.png'), early.toPNG())
        }
        await new Promise((resolve) => setTimeout(resolve, id === 'dark' ? 1600 : 2100))
        const image = await win.webContents.capturePage()
        await writeFile(join(process.cwd(), `screenshot-splash-${id}.png`), image.toPNG())
        win.destroy()
      }
      app.quit()
      return
    }

    if (mode === 'themes') {
      for (const id of ['dark', 'light', 'dusk', 'sand', 'sky', 'green']) {
        await mainWindow.webContents.executeJavaScript(
          `window.__polarisSetTheme && window.__polarisSetTheme(${JSON.stringify(id)})`
        )
        await new Promise((resolve) => setTimeout(resolve, 550))
        await captureTo(`screenshot-theme-${id}.png`)
        await captureThemeMenuScreenshot(`screenshot-theme-menu-${id}.png`)
      }
      await captureSettingsScreenshot('screenshot-theme-picker.png', 'appearance')
      await mainWindow.webContents.executeJavaScript(
        `window.__polarisSetTheme && window.__polarisSetTheme('dark')`
      )
      app.quit()
      return
    }

    if (!mode.startsWith('light')) {
      await mainWindow.webContents.executeJavaScript(
        `window.__polarisSetTheme && window.__polarisSetTheme('dark')`
      )
      await new Promise((resolve) => setTimeout(resolve, 600))
    }

    if (mode.startsWith('light')) {
      await mainWindow.webContents.executeJavaScript(
        `window.__polarisSetTheme && window.__polarisSetTheme('light')`
      )
      await new Promise((resolve) => setTimeout(resolve, 600))

      if (mode === 'light-detail') {
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('.task-title')?.click()`
        )
        await new Promise((resolve) => setTimeout(resolve, 700))
        await captureTo('screenshot-light-detail.png')
      } else if (mode === 'light-palette') {
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('.search-trigger')?.click()`
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        await mainWindow.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('.command-input');
          if (!input) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(shotEn() ? 'task' : '任务')});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`)
        await new Promise((resolve) => setTimeout(resolve, 500))
        await captureTo('screenshot-light-palette.png')
      } else if (mode === 'light-projects') {
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('.project-add')?.click()`
        )
        await new Promise((resolve) => setTimeout(resolve, 400))
        await captureTo('screenshot-light-projects.png')
      } else if (mode === 'light-reminder') {
        await captureReminderScreenshot('screenshot-light-reminder.png')
      } else if (mode === 'light-reminder-detail') {
        await captureReminderDetailScreenshot('screenshot-light-reminder-detail.png')
      } else if (SETTINGS_SHOTS[mode.slice(6)]) {
        await captureSettingsScreenshot(`screenshot-light-${mode.slice(6)}.png`, SETTINGS_SHOTS[mode.slice(6)])
      } else if (mode === 'light-hotkey') {
        await captureHotkeyScreenshot('screenshot-light-hotkey.png')
      } else if (mode === 'light-theme-menu') {
        await captureThemeMenuScreenshot('screenshot-light-theme-menu.png')
      } else if (mode === 'light-palette-theme') {
        await captureThemePaletteScreenshot('screenshot-light-palette-theme.png')
      } else if (mode === 'light-toast') {
        await captureToastScreenshot('screenshot-light-toast.png')
      } else if (mode === 'light-recurrence') {
        await captureRecurrenceScreenshot('screenshot-light-recurrence.png')
      } else if (mode === 'light-due-picker') {
        await captureDuePickerScreenshot('screenshot-light-due-picker.png', false)
      } else if (mode === 'light-due-clear') {
        await captureDuePickerScreenshot('screenshot-light-due-clear.png', true)
      } else if (mode === 'light-trash') {
        await captureTrashScreenshot('screenshot-light-trash.png', false)
      } else if (PARSE_SHOTS[mode.slice(6)]) {
        const key = mode.slice(6)
        await captureParseScreenshot(`screenshot-light-${key}.png`, PARSE_SHOTS[key])
      } else {
        await captureTo('screenshot-light.png')
      }
    } else if (mode === 'detail') {
      await mainWindow.webContents.executeJavaScript(
        `document.querySelector('.task-title')?.click()`
      )
      await new Promise((resolve) => setTimeout(resolve, 700))
      await captureTo('screenshot-detail.png')
    } else if (mode === 'palette') {
      await mainWindow.webContents.executeJavaScript(
        `document.querySelector('.search-trigger')?.click()`
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
      await mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.command-input');
        if (!input) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(shotEn() ? 'task' : '任务')});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await captureTo('screenshot-palette.png')
    } else if (mode === 'projects') {
      await mainWindow.webContents.executeJavaScript(
        `document.querySelector('.project-add')?.click()`
      )
      await new Promise((resolve) => setTimeout(resolve, 400))
      await captureTo('screenshot-projects.png')
    } else if (mode === 'reminder') {
      await captureReminderScreenshot('screenshot-reminder.png')
    } else if (mode === 'reminder-detail') {
      await captureReminderDetailScreenshot('screenshot-reminder-detail.png')
    } else if (SETTINGS_SHOTS[mode]) {
      await captureSettingsScreenshot(`screenshot-${mode}.png`, SETTINGS_SHOTS[mode])
    } else if (mode === 'sidebar-collapsed') {
      await captureSidebarCollapsedScreenshot('screenshot-sidebar-collapsed.png')
    } else if (mode === 'hotkey') {
      await captureHotkeyScreenshot('screenshot-hotkey.png')
    } else if (mode === 'theme-menu') {
      await captureThemeMenuScreenshot('screenshot-theme-menu.png')
    } else if (mode === 'palette-theme') {
      await captureThemePaletteScreenshot('screenshot-palette-theme.png')
    } else if (mode === 'toast') {
      await captureToastScreenshot('screenshot-toast.png')
    } else if (mode === 'recurrence') {
      await captureRecurrenceScreenshot('screenshot-recurrence.png')
    } else if (mode === 'due-picker') {
      await captureDuePickerScreenshot('screenshot-due-picker.png', false)
    } else if (mode === 'due-clear') {
      await captureDuePickerScreenshot('screenshot-due-clear.png', true)
    } else if (mode === 'trash') {
      await captureTrashScreenshot('screenshot-trash.png', false)
    } else if (mode === 'trash-confirm') {
      await captureTrashScreenshot('screenshot-trash-confirm.png', true)
    } else if (PARSE_SHOTS[mode]) {
      await captureParseScreenshot(`screenshot-${mode}.png`, PARSE_SHOTS[mode])
    } else if (mode === 'calendar') {
      await captureCalendarScreenshot('screenshot-calendar.png')
    } else if (mode.startsWith('calendar-')) {
      const submode = mode.slice(9)
      if (submode === 'display') {
        // 信息层展示：经真实 UI 打开显示设置弹层，点亮农历/节假日/周数三个
        // 开关，翻到十月看节假日休/班角标，外点收起弹层后截图。
        const { ids } = await seedCalendarTasks()
        const wc = harnessContext().mainWindow?.webContents
        await wc?.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const trigger = document.querySelector('[data-calendar-display]');
          if (!trigger) return;
          trigger.click();
          await sleep(250);
          const switches = [...document.querySelectorAll('.calendar-display [role="switch"]')];
          for (const sw of switches) {
            if (sw.getAttribute('aria-checked') !== 'true') sw.click();
            await sleep(150);
          }
          // Esc 发到弹层内部元素（React 合成事件靠冒泡到根监听收弹层）。
          const panel = document.querySelector('.calendar-display');
          panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(200);
          // 翻回上个月（11 月 → 10 月：国庆 + 休/班角标）。
          document.querySelector('.calendar-nav[aria-label="上个月"]')?.click();
          await sleep(450);
          await sleep(450);
        })()`)
        await captureTo(`screenshot-${mode}.png`)
        if (wc) await cleanupCalendarSeeds(ids)
      } else if (['week', 'multiweek', 'day', 'multiday', 'list', 'board'].includes(submode)) {
        await captureCalendarModeScreenshot(submode, `screenshot-${mode}.png`)
      } else {
        await captureCalendarScreenshot('screenshot-calendar.png')
      }
    } else if (mode === 'matrix' || mode === 'stats') {
      // 四象限与统计直接用首启示例数据：八条教学示例恰好落满四个象限，
      // 统计有今日完成与项目分布，不需要额外种子。
      const labels = mode === 'matrix' ? ['四象限', 'Matrix'] : ['统计', 'Statistics']
      await mainWindow.webContents.executeJavaScript(
        `${findByText('.nav-item', labels)}?.click()`
      )
      await new Promise((resolve) => setTimeout(resolve, 700))
      await captureTo(`screenshot-${mode}.png`)
    } else if (mode === 'narrow') {
      mainWindow.setSize(1100, 800)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await mainWindow.webContents.executeJavaScript(
        `document.querySelector('.task-title')?.click()`
      )
      await new Promise((resolve) => setTimeout(resolve, 700))
      await captureTo('screenshot-narrow.png')
    } else {
      await captureTo('screenshot.png')
    }
  } catch (error) {
    console.error('Failed to capture demo screenshot:', error)
  } finally {
    app.quit()
  }
}

export async function captureAndQuit(): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) {
    app.quit()
    return
  }

  try {
    const image = await mainWindow.webContents.capturePage()
    await writeFile(join(process.cwd(), 'screenshot.png'), image.toPNG())
  } catch (error) {
    console.error('Failed to capture screenshot:', error)
  } finally {
    app.quit()
  }
}
