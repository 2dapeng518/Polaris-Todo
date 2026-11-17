// 截图 harness：POLARIS_SHOT / POLARIS_SCREENSHOT 的全部截图助手。
// 只在 POLARIS_HARNESS=1 构建里存在（define + DCE 剥离，见 electron.vite.config.ts），
// 生产包不含本目录任何代码。窗口句柄经 HarnessContext 注入，不反向引用 index.ts。

import { app } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createSplashWindow } from '../splash'
import { THEME_ORDER } from '../../shared/themes'
import { checkRemindersNow, dismissReminder, getReminderWindow } from '../reminders'
import { harnessContext } from './context'

async function captureTo(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return
  const image = await mainWindow.webContents.capturePage()
  await writeFile(join(process.cwd(), filename), image.toPNG())
}

async function captureSettingsScreenshot(filename: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) return

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.settings-item')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 700))
  await captureTo(filename)
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('.detail-close')?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 200))
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
    setter.call(input, '主题');
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
    `[...document.querySelectorAll('.detail-row')].find((el) => el.textContent.includes('重复'))?.click()`
  )
  await new Promise((resolve) => setTimeout(resolve, 350))
  await mainWindow.webContents.executeJavaScript(
    `(() => { const chip = [...document.querySelectorAll('.detail-chip')].find((el) => el.textContent === '每周'); if (chip) { chip.focus(); chip.click(); } })()`
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
  await captureTo(filename)
  await mainWindow.webContents.executeJavaScript(
    `[...document.querySelectorAll('.detail-chip')].find((el) => el.textContent === '不重复')?.click()`
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
    `[...document.querySelectorAll('.detail-row')].find((el) => el.textContent.includes('提醒'))?.click()`
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
    const personal = projects.find((p) => p.name === '个人');
    const due = new Date();
    due.setHours(23, 59, 0, 0);
    const seeds = [
      { title: '归档旧版设计稿', projectId: polaris ? polaris.id : null },
      { title: '取消周末的聚餐', projectId: personal ? personal.id : null }
    ];
    const created = [];
    for (const seed of seeds) {
      const task = await window.polaris.tasks.create({ title: seed.title, dueAt: due.toISOString(), projectId: seed.projectId });
      await window.polaris.tasks.remove(task.id);
      created.push(task.id);
    }
    window.dispatchEvent(new Event('focus'));
    await sleep(400);
    [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站'))?.click();
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
    [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天'))?.click();
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
      const rows = [...document.querySelectorAll('.detail-row')];
      const repeat = rows.find((el) => el.textContent.includes('重复'));
      repeat?.click();
      await new Promise((r) => setTimeout(r, 300));
      [...document.querySelectorAll('.detail-chip')].find((el) => el.textContent.includes('每天'))?.click();
      await new Promise((r) => setTimeout(r, 300));
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  await mainWindow?.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll('.detail-row')].find((el) => el.textContent.includes('截止'))?.click();
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
  const { mainWindow } = harnessContext()
  const wc = mainWindow?.webContents
  if (!wc) return
  const ids = await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const projects = await window.polaris.projects.list();
    const polaris = projects.find((p) => p.name === 'Polaris');
    const personal = projects.find((p) => p.name === '个人');
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const at = (day, hour) => new Date(y, m, day, hour, 0, 0, 0).toISOString();
    const seeds = [
      { title: '整理竞品调研笔记', dueAt: at(3, 10), projectId: polaris ? polaris.id : null, priority: 1 },
      { title: '提交报销单', dueAt: at(8, 17), projectId: personal ? personal.id : null, priority: 2 },
      { title: '设计评审会', dueAt: at(12, 14), projectId: polaris ? polaris.id : null, priority: 3 },
      { title: '给绿植浇水', dueAt: at(15, 9), projectId: personal ? personal.id : null, priority: 0 },
      { title: '发布补丁版本', dueAt: at(19, 20), projectId: polaris ? polaris.id : null, priority: 3 },
      { title: '周末采购清单', dueAt: at(22, 11), projectId: personal ? personal.id : null, priority: 1 },
      { title: '读完《设计中的设计》', dueAt: at(26, 21), projectId: personal ? personal.id : null, priority: 0 },
      { title: '月度回顾', dueAt: at(28, 16), projectId: polaris ? polaris.id : null, priority: 2 }
    ];
    const created = [];
    for (const seed of seeds) {
      const task = await window.polaris.tasks.create(seed);
      created.push(task.id);
    }
    await window.polaris.tasks.toggle(created[3], true);
    window.dispatchEvent(new Event('focus'));
    await sleep(400);
    [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('日历'))?.click();
    for (let i = 0; i < 40 && !document.querySelector('.calendar-grid, [role="gridcell"]'); i++) await sleep(50);
    await sleep(450);
    return created;
  })()`)
  await captureTo(filename)
  await wc.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const id of ${JSON.stringify(ids)}) await window.polaris.tasks.deleteForever(id);
    window.dispatchEvent(new Event('focus'));
    await sleep(300);
    [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天'))?.click();
    await sleep(300);
  })()`)
}

export async function captureDemo(mode: string): Promise<void> {
  const { mainWindow } = harnessContext()
  if (!mainWindow) {
    app.quit()
    return
  }

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
      await captureSettingsScreenshot('screenshot-theme-picker.png')
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
          setter.call(input, '任务');
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
      } else if (mode === 'light-settings') {
        await captureSettingsScreenshot('screenshot-light-settings.png')
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
        setter.call(input, '任务');
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
    } else if (mode === 'settings') {
      await captureSettingsScreenshot('screenshot-settings.png')
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
    } else if (mode === 'matrix' || mode === 'stats') {
      // 四象限与统计直接用首启示例数据：六条任务恰好落满四个象限，
      // 统计有今日完成与项目分布，不需要额外种子。
      const label = mode === 'matrix' ? '四象限' : '统计'
      await mainWindow.webContents.executeJavaScript(
        `[...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes(${JSON.stringify(label)}))?.click()`
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
