import { app, BrowserWindow, ipcMain, nativeImage, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { getAutoStartState, setAutoStartState } from './autostart'
import { initDatabase, purgeExpiredDeleted } from './db'
import { registerIpc, registerTaskCreate } from './ipc'
import { getCurrentTheme, initAppTheme, setCurrentTheme, themeBackgroundColor } from './theme'
import { createSplashWindow, hasSplashWindow, openSplashWindow, revealMainWindow } from './splash'
import { isAppTheme, THEME_ORDER, THEME_SYMBOL_COLOR, themeFamily } from '../shared/themes'
import {
  checkRemindersNow,
  dismissReminder,
  getReminderWindow,
  startReminderScheduler
} from './reminders'
import { createTray } from './tray'
import { TRAY_ICON_DATA_URL } from './tray-icon'
import { dismissKeys, formatParsedDue, parseQuickAdd, pruneDismissed } from '../shared/quickAddParse'
import { isPurgeable } from '../shared/retention'
import { nextMonthlyClamped } from '../shared/recurrence'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

const startHidden =
  process.argv.includes('--hidden') &&
  !process.env['POLARIS_SMOKE'] &&
  !process.env['POLARIS_SHOT'] &&
  !process.env['POLARIS_SCREENSHOT']

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    icon: nativeImage.createFromDataURL(TRAY_ICON_DATA_URL),
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: themeBackgroundColor(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: THEME_SYMBOL_COLOR[themeFamily(getCurrentTheme())],
      height: 48
    },
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (hasSplashWindow()) {
      if (mainWindow) revealMainWindow(mainWindow)
      return
    }
    if (!startHidden) mainWindow?.show()
  })

  // 主帧真正加载失败时也要收起启动页，把主窗口（哪怕是错误页）交给用户，
  // 不能让人永远挡在启动页后面。-3 (ABORTED) 是快速重载的正常副产物，忽略。
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && hasSplashWindow() && mainWindow) {
      revealMainWindow(mainWindow)
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (process.env['POLARIS_SCREENSHOT']) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void captureAndQuit()
      }, 1800)
    })
  }

  if (process.env['POLARIS_SMOKE']) {
    mainWindow.webContents.once('did-finish-load', () => {
      void runSmokeTest()
    })
  }

  const shot = process.env['POLARIS_SHOT']
  if (shot) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void captureDemo(shot)
      }, 1400)
    })
  }
}

async function captureTo(filename: string): Promise<void> {
  if (!mainWindow) return
  const image = await mainWindow.webContents.capturePage()
  await writeFile(join(process.cwd(), filename), image.toPNG())
}

async function captureSettingsScreenshot(filename: string): Promise<void> {
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

async function captureDemo(mode: string): Promise<void> {
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

// Pure-function half of the quick-add checks. Expectations are written as
// literals, never recomputed through the parser — that would be testing the
// implementation against itself.
function runParseAssertions(): { grammar: boolean; invariants: boolean; format: boolean } {
  const now = new Date(2026, 10, 12, 10, 30, 0)
  const projects = [
    { id: 'p1', name: '工作' },
    { id: 'p2', name: '生活' },
    { id: 'p3', name: '工作项目' },
    { id: 'p4', name: 'Side Project' },
    { id: 'p5', name: 'Polaris' }
  ]
  const ctx = { now, projects, dismissed: new Map<string, number>() }
  const local = (value: string | null): string | null => {
    if (!value) return null
    const d = new Date(value)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // [input, expectedTitle, expectedLocalDue, expectedProjectId]
  const table: Array<[string, string, string | null, string | null]> = [
    ['下周三下午3点交季度报告 #工作', '交季度报告', '2026-11-18 15:00', 'p1'],
    ['明天交周报', '交周报', '2026-11-13 23:59', null],
    ['后天上午10点半开评审会', '开评审会', '2026-11-14 10:30', null],
    ['交报告，明天', '交报告', '2026-11-13 23:59', null],
    ['明天前给我', '给我', '2026-11-13 23:59', null],
    ['今天之内交报告', '交报告', '2026-11-12 23:59', null],
    ['今天的会议材料', '今天的会议材料', null, null],
    ['今晚8点看电影', '看电影', '2026-11-12 20:00', null],
    ['明早7点跑步', '跑步', '2026-11-13 07:00', null],
    ['明早开会', '开会', '2026-11-13 07:00', null],
    ['明晚12点睡', '睡', '2026-11-14 00:00', null],
    ['今晚24点交报告', '交报告', '2026-11-13 00:00', null],
    ['明早期青花瓷鉴定', '明早期青花瓷鉴定', null, null],
    ['周五交周报', '交周报', '2026-11-13 23:59', null],
    ['本周五开会', '开会', '2026-11-13 23:59', null],
    ['本周三开会', '本周三开会', null, null],
    ['下下周一开会', '开会', '2026-11-23 23:59', null],
    ['星期天买菜', '买菜', '2026-11-15 23:59', null],
    ['周天买菜', '买菜', '2026-11-15 23:59', null],
    ['礼拜天买菜', '买菜', '2026-11-15 23:59', null],
    ['下礼拜天体检', '体检', '2026-11-22 23:59', null],
    ['周3体检', '体检', '2026-11-18 23:59', null],
    ['下个星期三评审', '评审', '2026-11-18 23:59', null],
    ['周六福买对戒', '周六福买对戒', null, null],
    ['周一围新剧追一下', '周一围新剧追一下', null, null],
    ['下周日程安排', '下周日程安排', null, null],
    ['今日志导出', '今日志导出', null, null],
    ['记得下周日程安排', '记得下周日程安排', null, null],
    ['本周三场比赛', '本周三场比赛', null, null],
    ['下周三个人来面试', '下周三个人来面试', null, null],
    ['本周三点半开会', '本周三点半开会', null, null],
    ['下周三点开会', '下周三点开会', null, null],
    ['周一到周五值班', '周一到周五值班', null, null],
    ['3点到5点值班', '3点到5点值班', null, null],
    ['15:00到17:00 评审', '15:00到17:00 评审', null, null],
    ['11月20日交报告', '交报告', '2026-11-20 23:59', null],
    ['十一月二十日聚餐', '聚餐', '2026-11-20 23:59', null],
    ['1月1日复盘', '复盘', '2027-01-01 23:59', null],
    ['2027年1月5日复盘', '复盘', '2027-01-05 23:59', null],
    ['2月29日体检', '体检', '2028-02-29 23:59', null],
    ['2025年10月1日补记', '补记', '2025-10-01 23:59', null],
    ['2月30日开会', '2月30日开会', null, null],
    ['13月1日开会', '13月1日开会', null, null],
    ['2026-11-20 交材料', '交材料', '2026-11-20 23:59', null],
    ['2026-11-20T15:00 发布', '2026-11-20T15:00 发布', null, null],
    ['15号交房租', '15号交房租', null, null],
    ['下午3点开会', '开会', '2026-11-12 15:00', null],
    ['下午三点半取快递', '取快递', '2026-11-12 15:30', null],
    ['十点一刻开会', '开会', '2026-11-13 10:15', null],
    ['3点一刻开会', '开会', '2026-11-12 15:15', null],
    ['两点钟开会', '开会', '2026-11-12 14:00', null],
    ['上午 10点开会', '开会', '2026-11-13 10:00', null],
    ['明天上午12点开会', '开会', '2026-11-13 12:00', null],
    ['早上12点开会', '早上12点开会', null, null],
    ['3点开会', '开会', '2026-11-12 15:00', null],
    ['7点起床', '起床', '2026-11-13 07:00', null],
    ['三点开会', '三点开会', null, null],
    ['改一点样式', '改一点样式', null, null],
    ['3点注意事项', '3点注意事项', null, null],
    ['明天上午13点开会', '上午13点开会', '2026-11-13 23:59', null],
    ['9点60分', '9点60分', null, null],
    ['3点15分钟', '3点15分钟', null, null],
    ['5点半价门票', '5点半价门票', null, null],
    ['10点差5分开会', '10点差5分开会', null, null],
    ['沪指涨1.5点', '沪指涨1.5点', null, null],
    ['上午10点光景', '上午10点光景', null, null],
    ['15:00 站会', '站会', '2026-11-12 15:00', null],
    ['站会：15:00', '站会', '2026-11-12 15:00', null],
    ['站会 9:00', '站会 9:00', null, null],
    ['版本号 1:20', '版本号 1:20', null, null],
    ['晚上买菜', '买菜', '2026-11-12 20:00', null],
    ['买牛奶 明天下午', '买牛奶', '2026-11-13 15:00', null],
    ['下午茶', '下午茶', null, null],
    ['下午的报告', '下午的报告', null, null],
    ['交报告 #工作', '交报告', null, 'p1'],
    ['交报告#工作', '交报告', null, 'p1'],
    ['＃工作 下周三下午3点交季度报告', '交季度报告', '2026-11-18 15:00', 'p1'],
    ['#工作项目 排期', '排期', null, 'p3'],
    ['#Side Project 写文档', '写文档', null, 'p4'],
    ['学习 C# #工作', '学习 C#', null, 'p1'],
    ['买菜😀#工作', '买菜😀', null, 'p1'],
    ['#工作#生活 买东西', '#生活 买东西', null, 'p1'],
    ['C#开发教程', 'C#开发教程', null, null],
    ['issue#123', 'issue#123', null, null],
    ['#123 崩溃', '#123 崩溃', null, null],
    ['#不存在 做事', '#不存在 做事', null, null],
    ['交报告 #工作明天', '交报告 #工作明天', null, null],
    ['写周报 !高 #工作', '写周报', null, 'p1'],
    ['修 bug ！中', '修 bug', null, null],
    ['太棒了!高兴', '太棒了!高兴', null, null],
    ['明天 !9', '!9', '2026-11-13 23:59', null],
    ['一周三次的健身计划', '一周三次的健身计划', null, null],
    ['每周三例会', '每周三例会', null, null],
    ['例会 每周三', '例会 每周三', null, null],
    ['下周三个方案对比', '下周三个方案对比', null, null],
    ['补充第3点', '补充第3点', null, null],
    ['报销 上周三', '报销 上周三', null, null],
    ['3天后交方案', '3天后交方案', null, null],
    ['周末大扫除', '周末大扫除', null, null],
    ['tomorrow 3pm', 'tomorrow 3pm', null, null],
    ['把下周三的报告提前', '把下周三的报告提前', null, null],
    ['梳理本周的任务清单', '梳理本周的任务清单', null, null],
    ['预约周五的牙医', '预约周五的牙医', null, null],
    ['周五那份稿要改', '周五那份稿要改', null, null],
    ['记得下周三交报告', '记得交报告', '2026-11-18 23:59', null],
    ['明天交报告 周五', '交报告 周五', '2026-11-13 23:59', null],
    ['明天 交报告 下午3点', '交报告', '2026-11-13 15:00', null],
    ['晚上 明天3点开会', '晚上 开会', '2026-11-13 15:00', null],
    ['交报告。明天。', '交报告', '2026-11-13 23:59', null],
    ['明天下午3点', '', '2026-11-13 15:00', null],
    ['#工作', '', null, 'p1'],
    ['买牛奶', '买牛奶', null, null],
    ['冒烟测试 1763000000000', '冒烟测试 1763000000000', null, null],
    ['重复提示 1763000000000', '重复提示 1763000000000', null, null],
    ['重复冒烟 1763000000000', '重复冒烟 1763000000000', null, null]
  ]

  let grammar = true
  for (const [input, wantTitle, wantDue, wantProject] of table) {
    const result = parseQuickAdd(input, ctx)
    const gotDue = local(result.dueAt)
    if (
      result.title !== wantTitle ||
      gotDue !== wantDue ||
      result.projectId !== wantProject
    ) {
      grammar = false
      console.error(
        'PARSE_CASE_FAIL',
        JSON.stringify({ input, got: [result.title, gotDue, result.projectId], want: [wantTitle, wantDue, wantProject] })
      )
    }
  }

  // Dismissal must reach markers too, and must survive the punctuation merge.
  const dismissCtx = (keys: string[]): {
    now: Date
    projects: typeof projects
    dismissed: Map<string, number>
  } => ({ now, projects, dismissed: new Map(keys.map((key) => [key, 1])) })

  const projDismissed = parseQuickAdd('交报告 下周三 #工作', dismissCtx(['project|#工作']))
  if (
    projDismissed.projectId !== null ||
    projDismissed.title !== '交报告 #工作' ||
    local(projDismissed.dueAt) !== '2026-11-18 23:59'
  ) {
    grammar = false
    console.error('PARSE_DISMISS_PROJECT_FAIL', JSON.stringify(projDismissed.title))
  }

  const allDismissed = parseQuickAdd(
    '下周三下午3点交季度报告 #工作',
    dismissCtx(['weekday|下周三', 'clockCn|下午3点', 'project|#工作'])
  )
  if (
    allDismissed.dueAt !== null ||
    allDismissed.projectId !== null ||
    allDismissed.title !== '下周三下午3点交季度报告 #工作'
  ) {
    grammar = false
    console.error('PARSE_DISMISS_ALL_FAIL', JSON.stringify(allDismissed.title))
  }

  const punctDismissed = parseQuickAdd('#工作，买菜', dismissCtx(['project|#工作']))
  if (punctDismissed.projectId !== null || punctDismissed.title !== '#工作，买菜') {
    grammar = false
    console.error('PARSE_DISMISS_PUNCT_FAIL', JSON.stringify(punctDismissed.title))
  }

  // Priority must reach the field, not silently default to 0.
  const priorityCases: Array<[string, number]> = [
    ['写周报 !高', 3],
    ['写周报 !中', 2],
    ['写周报 !低', 1],
    ['写周报 !3', 3],
    ['写周报 !1', 1],
    ['写周报', 0],
    ['太棒了!高兴', 0]
  ]
  for (const [input, want] of priorityCases) {
    const got = parseQuickAdd(input, ctx).priority
    if (got !== want) {
      grammar = false
      console.error('PARSE_PRIORITY_FAIL', JSON.stringify({ input, got, want }))
    }
  }

  // A duplicate project whose name is itself a date word must not be eaten.
  const dupProjects = [...projects, { id: 'd1', name: '明天' }, { id: 'd2', name: '明天' }]
  const dupResult = parseQuickAdd('交报告 #明天', {
    now,
    projects: dupProjects,
    dismissed: new Map<string, number>()
  })
  if (
    dupResult.dueAt !== null ||
    dupResult.title !== '交报告 #明天' ||
    dupResult.projectId !== null ||
    dupResult.notices.length !== 1
  ) {
    grammar = false
    console.error('PARSE_DUP_DATE_FAIL', JSON.stringify({ title: dupResult.title, due: dupResult.dueAt }))
  }

  // A stored name containing full-width characters must still match.
  const wideProjects = [
    { id: 'w1', name: '项目１' },
    { id: 'w2', name: '第２组' }
  ]
  const wideCases: Array<[string, string]> = [
    ['排期 #项目1', 'w1'],
    ['排期 #项目１', 'w1'],
    ['开会 #第2组', 'w2']
  ]
  for (const [input, want] of wideCases) {
    const got = parseQuickAdd(input, { now, projects: wideProjects, dismissed: new Map<string, number>() })
    if (got.projectId !== want) {
      grammar = false
      console.error('PARSE_WIDE_NAME_FAIL', JSON.stringify({ input, got: got.projectId, want }))
    }
  }

  // Suppression tracks recognition, not raw text: an occurrence the guards
  // rejected must not inflate the count and later release the dismissal.
  const guarded = parseQuickAdd('明天交报告 明天的会议材料', ctx)
  if ((guarded.candidateCounts.get('relative|明天') ?? 0) !== 1) {
    grammar = false
    console.error('PARSE_CANDIDATE_COUNT_FAIL', JSON.stringify([...guarded.candidateCounts]))
  }
  const held = dismissKeys(['relative|明天'], new Map<string, number>(), guarded.candidateCounts)
  const afterEdit = pruneDismissed('明天交报告 的会议材料', held)
  const stillHeld = parseQuickAdd('明天交报告 的会议材料', { now, projects, dismissed: afterEdit })
  if (!afterEdit.has('relative|明天') || stillHeld.dueAt !== null) {
    grammar = false
    console.error('PARSE_RESURRECT_FAIL', JSON.stringify(stillHeld.dueAt))
  }

  // Two genuinely recognizable occurrences still release when one is deleted.
  const twice = parseQuickAdd('明天交报告 明天', ctx)
  const heldTwice = dismissKeys(['relative|明天'], new Map<string, number>(), twice.candidateCounts)
  if (heldTwice.get('relative|明天') !== 2 || pruneDismissed('交报告 明天', heldTwice).size !== 0) {
    grammar = false
    console.error('PARSE_RELEASE_FAIL', JSON.stringify([...heldTwice]))
  }

  // Deterministic fuzz: the title must always be exactly the raw string minus
  // the token spans, and spans must stay ordered, disjoint and in range.
  const fragments = [
    '明天', '下周三', '下午3点', '15:00', '11月20日', '#工作', '!高', '交报告',
    '买牛奶', '。', '，', ' ', '本周三', '晚上', '3点15', '每周三', '第3点',
    '2月30日', '＃生活', '沪指涨1.5点', '开会', '😀', '上午10点光景'
  ]
  let seed = 20261112
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  let invariants = true
  for (let i = 0; i < 2000; i += 1) {
    let input = ''
    const parts = 1 + rand(6)
    for (let j = 0; j < parts; j += 1) input += fragments[rand(fragments.length)]
    const result = parseQuickAdd(input, ctx)
    let rebuilt = ''
    let cursor = 0
    let prevEnd = -1
    for (const token of result.tokens) {
      if (
        token.start < prevEnd ||
        token.start < 0 ||
        token.end > input.length ||
        token.start >= token.end ||
        token.text !== input.slice(token.start, token.end)
      ) {
        invariants = false
      }
      prevEnd = token.end
      rebuilt += input.slice(cursor, token.start)
      cursor = token.end
    }
    rebuilt += input.slice(cursor)
    const want = result.tokens.length ? rebuilt.replace(/\s+/g, ' ').trim() : input.trim()
    if (result.title !== want || result.tokens.length > 4 || result.chips.length > 3) {
      invariants = false
      console.error('PARSE_INVARIANT_FAIL', JSON.stringify({ input, title: result.title, want }))
    }
  }

  // Dismissal state machine under random edits: a cancelled field must stay
  // cancelled while its text is still there, including when punctuation lands
  // next to it or the title grows.
  let dismissSeed = 777
  const dismissRand = (n: number): number => {
    dismissSeed = (dismissSeed * 1103515245 + 12345) % 2147483648
    return dismissSeed % n
  }
  const dismissBases = ['明天交报告', '下周三下午3点开会', '交报告 #工作', '晚上买菜', '11月20日体检']
  const tails = ['x', ' 备注', '。', '，', ' 明天', '']
  for (let i = 0; i < 300; i += 1) {
    const base = dismissBases[dismissRand(dismissBases.length)]
    const first = parseQuickAdd(base, ctx)
    if (!first.chips.length) continue
    const chip = first.chips[dismissRand(first.chips.length)]
    let held = dismissKeys(chip.tokenKeys, new Map<string, number>(), first.candidateCounts)
    let text = base
    for (let step = 0; step < 4; step += 1) {
      text += tails[dismissRand(tails.length)]
      held = pruneDismissed(text, held)
      const after = parseQuickAdd(text, { now, projects, dismissed: held })
      for (const live of after.chips) {
        if (live.tokenKeys.some((key) => chip.tokenKeys.includes(key))) {
          invariants = false
          console.error('PARSE_DISMISS_FUZZ_FAIL', JSON.stringify({ base, text, chip: live.id }))
        }
      }
    }
  }

  // Parsing runs on every keystroke; a long pasted run of date words must not
  // freeze the renderer.
  const longInput = '明天下午3点 '.repeat(400)
  const started = Date.now()
  parseQuickAdd(longInput, ctx)
  const elapsed = Date.now() - started
  if (elapsed > 500) {
    invariants = false
    console.error('PARSE_PERF_FAIL', JSON.stringify({ chars: longInput.length, elapsed }))
  }

  const formatChecks: Array<[string | null, boolean, string]> = [
    [null, true, '无日期'],
    [null, false, '无日期'],
    ['2026-11-18T07:00:00.000Z', true, '11月18日 15:00'],
    ['2025-10-01T15:59:59.000Z', false, '已逾期 · 2025年10月1日 周三'],
    ['2028-02-29T15:59:59.000Z', false, '2028年2月29日 周二']
  ]
  let formatOk = true
  for (const [value, timeExplicit, want] of formatChecks) {
    const got = formatParsedDue(value, timeExplicit, now)
    if (got !== want) {
      formatOk = false
      console.error('PARSE_FORMAT_FAIL', JSON.stringify({ value, got, want }))
    }
  }
  const kept = pruneDismissed('#Polaris 写文档', new Map([['project|#polaris', 1]]))
  if (!kept.has('project|#polaris')) formatOk = false
  const released = pruneDismissed('交报告', new Map([['relative|明天', 1]]))
  if (released.size !== 0) formatOk = false

  return { grammar, invariants, format: formatOk }
}

// 保留期边界用字面量期望钉死：isPurgeable 是自动清理的唯一权威，db 层逐行
// 调用它决定 DELETE。全部用 ISO UTC 瞬间 + epoch 差，不依赖机器时区；边界是
// 「满 30 天即清」（>=）。期望绝不经被测函数自算。
function runRetentionAssertions(): boolean {
  // [deletedAtIso, nowIso, 期望]
  const table: Array<[string | null, string, boolean]> = [
    [null, '2026-11-12T00:00:00.000Z', false],
    // 刚删除（0 天）
    ['2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', false],
    // 29 天：还差一天
    ['2026-10-14T00:00:00.000Z', '2026-11-12T00:00:00.000Z', false],
    // 30 天差 1ms：不清
    ['2026-10-13T00:00:00.001Z', '2026-11-12T00:00:00.000Z', false],
    // 恰好满 30 天：即清（>= 边界）
    ['2026-10-13T00:00:00.000Z', '2026-11-12T00:00:00.000Z', true],
    // 30 天多 1ms：清
    ['2026-10-12T23:59:59.999Z', '2026-11-12T00:00:00.000Z', true],
    // 早已过期
    ['2025-01-01T00:00:00.000Z', '2026-11-12T00:00:00.000Z', true],
    // 未来时间戳：宁可留着，不误删
    ['2026-11-13T00:00:00.000Z', '2026-11-12T00:00:00.000Z', false],
    // 无法解析：一律 false
    ['not-a-date', '2026-11-12T00:00:00.000Z', false],
    ['', '2026-11-12T00:00:00.000Z', false],
    // 第二组时钟：证明 now 是注入的，跨年边界同样按 epoch 差算
    ['2026-12-03T00:00:00.000Z', '2027-01-01T00:00:00.000Z', false],
    ['2026-12-02T00:00:00.000Z', '2027-01-01T00:00:00.000Z', true]
  ]
  let ok = true
  for (const [deletedAt, now, want] of table) {
    const got = isPurgeable(deletedAt, new Date(now))
    if (got !== want) {
      ok = false
      console.error('RETENTION_CASE_FAIL', JSON.stringify({ deletedAt, now, got, want }))
    }
  }
  return ok
}

// 月度钳制用字面量期望钉死：nextMonthlyClamped 把 29–31 日钳到短月最后一天而非跳月，
// 保留时分秒毫秒，候选必须严格晚于 due 与 now。注入 due/now（本地墙钟），期望不经被测函数自算。
function runRecurrenceAssertions(): boolean {
  const at = (y: number, mo: number, d: number, h = 9, mi = 0, s = 0, ms = 0) =>
    new Date(y, mo, d, h, mi, s, ms)
  const key = (d: Date | null) =>
    d
      ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`
      : 'null'
  // [due, now, 期望]
  const table: Array<[Date, Date, string]> = [
    // 31 日 → 平年 2 月钳到 28
    [at(2026, 0, 31), at(2026, 0, 31), '2026-2-28 9:0:0.0'],
    // 30 日 → 2 月同样钳到 28
    [at(2026, 0, 30, 8), at(2026, 0, 30, 8), '2026-2-28 8:0:0.0'],
    // 29 日 → 平年 2 月钳到 28
    [at(2026, 0, 29), at(2026, 0, 29), '2026-2-28 9:0:0.0'],
    // 闰年 2 月：31 日钳到 29
    [at(2028, 0, 31, 10), at(2028, 0, 31, 10), '2028-2-29 10:0:0.0'],
    // 31 日 → 4 月（30 天）钳到 30
    [at(2026, 2, 31), at(2026, 2, 31), '2026-4-30 9:0:0.0'],
    // 31 日 → 8 月（31 天）不钳
    [at(2026, 6, 31), at(2026, 6, 31), '2026-8-31 9:0:0.0'],
    // 跨年：12 月 31 → 次年 1 月 31
    [at(2026, 11, 31, 23, 59), at(2026, 11, 31, 23, 59), '2027-1-31 23:59:0.0'],
    // now 已过 due 落在月中：从 now 所在月取钳制日
    [at(2026, 0, 31), at(2026, 2, 15, 12), '2026-3-31 9:0:0.0'],
    // now 在 2 月且 due 是 31：2 月 28 仍晚于 now → 取 2 月 28
    [at(2026, 0, 31), at(2026, 1, 10, 12), '2026-2-28 9:0:0.0'],
    // 保留时分秒毫秒
    [at(2026, 0, 31, 18, 30, 45, 500), at(2026, 0, 31, 18, 30, 45, 500), '2026-2-28 18:30:45.500']
  ]
  let ok = true
  for (const [due, now, want] of table) {
    const got = key(nextMonthlyClamped(due, now))
    if (got !== want) {
      ok = false
      console.error('RECURRENCE_CASE_FAIL', JSON.stringify({ due: key(due), now: key(now), got, want }))
    }
  }
  return ok
}

// 等一个可观测条件，而不是赌固定延时。超时返回 false 让调用方计入断言，
// 不抛错 —— 冒烟要跑完并报出全部失败项，而不是在第一个超时处中断。
// 探测本身可能打在正在导航或已销毁的窗口上，那种失败按「还没就绪」处理。
async function waitForCondition(
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
async function settledFrames(contents: WebContents): Promise<void> {
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

// 冒烟专用：整组摘掉 registerIpc 拥有的通道再原样装回。恢复走的是生产同一个
// registerIpc()，校验与行为和正常启动完全一致，不必在测试里复制 zod schema，
// ipc.ts 也不用为测试多导出注册器。removeHandler 对不存在的通道是 no-op；
// 摘与装在同一个主进程 tick 内完成，渲染层的 invoke 插不进中间。
function resetTaskIpc(): void {
  for (const channel of [
    'tasks:list',
    'tasks:create',
    'tasks:update',
    'tasks:toggle',
    'tasks:delete',
    'tasks:restore',
    'tasks:list-deleted',
    'tasks:delete-forever',
    'tasks:empty-trash',
    'projects:list',
    'projects:create'
  ]) {
    ipcMain.removeHandler(channel)
  }
  registerIpc()
}

async function runSmokeTest(): Promise<void> {
  if (!mainWindow) {
    app.exit(1)
    return
  }

  // 等应用真的可交互（快速添加框在、首屏任务已渲染），而不是赌 1200ms 开机够用。
  await waitForCondition(async () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return false
    return Boolean(
      await mainWindow.webContents.executeJavaScript(
        `Boolean(document.querySelector('.quick-add input') && document.querySelector('.task-title'))`
      )
    )
  }, 15000)

  try {
    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (fn, timeout = 6000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const value = fn();
          if (value) return value;
          await sleep(50);
        }
        throw new Error('waitFor timeout');
      };
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };

      await waitFor(() => document.querySelector('.quick-add input'));
      const leftovers = (await window.polaris.tasks.list()).filter((task) =>
        /^(冒烟|重复)/.test(task.title)
      );
      if (leftovers.length) {
        const leftoverTitles = new Set(leftovers.map((task) => task.title));
        for (const task of leftovers) await window.polaris.tasks.remove(task.id);
        window.dispatchEvent(new Event('focus'));
        await waitFor(
          () =>
            ![...document.querySelectorAll('.task-title')].some((el) =>
              leftoverTitles.has(el.textContent?.trim() ?? '')
            ),
          4000
        );
        await sleep(100);
      }
      // 残留清扫升级：tasks.remove 只把行软删进回收站，跨段/跨运行堆积会污染
      // 回收站计数与清空断言，所以冒烟前缀的软删行需要彻底删除。
      const trashedLeftovers = (await window.polaris.tasks.listDeleted()).filter((task) =>
        /^(冒烟|重复)/.test(task.title)
      );
      for (const task of trashedLeftovers) await window.polaris.tasks.deleteForever(task.id);
      if (trashedLeftovers.length) {
        window.dispatchEvent(new Event('focus'));
        await sleep(200);
      }
      const initial = document.querySelectorAll('.task-title').length;
      const title = '冒烟测试 ' + Date.now();
      const quick = document.querySelector('.quick-add input');
      setInput(quick, title);
      await sleep(80);
      quick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitFor(() => [...document.querySelectorAll('.task-title')].some((el) => el.textContent === title));

      const afterAdd = document.querySelectorAll('.task-title').length;
      const findRow = () => [...document.querySelectorAll('.task-item')].find((el) => el.textContent.includes(title));
      const row = findRow();
      row.querySelector('.task-title').click();
      await waitFor(() => document.querySelector('.detail-title'));
      await sleep(150);
      const detailOpened = document.querySelector('.detail-title')?.value === title;
      const notes = document.querySelector('.detail-notes');
      notes.focus();
      const noteSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      noteSetter.call(notes, '冒烟备注');
      notes.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(100);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(700);
      const detailEditSaved = (await window.polaris.tasks.list()).find((task) => task.title === title)?.notes === '冒烟备注';
      const detailClosed = !document.querySelector('.detail-title');

      const rowAgain = findRow();
      rowAgain.querySelector('.task-check').click();
      await sleep(600);
      const doneRows = [...document.querySelectorAll('.task-item')].filter((el) => el.textContent.includes(title));
      const done = doneRows.some((el) => el.classList.contains('done'));
      const persisted = (await window.polaris.tasks.list()).find((task) => task.title === title)?.completed ?? false;

      // 勾选描边的渲染终态。check-draw 靠 fill-mode both 停在 dashoffset 0；
      // 若有人给 path 补上基态 dashoffset 再靠动画归零，reduced motion 下对勾会
      // 完全不可见，而 .done class 与数据库标志仍为真 —— 这条断言拦的就是这种静默回归。
      const doneRow = doneRows.find((el) => el.classList.contains('done'));
      const checkPath = doneRow && doneRow.querySelector('.task-check .lucide path');
      const checkDrawn = Boolean(checkPath) && getComputedStyle(checkPath).strokeDashoffset === '0px';

      document.querySelector('.search-trigger').click();
      await waitFor(() => document.querySelector('.command-input'));
      const commandInput = document.querySelector('.command-input');
      setInput(commandInput, title);
      await sleep(500);
      const commandCount = [...document.querySelectorAll('.command-item')].filter((el) => el.textContent.includes(title)).length;
      commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);

      const initialTheme = document.documentElement.dataset.theme;
      document.querySelector('.theme-toggle').click();
      await sleep(500);
      const toggledTheme = document.documentElement.dataset.theme;
      document.querySelector('.theme-toggle').click();
      await sleep(500);
      const restoredTheme = document.documentElement.dataset.theme;
      const themeToggled = toggledTheme !== initialTheme && restoredTheme === initialTheme;
      // 主题矩阵：逐一切换全部 6 套主题，校验 data-theme、持久化、令牌生效与关键表面可读。
      const themeBgHex = { dark: '#080a0f', light: '#f4f3ef', dusk: '#132644', sand: '#ece0c6', sky: '#dceaf6', green: '#c7edcc' };
      const themePanelHex = { dark: '#0b0e15', light: '#fbfaf7', dusk: '#182c4e', sand: '#faf6ee', sky: '#eef6fc', green: '#eaf7ec' };
      let themeMatrix = typeof window.__polarisSetTheme === 'function';
      for (const id of ['dark', 'light', 'dusk', 'sand', 'sky', 'green']) {
        window.__polarisSetTheme(id);
        await sleep(160);
        const rootStyle = getComputedStyle(document.documentElement);
        const taskEl = document.querySelector('.task-item') || document.body;
        const taskColor = getComputedStyle(taskEl).color;
        themeMatrix = themeMatrix &&
          document.documentElement.dataset.theme === id &&
          localStorage.getItem('polaris-theme') === id &&
          rootStyle.getPropertyValue('--bg').trim() === themeBgHex[id] &&
          rootStyle.getPropertyValue('--panel-bg').trim() === themePanelHex[id] &&
          taskColor !== '' && taskColor !== 'rgba(0, 0, 0, 0)';
      }
      // 对合不变量：每对配对连点两次回到原点（快捷切换不会迷失状态）。
      for (const [a, b] of [['dark', 'light'], ['dusk', 'sand'], ['sky', 'green']]) {
        window.__polarisSetTheme(a);
        await sleep(120);
        document.querySelector('.theme-toggle').click();
        await sleep(160);
        const flip = document.documentElement.dataset.theme;
        document.querySelector('.theme-toggle').click();
        await sleep(160);
        const restore = document.documentElement.dataset.theme;
        themeMatrix = themeMatrix && flip === b && restore === a;
      }
      // 主题菜单：右段箭头展开六选一，够到配对快切永远够不着的另外四套。
      // 先 focus 再 click —— 程序化 click 不移焦点，不先构造真实前置状态，
      // 「焦点回到箭头」那条就是在测假象。
      const menuTrigger = document.querySelector('.theme-menu-trigger');
      menuTrigger.focus();
      menuTrigger.click();
      await waitFor(() => document.querySelector('.theme-menu'));
      await sleep(220);
      const menuIds = [...document.querySelectorAll('[data-theme-menu-item]')].map((el) => el.dataset.themeMenuItem);
      const menuListed = menuIds.length === 6 &&
        ['dark', 'light', 'dusk', 'sand', 'sky', 'green'].every((id, i) => menuIds[i] === id);
      // 打开即聚焦当前主题行。这条断了 Esc 就会打在箭头上而不是菜单里 ——
      // 曾经因为「首帧 visibility:hidden 占位」静默失败过。
      const menuInitialFocus = document.activeElement?.getAttribute('role') === 'menuitemradio' &&
        document.activeElement?.getAttribute('aria-checked') === 'true';
      document.querySelector('[data-theme-menu-item="dusk"]').click();
      await sleep(280);
      const menuPicked = document.documentElement.dataset.theme === 'dusk' &&
        localStorage.getItem('polaris-theme') === 'dusk';
      const menuClosed = !document.querySelector('.theme-menu') &&
        document.querySelector('.theme-menu-trigger').getAttribute('aria-expanded') === 'false';
      const menuFocusReturned = document.activeElement === document.querySelector('.theme-menu-trigger');
      menuTrigger.click();
      await waitFor(() => document.querySelector('.theme-menu'));
      await sleep(220);
      // Esc 派发到真实焦点节点（菜单行），不是 window：菜单在 #root 上
      // stopPropagation，直接打 window 会绕过它，测的就不是同一条路径。
      const preEscActive = document.activeElement?.className || document.activeElement?.tagName;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(280);
      const menuEscaped = !document.querySelector('.theme-menu') &&
        document.activeElement === document.querySelector('.theme-menu-trigger');
      const themeMenuWorks = menuListed && menuInitialFocus && menuPicked && menuClosed && menuFocusReturned && menuEscaped;
      // 渲染层的 console.error 不会回传到冒烟进程的 stdout，失败原因必须随结果返回。
      const themeMenuDetail = { ids: menuIds.join(','), listed: menuListed, initialFocus: menuInitialFocus, picked: menuPicked, closed: menuClosed, focus: menuFocusReturned, esc: menuEscaped, preEscActive };
      // 命令面板六条直达：键盘用户不展开菜单也能任选一套，配对快切够不到的四套在这里。
      document.querySelector('.search-trigger').click();
      await waitFor(() => document.querySelector('.command-input'));
      setInput(document.querySelector('.command-input'), '主题');
      await sleep(400);
      const paletteThemeLabels = [...document.querySelectorAll('.command-item .command-title')]
        .map((el) => el.textContent)
        .filter((text) => text.startsWith('主题：'));
      const paletteThemeListed = paletteThemeLabels.length === 6 &&
        ['夜阑', '昼白', '暮蓝', '暖砂', '天蓝', '护眼绿'].every((name) => paletteThemeLabels.includes('主题：' + name));
      [...document.querySelectorAll('.command-item')]
        .find((el) => el.textContent.includes('主题：暖砂')).click();
      await sleep(300);
      const paletteThemeApplied = document.documentElement.dataset.theme === 'sand' &&
        localStorage.getItem('polaris-theme') === 'sand';
      // AnimatePresence 的退出弹簧会留住节点，等真实卸载而不是加魔法 sleep；
      // 这里用有界轮询而非 waitFor，超时要把 false 记进结果而不是抛断整轮冒烟。
      for (let i = 0; i < 40 && document.querySelector('.command-input'); i++) await sleep(50);
      const paletteThemePicked = paletteThemeApplied && !document.querySelector('.command-input');
      const themePaletteWorks = paletteThemeListed && paletteThemePicked;
      const themePaletteDetail = { labels: paletteThemeLabels.join(','), listed: paletteThemeListed, applied: paletteThemeApplied, closed: !document.querySelector('.command-input') };
      // 恢复初始主题，后续 reminder 像素采样据此选定期望色。
      window.__polarisSetTheme(initialTheme);
      await sleep(200);
      themeMatrix = themeMatrix && document.documentElement.dataset.theme === initialTheme;

      const autoStartBefore = await window.polaris.app.getAutoStart();
      await window.polaris.app.setAutoStart(!autoStartBefore.enabled);
      const autoStartToggled = await window.polaris.app.getAutoStart();
      await window.polaris.app.setAutoStart(autoStartBefore.enabled);
      const autoStartRestored = await window.polaris.app.getAutoStart();
      const autoStartTested =
        !autoStartBefore.supported ||
        (autoStartToggled.enabled === !autoStartBefore.enabled &&
          autoStartRestored.enabled === autoStartBefore.enabled);

      // 主界面页脚的版本号同样不得写死：它和设置面板读同一条通道，
      // 两处都比对主进程的 app.getVersion()，任何一处写死都会在这里露馅。
      await waitFor(() => document.querySelector('.footer-version'));
      const footerVersion = document.querySelector('.footer-version').textContent.trim();

      // 设置面板底部的版本号必须来自主进程，渲染层不得写死。这里只取 DOM 文本，
      // 期望值由主进程侧的 app.getVersion() 提供（见下方 ok 断言）。
      document.querySelector('.settings-item').click();
      await waitFor(() => document.querySelector('.settings-version'));
      const settingsVersion = document.querySelector('.settings-version').textContent.trim();
      // 版本号被页脚预热缓存后，面板一挂载 .settings-version 就在，入场弹簧动画还在飞。
      // AnimatePresence 在入场中途收到退出会把节点留住，于是等不到卸载。
      // 等一个真实 UI 状态（不透明度到 1 = 入场结束），而不是加魔法 sleep。
      await waitFor(() => {
        const panel = document.querySelector('.settings-panel');
        return panel && Number(getComputedStyle(panel).opacity) === 1;
      });
      document.querySelector('.settings-panel .detail-close').click();
      await waitFor(() => !document.querySelector('.settings-panel'));
      await sleep(200);

      // 真实用户手速：面板刚挂载就点关闭，入场动画仍在飞。上面那条等入场结束，
      // 测的是稳定态；这条专测「入场中途退出」，AnimatePresence 若留住节点就会红。
      // 用有界轮询记录布尔值而不是 waitFor 抛错，避免卡住时整套断言一起丢失。
      document.querySelector('.settings-item').click();
      await waitFor(() => document.querySelector('.settings-panel .detail-close'));
      document.querySelector('.settings-panel .detail-close').click();
      let fastClosed = false;
      for (let i = 0; i < 60; i++) {
        if (!document.querySelector('.settings-panel')) { fastClosed = true; break; }
        await sleep(50);
      }
      const settingsFastClose = fastClosed;
      if (!fastClosed) {
        // 兜底关掉，避免遮罩挡住后续断言；失败已由 settingsFastClose 记录。
        document.querySelector('.settings-panel .detail-close')?.click();
        await sleep(400);
      }
      await sleep(200);

      const noticeTitle = '重复提示 ' + Date.now();
      const noticeDue = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await window.polaris.tasks.create({
        title: noticeTitle,
        dueAt: noticeDue,
        recurrenceRule: 'FREQ=DAILY'
      });
      [...document.querySelectorAll('.nav-item')]
        .find((el) => el.textContent.includes('全部任务'))
        .click();
      window.dispatchEvent(new Event('focus'));
      await waitFor(() =>
        [...document.querySelectorAll('.task-item')].some((el) => el.textContent.includes(noticeTitle))
      );
      const noticeRow = [...document.querySelectorAll('.task-item')].find((el) =>
        el.textContent.includes(noticeTitle)
      );
      noticeRow.querySelector('.task-check').click();
      let recurrenceNoticeTested = false;
      try {
        await waitFor(() =>
          document.querySelector('.toast-message')?.textContent?.includes('已创建下一次')
        );
        recurrenceNoticeTested = true;
      } catch {}
      const noticeTasks = (await window.polaris.tasks.list()).filter(
        (task) => task.title === noticeTitle
      );
      for (const task of noticeTasks) await window.polaris.tasks.remove(task.id);
      [...document.querySelectorAll('.nav-item')]
        .find((el) => el.textContent.includes('今天'))
        .click();
      window.dispatchEvent(new Event('focus'));
      await sleep(400);

      findRow().querySelector('.task-delete').click();
      await sleep(700);
      const afterDelete = document.querySelectorAll('.task-title').length;

      const recurrenceTitle = '重复冒烟 ' + Date.now();
      const recurrenceDue = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const recurringTask = await window.polaris.tasks.create({
        title: recurrenceTitle,
        dueAt: recurrenceDue,
        recurrenceRule: 'FREQ=DAILY'
      });
      await window.polaris.tasks.update({ id: recurringTask.id, completed: true });
      const recurrenceTasks = await window.polaris.tasks.list();
      const spawnedRecurrence = recurrenceTasks.find(
        (task) => task.title === recurrenceTitle && !task.completed && task.dueAt !== recurrenceDue
      );
      const recurrenceTested = Boolean(spawnedRecurrence);
      if (spawnedRecurrence) await window.polaris.tasks.remove(spawnedRecurrence.id);
      await window.polaris.tasks.remove(recurringTask.id);

      // ---------- quick-add natural-language parsing ----------
      const quickEl = document.querySelector('.quick-add input');
      const chipCount = () => document.querySelectorAll('.qa-chip').length;
      const noticeCount = () => document.querySelectorAll('.qa-notice').length;
      const enter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const clickWith = (el, detail) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
      const taskCount = async () => (await window.polaris.tasks.list()).length;

      // The renderer only reloads projects on mount and window focus, so creating
      // one through the API alone would leave the store blind to it.
      let smokeProject = (await window.polaris.projects.list()).find((p) => p.name === '冒烟项目');
      if (!smokeProject) {
        smokeProject = await window.polaris.projects.create({ name: '冒烟项目', color: '#5EEAD4' });
      }
      window.dispatchEvent(new Event('focus'));
      await waitFor(() =>
        [...document.querySelectorAll('.project-item .nav-text')].some((el) => el.textContent === '冒烟项目')
      );

      window.__polarisParseNow = '2026-11-12T10:30:00';
      quickEl.blur();
      quickEl.focus();
      const expectedDue = new Date(2026, 10, 18, 15, 0).toISOString();
      const expectedLabel = '11月18日 15:00';
      const parseInput = '冒烟解析 下周三下午3点 #冒烟项目';

      // (a) both chips, no miss notice — a stale store shows up here, not later
      setInput(quickEl, parseInput);
      await waitFor(() => chipCount() === 2);
      await sleep(320);
      const parseChipsShown = chipCount() === 2 && noticeCount() === 0;

      // (b) chip label and the collapsed-height identity
      const dueLabel = document.querySelector('.qa-chip')?.textContent?.trim();
      const shellEl = document.querySelector('.quick-add-shell');
      const stripEl = document.querySelector('.quick-add-parse');
      const parseDueCorrect = dueLabel === expectedLabel;
      // Sub-pixel rects, not offsetHeight: under Windows display scaling each
      // offsetHeight rounds separately and the sum stops matching. The border
      // width is read from computed style for the same reason.
      const shellRect = shellEl.getBoundingClientRect().height;
      const stripRect = stripEl.getBoundingClientRect().height;
      const rowRect = document.querySelector('.quick-add').getBoundingClientRect().height;
      const shellStyle = getComputedStyle(shellEl);
      const borders = parseFloat(shellStyle.borderTopWidth) + parseFloat(shellStyle.borderBottomWidth);
      const parseShellHeight = Math.abs(shellRect - (rowRect + stripRect + borders)) < 0.6;
      const parseShellMetrics = [shellRect, stripRect, rowRect, borders];

      // (c) dismissing a chip must never eat a character
      const valueBeforeUndo = quickEl.value;
      clickWith(document.querySelectorAll('.qa-chip')[1], 1);
      await waitFor(() => chipCount() === 1);
      const parseUndoKeepsText = quickEl.value === valueBeforeUndo;

      // (d) the dismissed project stays in the title
      enter(quickEl);
      await sleep(600);
      const taskD = (await window.polaris.tasks.list()).find((t) => t.title === '冒烟解析 #冒烟项目');
      const parseDismissedSubmit = Boolean(taskD) && taskD.dueAt === expectedDue && taskD.projectId === null;

      // (e) same string, nothing dismissed
      setInput(quickEl, parseInput);
      await waitFor(() => chipCount() === 2);
      await sleep(320);
      enter(quickEl);
      await sleep(600);
      const taskE = (await window.polaris.tasks.list()).find((t) => t.title === '冒烟解析');
      const parseProjectMapped =
        Boolean(taskE) && taskE.dueAt === expectedDue && taskE.projectId === smokeProject.id && taskE.priority === 0;

      // (f) plain text: zero chips, view default intact
      const plainTitle = '冒烟解析 买牛奶 ' + Date.now();
      setInput(quickEl, plainTitle);
      await sleep(320);
      const parseNoRegression =
        chipCount() === 0 && !(document.querySelector('.quick-add-parse') && document.querySelector('.quick-add-note'));
      const parseCollapsedHeight =
        Math.abs(document.querySelector('.quick-add-shell').getBoundingClientRect().height - 56) < 0.6;
      enter(quickEl);
      await waitFor(() => [...document.querySelectorAll('.task-title')].some((el) => el.textContent === plainTitle));
      const taskF = (await window.polaris.tasks.list()).find((t) => t.title === plainTitle);
      const fDue = taskF && taskF.dueAt ? new Date(taskF.dueAt) : null;
      const parseViewDefault = Boolean(fDue) && fDue.getHours() === 23 && fDue.getMinutes() === 59;

      // (g) a date with no task name must block Enter and say so
      const countBeforeG = await taskCount();
      setInput(quickEl, '明天下午3点');
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      enter(quickEl);
      await sleep(400);
      const parseEmptyTitleBlocked =
        (await taskCount()) === countBeforeG &&
        quickEl.value === '明天下午3点' &&
        quickEl.getAttribute('aria-invalid') === 'true';
      const parseEmptyTitleAnnounced = (document.querySelector('#qa-status')?.textContent || '').includes('还差一个任务名');

      // (h) Enter during IME composition must not submit
      setInput(quickEl, '冒烟解析 输入法');
      await sleep(120);
      quickEl.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const countBeforeH = await taskCount();
      const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      Object.defineProperty(composingEnter, 'isComposing', { value: true });
      quickEl.dispatchEvent(composingEnter);
      await sleep(400);
      const parseImeGuarded = (await taskCount()) === countBeforeH;
      quickEl.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      await sleep(150);

      // (i) keyboard dismissal keeps focus inside the strip
      setInput(quickEl, '冒烟解析 下周三 #冒烟项目');
      await waitFor(() => chipCount() === 2);
      await sleep(320);
      const firstChip = document.querySelector('.qa-chip');
      firstChip.focus();
      clickWith(firstChip, 0);
      await waitFor(() => chipCount() === 1);
      await sleep(120);
      const focusStayed = document.activeElement !== quickEl;
      const countBeforeI = await taskCount();
      clickWith(document.activeElement, 0);
      await sleep(400);
      const parseKeyboardUndo = focusStayed && (await taskCount()) === countBeforeI;

      // (j) dismissal survives retyping the same text, and 恢复识别 brings it back
      setInput(quickEl, '冒烟解析 下周三 #冒烟项目');
      await sleep(350);
      const stillDismissed = chipCount() === 0;
      clickWith(document.querySelector('.qa-toggle'), 1);
      await waitFor(() => chipCount() === 2);
      await sleep(320);
      const parseRestoreWorks = stillDismissed && chipCount() === 2;

      // Esc on a chip clears the draft, not the inspector
      const detailBeforeEsc = Boolean(document.querySelector('.detail-title'));
      const escChip = document.querySelector('.qa-chip');
      escChip.focus();
      escChip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(250);
      const parseEscapeInStrip =
        quickEl.value === '' && Boolean(document.querySelector('.detail-title')) === detailBeforeEsc;

      // (k) dismissal is case-insensitive
      setInput(quickEl, '冒烟解析 #Polaris');
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      const valueK = quickEl.value;
      clickWith(document.querySelector('.qa-chip'), 1);
      await sleep(320);
      const parseCaseInsensitiveUndo = chipCount() === 0 && quickEl.value === valueK;

      // (l) priority must reach the database, not just the chip
      setInput(quickEl, '');
      await sleep(150);
      setInput(quickEl, '冒烟解析 优先级 !高');
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      enter(quickEl);
      await sleep(600);
      const taskP = (await window.polaris.tasks.list()).find((t) => t.title === '冒烟解析 优先级');
      const parsePriorityPersisted = Boolean(taskP) && taskP.priority === 3;

      // (m) Esc on a chip with the inspector genuinely open
      document.querySelector('.task-title')?.click();
      await waitFor(() => document.querySelector('.detail-title'));
      await sleep(300);
      setInput(quickEl, '冒烟解析 明天');
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      const escChip2 = document.querySelector('.qa-chip');
      escChip2.focus();
      escChip2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
      const parseEscKeepsInspector =
        quickEl.value === '' && Boolean(document.querySelector('.detail-title'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);

      // (n) keyboard-dismissing the LAST chip must land on 恢复识别, not <body>
      setInput(quickEl, '冒烟解析 明天');
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      const lastChip = document.querySelector('.qa-chip');
      lastChip.focus();
      clickWith(lastChip, 0);
      await sleep(500);
      const parseLastChipFocus =
        document.activeElement !== document.body &&
        document.activeElement?.classList.contains('qa-toggle') === true;

      // (o) the draft and its dismissals survive the completed-view unmount
      setInput(quickEl, '冒烟解析 下周三 #冒烟项目');
      await waitFor(() => chipCount() === 2);
      await sleep(320);
      clickWith(document.querySelectorAll('.qa-chip')[1], 1);
      await waitFor(() => chipCount() === 1);
      const draftValue = quickEl.value;
      [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('已完成')).click();
      await sleep(400);
      [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
      await waitFor(() => document.querySelector('.quick-add input'));
      await sleep(400);
      const quickBack = document.querySelector('.quick-add input');
      const parseDraftSurvives = quickBack.value === draftValue && chipCount() === 1;
      quickBack.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(250);

      // (p) a receipt must name the project when the task lands outside the filter
      [...document.querySelectorAll('.project-item')].find((el) => el.textContent.includes('个人'))?.click();
      await sleep(400);
      const quickFiltered = document.querySelector('.quick-add input');
      setInput(quickFiltered, '冒烟解析 跨项目 #冒烟项目');
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      enter(quickFiltered);
      await sleep(700);
      const filterNote = document.querySelector('.quick-add-note')?.textContent || '';
      const parseReceiptNamesProject = filterNote.includes('在「冒烟项目」');
      [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
      await sleep(400);

      // ---------- in-app date/time picker ----------
      const pickerSeed = new Date();
      pickerSeed.setHours(18, 0, 0, 0);
      const pickerTask = await window.polaris.tasks.create({
        title: '冒烟选择器',
        dueAt: pickerSeed.toISOString()
      });
      window.dispatchEvent(new Event('focus'));
      await waitFor(() =>
        [...document.querySelectorAll('.task-title')].some((el) => el.textContent === '冒烟选择器')
      );
      const openPicker = async () => {
        [...document.querySelectorAll('.task-title')].find((el) => el.textContent === '冒烟选择器').click();
        await waitFor(() => document.querySelector('.detail-title'));
        await sleep(300);
        [...document.querySelectorAll('.detail-row')].find((el) => el.textContent.includes('截止')).click();
        await waitFor(() => document.querySelector('.dp-grid'));
        await sleep(300);
      };
      const escOnce = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
      };
      const storedDue = async () =>
        (await window.polaris.tasks.list()).find((t) => t.id === pickerTask.id)?.dueAt ?? null;
      const hourInput = () => document.querySelectorAll('.dp-part')[0];
      const minuteInput = () => document.querySelectorAll('.dp-part')[1];
      const typeInto = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const keyOn = (el, key, shift) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, shiftKey: Boolean(shift) }));

      await openPicker();
      const pickerNoNativeInput = document.querySelectorAll('input[type="datetime-local"]').length === 0;
      const pickerGridShape =
        document.querySelectorAll('.dp-day').length === 42 &&
        document.querySelectorAll('[role="gridcell"]').length === 42 &&
        document.querySelectorAll('.dp-grid [tabindex="0"]').length === 1 &&
        document.querySelectorAll('[data-popover-focus="true"]').length === 1;
      const popEl = document.querySelector('.detail-popover');
      const pickerFitsBudget =
        popEl.offsetHeight <= 420 &&
        popEl.scrollHeight === popEl.clientHeight &&
        popEl.scrollWidth === popEl.clientWidth;

      const targetCell = [...document.querySelectorAll('.dp-day:not(.is-outside):not(.is-selected)')][5];
      const targetDate = Number(targetCell.textContent);
      targetCell.click();
      await sleep(500);
      const afterPick = new Date(await storedDue());
      const pickerDayCommit =
        afterPick.getDate() === targetDate &&
        afterPick.getHours() === 18 &&
        afterPick.getMinutes() === 0 &&
        afterPick.getSeconds() === 0 &&
        afterPick.getMilliseconds() === 0;
      const pickerValueInvariant =
        Number(hourInput().getAttribute('aria-valuenow')) === afterPick.getHours() &&
        Number(minuteInput().getAttribute('aria-valuenow')) === afterPick.getMinutes();

      hourInput().focus();
      typeInto(hourInput(), '23');
      await sleep(300);
      // Typing a complete hour advances focus, so bring it back before stepping.
      hourInput().focus();
      keyOn(hourInput(), 'ArrowUp');
      await sleep(300);
      const hourWrapped = Number(hourInput().getAttribute('aria-valuenow')) === 0;
      keyOn(hourInput(), 'ArrowDown');
      await sleep(300);
      const hourWrappedBack = Number(hourInput().getAttribute('aria-valuenow')) === 23;
      keyOn(hourInput(), 'ArrowUp');
      await sleep(300);
      minuteInput().focus();
      typeInto(minuteInput(), '59');
      await sleep(300);
      keyOn(minuteInput(), 'ArrowUp');
      await sleep(300);
      const pickerArrowWrap =
        hourWrapped &&
        hourWrappedBack &&
        Number(hourInput().getAttribute('aria-valuenow')) === 0 &&
        Number(minuteInput().getAttribute('aria-valuenow')) === 0;

      hourInput().focus();
      typeInto(hourInput(), '18');
      await sleep(300);
      const advancedToMinute = document.activeElement === minuteInput();
      typeInto(minuteInput(), '30');
      await sleep(400);
      const typedDue = new Date(await storedDue());
      const pickerTypeFlow =
        advancedToMinute && typedDue.getHours() === 18 && typedDue.getMinutes() === 30;

      typeInto(minuteInput(), '50');
      await sleep(350);
      document.querySelectorAll('.dp-step')[1].click();
      await sleep(400);
      const steppedDue = new Date(await storedDue());
      const stepCarry = steppedDue.getHours() === 19 && steppedDue.getMinutes() === 5;
      minuteInput().focus();
      keyOn(minuteInput(), 'ArrowUp', true);
      await sleep(400);
      const shiftDue = new Date(await storedDue());
      const pickerStepSemantics =
        stepCarry && shiftDue.getHours() === 19 && shiftDue.getMinutes() === 20;

      hourInput().focus();
      typeInto(hourInput(), '1');
      await sleep(200);
      // 真实失焦路径：程序化 .click() 不派发 mousedown，永远走不到 onBlur，
      // 所以这里显式失焦一次，把曾经偶发的场景变成必测路径。半截 '1' 必须被丢弃。
      hourInput().blur();
      await sleep(300);
      const blurDue = new Date(await storedDue());
      const pickerBlurKeepsHour = hourInput().value === '19' && blurDue.getHours() === 19;
      document.querySelectorAll('.dp-step')[1].click();
      await sleep(400);
      const syncDue = new Date(await storedDue());
      const pickerTextSync = hourInput().value === '19' && syncDue.getHours() === 19;

      await escOnce();
      const pickerEscRestores =
        !document.querySelector('.detail-popover') && Boolean(document.querySelector('.detail-title'));

      await openPicker();
      // 时钟必须在点击**之前**取：点击与读数之间隔着 sleep 和一次 IPC，用点击之后
      // 的 now 去比会在午夜前后留出约半秒的假失败窗口（23:58:59.7 点击、23:59:00.2
      // 读数，结果 23:59:00 就"落过去"了）。laterToday 自己的 now 一定 ≥ beforeClick，
      // 所以「严格晚于 beforeClick」既是真不变量，又不受这段间隔影响。
      const beforeClick = new Date();
      document.querySelector('.dp-today').click();
      await sleep(500);
      const todayDue = new Date(await storedDue());
      const afterClick = new Date();
      // 「今天」不落过去。只有一天最后一分钟（23:59 本身已过去）才顺延到明天 00:00；
      // 点击窗口两端只要有一端落在那一分钟，就允许跨日。
      const inLastMinute = (d) => d.getHours() === 23 && d.getMinutes() === 59;
      const pickerTodayFuture =
        todayDue.getTime() > beforeClick.getTime() &&
        (todayDue.getDate() === beforeClick.getDate() ||
          inLastMinute(beforeClick) || inLastMinute(afterClick));

      document.querySelector('.detail-popover-clear').click();
      await sleep(500);
      const pickerClearWorks = (await storedDue()) === null;
      await escOnce();
      await escOnce();
      await window.polaris.tasks.remove(pickerTask.id);
      window.dispatchEvent(new Event('focus'));
      await sleep(300);

      // ---------- priority ordering and completion instant ----------
      const dataIds = [];
      const base = Date.now();
      const sameInstant = new Date(base + 2 * 3600000).toISOString();
      const earlierInstant = new Date(base + 3600000).toISOString();
      const mk = async (title, dueAt, priority) => {
        const t = await window.polaris.tasks.create({ title, dueAt, priority });
        dataIds.push(t.id);
        return t;
      };
      const hi = await mk('冒烟数据 高', sameInstant, 3);
      const lo = await mk('冒烟数据 低', sameInstant, 1);
      const none = await mk('冒烟数据 无', sameInstant, 0);
      const early = await mk('冒烟数据 更早', earlierInstant, 0);
      const orderIds = (await window.polaris.tasks.list())
        .filter((t) => dataIds.includes(t.id))
        .map((t) => t.id);
      // Same due instant -> priority decides; an earlier instant still wins
      // regardless of priority, so explicit scheduling is never reordered.
      const priorityOrdering =
        JSON.stringify(orderIds) === JSON.stringify([early.id, hi.id, lo.id, none.id]);
      if (!priorityOrdering) console.error('PRIORITY_ORDER_FAIL', JSON.stringify(orderIds));

      const fresh = await mk('冒烟数据 完成时刻', sameInstant, 0);
      const completedAtNullAtCreate = fresh.completedAt === null;
      const done1 = await window.polaris.tasks.update({ id: fresh.id, completed: true });
      const stampSet = typeof done1.completedAt === 'string' && done1.completedAt.length > 0;
      await sleep(60);
      const edited = await window.polaris.tasks.update({ id: fresh.id, title: '冒烟数据 完成时刻 改' });
      // The whole point of the column: a later edit moves updated_at but must
      // not move completed_at.
      const stampSurvivesEdit =
        edited.completedAt === done1.completedAt && edited.updatedAt !== done1.updatedAt;
      const undone = await window.polaris.tasks.update({ id: fresh.id, completed: false });
      const stampClearedOnUndo = undone.completedAt === null;
      await sleep(60);
      const done2 = await window.polaris.tasks.update({ id: fresh.id, completed: true });
      const stampRenewed =
        typeof done2.completedAt === 'string' && done2.completedAt !== done1.completedAt;
      const completedAtTested =
        completedAtNullAtCreate && stampSet && stampSurvivesEdit && stampClearedOnUndo && stampRenewed;
      if (!completedAtTested) {
        console.error('COMPLETED_AT_FAIL', JSON.stringify({
          completedAtNullAtCreate, stampSet, stampSurvivesEdit, stampClearedOnUndo, stampRenewed
        }));
      }

      // A completed recurring instance keeps its stamp; the spawned one has none.
      const recur = await window.polaris.tasks.create({
        title: '冒烟数据 重复',
        dueAt: sameInstant,
        recurrenceRule: 'FREQ=DAILY'
      });
      dataIds.push(recur.id);
      const recurDone = await window.polaris.tasks.update({ id: recur.id, completed: true });
      const spawnedList = (await window.polaris.tasks.list()).filter(
        (t) => t.title === '冒烟数据 重复' && t.id !== recur.id
      );
      for (const t of spawnedList) dataIds.push(t.id);
      const recurrenceStamps =
        typeof recurDone.completedAt === 'string' &&
        spawnedList.length === 1 &&
        spawnedList[0].completedAt === null &&
        spawnedList[0].completed === false;
      if (!recurrenceStamps) console.error('RECURRENCE_STAMP_FAIL', JSON.stringify(spawnedList.length));

      // ---------- deletedAt field chain ----------
      // 照 completedAt 链：新建为空 → 软删后 listDeleted 读到 ISO 盖章 →
      // 恢复清空。deletedAt 由 DB 写入，渲染层只读。
      const trashSeed = await mk('冒烟数据 回收站', sameInstant, 0);
      const deletedAtNullAtCreate = trashSeed.deletedAt === null;
      await window.polaris.tasks.remove(trashSeed.id);
      const trashedRow = (await window.polaris.tasks.listDeleted()).find((t) => t.id === trashSeed.id);
      const deletedAtStamped =
        Boolean(trashedRow) &&
        typeof trashedRow.deletedAt === 'string' &&
        !Number.isNaN(Date.parse(trashedRow.deletedAt));
      const absentFromLive = !(await window.polaris.tasks.list()).some((t) => t.id === trashSeed.id);
      const restoredRow = await window.polaris.tasks.restore(trashSeed.id);
      const deletedAtCleared = restoredRow.deletedAt === null;
      const backInLive = (await window.polaris.tasks.list()).some((t) => t.id === trashSeed.id);
      const deletedAtTested =
        deletedAtNullAtCreate && deletedAtStamped && absentFromLive && deletedAtCleared && backInLive;
      if (!deletedAtTested) {
        console.error('DELETED_AT_FAIL', JSON.stringify({
          deletedAtNullAtCreate, deletedAtStamped, absentFromLive, deletedAtCleared, backInLive
        }));
      }

      for (const id of dataIds) await window.polaris.tasks.remove(id);
      window.dispatchEvent(new Event('focus'));
      await sleep(300);

      // ---------- focus-ring ghosting ----------
      // A ring in the same colour as the control it surrounds reads as a
      // duplicate of that control. Check every focusable, not a fixed list, so
      // a newly added accent button cannot reintroduce it.
      const rgbOf = (s) => {
        // 模板字符串里括号前的反斜杠必须写两个：单个会被模板 cook 掉，页面端
        // 正则丢失字面括号，m[1] 带上前括号 → Number 出 NaN → sameColor 恒
        // false，整段颜色比对静默失效（曾经就是这样假绿的）。
        const m = /rgba?\\(([^)]+)\\)/.exec(s || '');
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const sameColor = (a, b) =>
        Boolean(a && b) && Math.abs(a.r - b.r) <= 6 && Math.abs(a.g - b.g) <= 6 && Math.abs(a.b - b.b) <= 6;
      const accentRgb = rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || 'rgb(0,0,0)');
      const accentHex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const accentParsed = accentHex.startsWith('#')
        ? { r: parseInt(accentHex.slice(1,3),16), g: parseInt(accentHex.slice(3,5),16), b: parseInt(accentHex.slice(5,7),16), a: 1 }
        : accentRgb;
      const ghostScan = () => {
        const bad = [];
        for (const el of document.querySelectorAll('button, input, textarea, a[href], [tabindex]:not([tabindex="-1"])')) {
          if (el.disabled) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const prev = document.activeElement;
          el.focus();
          if (document.activeElement !== el) continue;
          const cs = getComputedStyle(el);
          const fill = rgbOf(cs.backgroundColor);
          // Checked unfocused too: the bevel is there whether or not the
          // control has focus. A saturated accent fill must stay flat.
          if (fill && sameColor(fill, accentParsed) && /inset/.test(cs.boxShadow)) {
            bad.push(el.className + ' [inset-bevel]');
          }
          if (cs.outlineStyle !== 'none' && el.matches(':focus-visible')) {
            const ring = rgbOf(cs.outlineColor);
            const border = rgbOf(cs.borderTopColor);
            const offset = parseFloat(cs.outlineOffset) || 0;
            if (fill && fill.a > 0.85 && sameColor(ring, fill)) bad.push(el.className + ' [fill]');
            if (offset > 0 && parseFloat(cs.borderTopWidth) > 0 && border && border.a > 0.5 && sameColor(ring, border)) {
              bad.push(el.className + ' [border]');
            }
          }
          if (prev && prev.focus) prev.focus();
        }
        return bad;
      };
      const ghosts = [];
      ghosts.push(...ghostScan());
      document.querySelector('.task-title')?.click();
      await waitFor(() => document.querySelector('.detail-title'));
      await sleep(350);
      ghosts.push(...ghostScan());
      [...document.querySelectorAll('.detail-row')].find((el) => el.textContent.includes('截止'))?.click();
      await waitFor(() => document.querySelector('.dp-grid'));
      await sleep(350);
      ghosts.push(...ghostScan());
      await escOnce();
      await escOnce();
      // 第四态：主题菜单展开。roving 当前行是 tabindex=0，会被 ghostScan 的
      // [tabindex] 选择器扫到，正好覆盖「选中行 + 焦点环」这个最高危组合。
      document.querySelector('.theme-menu-trigger').click();
      await waitFor(() => document.querySelector('.theme-menu'));
      await sleep(350);
      ghosts.push(...ghostScan());
      document.querySelector('.theme-menu-trigger').click();
      await sleep(250);
      const focusRingGhosted = ghosts.length === 0;
      const ghostDetails = [...new Set(ghosts)];
      if (!focusRingGhosted) console.error('FOCUS_RING_GHOST', JSON.stringify(ghostDetails));

      setInput(document.querySelector('.quick-add input'), '');
      await sleep(200);
      delete window.__polarisParseNow;
      quickEl.blur();
      quickEl.focus();
      for (const task of (await window.polaris.tasks.list()).filter((t) => t.title.startsWith('冒烟解析'))) {
        await window.polaris.tasks.remove(task.id);
      }
      window.dispatchEvent(new Event('focus'));
      await sleep(300);

      return {
        parseChipsShown,
        parseDueCorrect,
        parseShellHeight,
        parseShellMetrics,
        parseUndoKeepsText,
        parseDismissedSubmit,
        parseProjectMapped,
        parseNoRegression,
        parseCollapsedHeight,
        parseViewDefault,
        parseEmptyTitleBlocked,
        parseEmptyTitleAnnounced,
        parseImeGuarded,
        parseKeyboardUndo,
        parseRestoreWorks,
        parseEscapeInStrip,
        parseCaseInsensitiveUndo,
        parsePriorityPersisted,
        parseEscKeepsInspector,
        parseLastChipFocus,
        parseDraftSurvives,
        parseReceiptNamesProject,
        pickerNoNativeInput,
        pickerGridShape,
        pickerFitsBudget,
        pickerDayCommit,
        pickerValueInvariant,
        pickerArrowWrap,
        pickerTypeFlow,
        pickerStepSemantics,
        pickerTextSync,
        pickerBlurKeepsHour,
        pickerEscRestores,
        pickerTodayFuture,
        pickerClearWorks,
        focusRingGhosted,
        ghostDetails,
        priorityOrdering,
        completedAtTested,
        recurrenceStamps,
        deletedAtTested,
        brand: document.querySelector('.brand-name')?.textContent?.trim(),
        viewTitle: document.querySelector('.view-title')?.textContent?.trim(),
        initial,
        afterAdd,
        detailOpened,
        detailEditSaved,
        detailClosed,
        done,
        persisted,
        checkDrawn,
        commandCount,
        themeToggled,
        themeMatrix,
        themeMenuWorks,
        themeMenuDetail,
        themePaletteWorks,
        themePaletteDetail,
        autoStartTested,
        settingsVersion,
        settingsFastClose,
        footerVersion,
        recurrenceTested,
        recurrenceNoticeTested,
        afterDelete
      };
    })()`)

    // reduced-motion 终态。平时 smoke 不仿真这个条件，于是「只在 reduce 下暴露」的
    // 动效回归能一路绿灯溜过去（例如给 path 补基态 dashoffset 再加 reduce override）。
    // 这里用 CDP 打开 reduce，并让对勾**重新挂载**——只有重新挂载才走得到 reduce 下的入场路径。
    let checkDrawnReduced = false
    if (mainWindow) {
      const dbg = mainWindow.webContents.debugger
      const attachedHere = !dbg.isAttached()
      if (attachedHere) dbg.attach('1.3')
      try {
        await dbg.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
        })
        checkDrawnReduced = await mainWindow.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const TITLE = '冒烟动效终态';
          // 自建自清：主块结尾已删掉它自己的任务，这里不能依赖别人的状态。
          for (const t of (await window.polaris.tasks.list()).filter((t) => t.title === TITLE)) {
            await window.polaris.tasks.remove(t.id);
          }
          window.dispatchEvent(new Event('focus'));
          await sleep(450);

          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          const input = document.querySelector('.quick-add input');
          if (!input) return false;
          setter.call(input, TITLE);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(400);
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await sleep(900);

          const findRow = () => [...document.querySelectorAll('.task-item')].find((el) => el.textContent.includes(TITLE));
          const row = findRow();
          const box = row && row.querySelector('.task-check');
          if (!box) return false;
          box.click();
          await sleep(700);
          // 重新取行：React 可能已替换节点，旧引用会指向脱离文档的元素
          const fresh = findRow();
          const path = fresh && fresh.querySelector('.task-check .lucide path');
          const drawn = Boolean(path) && getComputedStyle(path).strokeDashoffset === '0px';

          const created = (await window.polaris.tasks.list()).find((t) => t.title === TITLE);
          if (created) await window.polaris.tasks.remove(created.id);
          window.dispatchEvent(new Event('focus'));
          await sleep(450);
          return drawn;
        })()`)
      } finally {
        await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] })
        if (attachedHere) dbg.detach()
      }
    }

    const parseAssertions = runParseAssertions()
    const retentionOk = runRetentionAssertions()
    const recurrenceOk = runRecurrenceAssertions()

    // A real failed submit: drop the IPC channel so invoke() genuinely rejects.
    // contextBridge freezes window.polaris, so it cannot be stubbed in the page.
    let parseErrorReceipt = false
    if (mainWindow) {
      ipcMain.removeHandler('tasks:create')
      try {
        parseErrorReceipt = await mainWindow.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          const input = document.querySelector('.quick-add input');
          setter.call(input, '冒烟解析 失败回执');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(400);
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await sleep(900);
          const note = document.querySelector('.quick-add-note.error');
          const ok = Boolean(note) && note.textContent.includes('添加失败') && input.value === '冒烟解析 失败回执';
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(300);
          return ok;
        })()`)
      } finally {
        registerTaskCreate()
      }
    }

    // 写失败可见性：摘掉真实 IPC 通道制造落库失败，验证错误提示出现、乐观更新
    // 回滚、恢复后重试成功并清除提示。与 parseErrorReceipt 同一手法，期望文案写
    // 字面量。断言只断终态：乐观删除的「任务消失」是瞬态，IPC 拒绝可能在一个
    // 轮询间隔内就完成回滚，等中间态会偶发超时；错误 toast 只能由 catch 产生。
    let storageToggleError = false
    let storageDeleteError = false
    let storageUndoError = false
    let storageLoadError = false
    let storageErrorDismiss = false
    let storageErrorClears = false
    let trashDeleteVisible = false
    let trashRestoreWorks = false
    let trashPurgeWorks = false
    let confirmGhostFree = false
    let trashEmptyWorks = false
    let storagePurgeError = false
    let storagePurgeClears = false
    let storageDualReadError = false
    let storageDualReadCleared = false
    let confirmBlocksN = false
    let confirmBlocksUndo = false
    let confirmDescribedBy = false
    let trashFocusLands = false
    let storageEmptyError = false
    let storageEmptyClears = false
    const pageHelpers = `
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (fn, timeout = 6000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const value = fn();
          if (value) return value;
          await sleep(50);
        }
        return false;
      };
      const findRow = (title) => [...document.querySelectorAll('.task-item')].find((el) => el.textContent.includes(title));
      const errorToast = () => document.querySelector('.toast-error .toast-message');
    `
    if (mainWindow) {
      const wc = mainWindow.webContents
      // 种子任务带今天 23:59 的截止时间：「今天」视图按 isTodayOrOverdue 过滤，
      // 无截止的任务不渲染；跨午夜后它变成逾期，同样可见。
      const seedWriteTask = (title: string) =>
        wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const due = new Date();
          due.setHours(23, 59, 0, 0);
          await window.polaris.tasks.create({ title: ${JSON.stringify(title)}, dueAt: due.toISOString(), projectId: null });
          window.dispatchEvent(new Event('focus'));
          await waitFor(() => findRow(${JSON.stringify(title)}));
          await waitFor(() => !errorToast());
        })()`)

      // 勾选失败：tasks:update 被摘 → 乐观完成回滚 + 错误提示，库里仍未完成。
      await seedWriteTask('冒烟写失败 勾选')
      ipcMain.removeHandler('tasks:update')
      try {
        storageToggleError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const TITLE = '冒烟写失败 勾选';
          findRow(TITLE).querySelector('.task-check').click();
          const toasted = await waitFor(() => errorToast()?.textContent.includes('保存失败，改动未写入本地数据库'));
          await sleep(250);
          const rolledBack = !findRow(TITLE).classList.contains('done');
          const stored = (await window.polaris.tasks.list()).find((t) => t.title === TITLE);
          return Boolean(toasted) && rolledBack && stored?.completed === false;
        })()`)
      } finally {
        resetTaskIpc()
      }
      // 恢复后重试勾选：成功 → 完成落库、错误提示清除，随后清场。
      storageErrorClears = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟写失败 勾选';
        findRow(TITLE).querySelector('.task-check').click();
        const done = await waitFor(() => findRow(TITLE)?.classList.contains('done'));
        const cleared = await waitFor(() => !errorToast());
        const stored = (await window.polaris.tasks.list()).find((t) => t.title === TITLE);
        if (stored) await window.polaris.tasks.remove(stored.id);
        window.dispatchEvent(new Event('focus'));
        await sleep(300);
        return Boolean(done) && Boolean(cleared);
      })()`)

      // 删除失败：tasks:delete 被摘 → 任务回到列表、撤销 toast 不出现、库里未删。
      await seedWriteTask('冒烟写失败 删除')
      ipcMain.removeHandler('tasks:delete')
      try {
        storageDeleteError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const TITLE = '冒烟写失败 删除';
          findRow(TITLE).querySelector('.task-delete').click();
          const toasted = await waitFor(() => errorToast()?.textContent.includes('保存失败，改动未写入本地数据库'));
          const restored = await waitFor(() => findRow(TITLE));
          const stillStored = (await window.polaris.tasks.list()).some((t) => t.title === TITLE);
          // 乐观阶段挂上的撤销 toast 要走完退出动画才离开 DOM，立即断言缺席会和动画赛跑。
          const noUndo = await waitFor(() => !document.querySelector('.toast-action'));
          return Boolean(toasted) && Boolean(restored) && stillStored && Boolean(noUndo);
        })()`)
      } finally {
        resetTaskIpc()
      }

      // 撤销失败：先正常删除让撤销 toast 出现，再摘 tasks:restore。
      await seedWriteTask('冒烟写失败 撤销')
      await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        findRow('冒烟写失败 撤销').querySelector('.task-delete').click();
        await waitFor(() => document.querySelector('.toast-action'));
      })()`)
      ipcMain.removeHandler('tasks:restore')
      try {
        storageUndoError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const TITLE = '冒烟写失败 撤销';
          document.querySelector('.toast-action').click();
          const toasted = await waitFor(() => errorToast()?.textContent.includes('保存失败，改动未写入本地数据库'));
          // 等退出/重入场动画落定：撤销失败后 pendingDeletion 被放回，撤销 toast 应仍在。
          await sleep(350);
          const undoBack = Boolean(document.querySelector('.toast-action'));
          const stillDeleted = !(await window.polaris.tasks.list()).some((t) => t.title === TITLE);
          return Boolean(toasted) && undoBack && stillDeleted;
        })()`)
      } finally {
        resetTaskIpc()
      }
      // 恢复后重试撤销：成功 → 任务回来、错误清除；再删掉清场。
      await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟写失败 撤销';
        document.querySelector('.toast-action')?.click();
        await waitFor(() => findRow(TITLE));
        const stored = (await window.polaris.tasks.list()).find((t) => t.title === TITLE);
        if (stored) await window.polaris.tasks.remove(stored.id);
        window.dispatchEvent(new Event('focus'));
        await sleep(300);
      })()`)

      // 读取失败：tasks:list 被摘，focus 触发 load() → 专属文案；关闭按钮可清除。
      ipcMain.removeHandler('tasks:list')
      try {
        storageLoadError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          return Boolean(await waitFor(() => errorToast()?.textContent.includes('读取本地数据失败')));
        })()`)
      } finally {
        resetTaskIpc()
      }
      storageErrorDismiss = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const button = document.querySelector('.toast-error .toast-dismiss');
        if (!button) return false;
        button.click();
        const gone = await waitFor(() => !document.querySelector('.toast-error'));
        window.dispatchEvent(new Event('focus'));
        await sleep(300);
        return Boolean(gone);
      })()`)

      // ---------- 回收站 UI 链 ----------
      // 先硬删回收站里的冒烟残留：前面各段的 tasks.remove 只软删，不清场的话
      // 计数与清空断言会被残留污染。等计数归零再种任务，避免在途的 loadTrash
      // 响应晚于乐观插入落地、把计数冲掉。
      await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        for (const t of await window.polaris.tasks.listDeleted()) {
          if (/^(冒烟|重复)/.test(t.title)) await window.polaris.tasks.deleteForever(t.id);
        }
        window.dispatchEvent(new Event('focus'));
        const trashNav = () => [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站'));
        await waitFor(() => trashNav()?.querySelector('.nav-count')?.textContent === '0');
      })()`)

      // 删除 → 回收站可见。种子任务带今天 23:59 截止，跨午夜后按逾期仍可见。
      await seedWriteTask('冒烟回收站 主链')
      trashDeleteVisible = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟回收站 主链';
        const trashNav = () => [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站'));
        const trashCount = () => trashNav()?.querySelector('.nav-count')?.textContent;
        await waitFor(() => trashCount() === '0');
        findRow(TITLE).querySelector('.task-delete').click();
        const gone = await waitFor(() => !findRow(TITLE));
        // D7：乐观软删同步插入回收站，侧栏计数立刻涨——此刻还没跑 loadTrash，
        // 计数为 0 即双向同步断了。
        const countAfterDelete = trashCount();
        trashNav().click();
        window.dispatchEvent(new Event('focus'));
        const shown = await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        await sleep(350);
        const row = [...document.querySelectorAll('.trash-item')].find((el) => el.textContent.includes(TITLE));
        const stored = (await window.polaris.tasks.listDeleted()).find((t) => t.title === TITLE);
        const liveAbsent = !(await window.polaris.tasks.list()).some((t) => t.title === TITLE);
        return Boolean(gone) && countAfterDelete === '1' && Boolean(shown) && liveAbsent &&
          document.querySelector('.view-title')?.textContent === '回收站' &&
          document.querySelector('.view-eyebrow')?.textContent === '删除的任务保留 30 天' &&
          Boolean(row) && !row.querySelector('.task-check') && !row.querySelector('.task-open') &&
          row.textContent.includes('删除于') && row.textContent.includes('30 天后清除') &&
          [...document.querySelectorAll('.section-label')].some((el) => el.textContent.includes('已删除')) &&
          !document.querySelector('.quick-add input') &&
          Boolean(document.querySelector('.trash-empty-trigger')) &&
          !document.querySelector('.search-trigger') && !document.querySelector('.progress-ring') &&
          Boolean(stored) && typeof stored.deletedAt === 'string';
      })()`)

      // 恢复 → 回收站缺席、主列表可见；成功静默无 toast，撤销槽同步清掉。
      trashRestoreWorks = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟回收站 主链';
        const trashNav = () => [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站'));
        const row = [...document.querySelectorAll('.trash-item')].find((el) => el.textContent.includes(TITLE));
        if (!row) return false;
        row.querySelector('.trash-restore').click();
        const gone = await waitFor(() => ![...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        // D15 成功静默 + D8 清撤销槽：撤销 toast 退场后不再有任何 toast 动作。
        const noUndo = await waitFor(() => !document.querySelector('.toast-action'));
        const noError = !errorToast();
        const countZero = trashNav()?.querySelector('.nav-count')?.textContent === '0';
        const stored = (await window.polaris.tasks.list()).find((t) => t.title === TITLE);
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
        window.dispatchEvent(new Event('focus'));
        const back = await waitFor(() => findRow(TITLE));
        return Boolean(gone) && Boolean(noUndo) && noError && countZero &&
          Boolean(stored) && stored.deletedAt === null && Boolean(back);
      })()`)

      // 再删 → 彻底删除（确认弹窗文案字面量、默认焦点取消、Esc 只关弹窗不删、
      // 确认后缺席）。顺带第五态 ghost 扫描：确认弹窗内两个按钮。
      const purgeResult = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟回收站 主链';
        findRow(TITLE).querySelector('.task-delete').click();
        const gone = await waitFor(() => !findRow(TITLE));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站')).click();
        window.dispatchEvent(new Event('focus'));
        const shown = await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        if (!gone || !shown) return { purge: false, ghosts: ['chain-broken'] };
        const row = [...document.querySelectorAll('.trash-item')].find((el) => el.textContent.includes(TITLE));
        row.querySelector('.trash-purge').click();
        const dialog = await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        const copyOk = document.querySelector('.confirm-message')?.textContent === '彻底删除「' + TITLE + '」？此操作无法撤销。';
        const labelsOk = JSON.stringify([...document.querySelectorAll('.confirm-actions button')].map((b) => b.textContent)) === JSON.stringify(['取消', '彻底删除']);
        const focusCancel = document.activeElement === document.querySelector('.confirm-actions button');
        // 第五态 ghost 扫描，判据与主扫描一致。模板字符串里反斜杠写两个，
        // 否则页面端正则丢字面括号（见 rgbOf 注释）。
        const rgbOf = (s) => {
          const m = /rgba?\\(([^)]+)\\)/.exec(s || '');
          if (!m) return null;
          const p = m[1].split(',').map(Number);
          return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
        };
        const sameColor = (a, b) =>
          Boolean(a && b) && Math.abs(a.r - b.r) <= 6 && Math.abs(a.g - b.g) <= 6 && Math.abs(a.b - b.b) <= 6;
        const ghosts = [];
        for (const el of document.querySelectorAll('.confirm-panel button')) {
          if (el.disabled) continue;
          const prev = document.activeElement;
          el.focus();
          if (document.activeElement !== el) continue;
          const cs = getComputedStyle(el);
          const fill = rgbOf(cs.backgroundColor);
          if (cs.outlineStyle !== 'none' && el.matches(':focus-visible')) {
            const ring = rgbOf(cs.outlineColor);
            const border = rgbOf(cs.borderTopColor);
            const offset = parseFloat(cs.outlineOffset) || 0;
            if (fill && fill.a > 0.85 && sameColor(ring, fill)) ghosts.push(el.className + ' [fill]');
            if (offset > 0 && parseFloat(cs.borderTopWidth) > 0 && border && border.a > 0.5 && sameColor(ring, border)) {
              ghosts.push(el.className + ' [border]');
            }
          }
          if (prev && prev.focus) prev.focus();
        }
        // Esc 派发到真实焦点节点（取消按钮），走 React root 分发那条路径。
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const closed = await waitFor(() => !document.querySelector('.confirm-panel'));
        const stillThere = [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE));
        // 重新打开并确认彻底删除。
        row.querySelector('.trash-purge').click();
        const reopened = await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '彻底删除').click();
        const purged = await waitFor(() => ![...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        const dialogGone = await waitFor(() => !document.querySelector('.confirm-panel'));
        const emptyShown = await waitFor(() => document.querySelector('.empty-title')?.textContent === '回收站是空的');
        const storedGone = !(await window.polaris.tasks.listDeleted()).some((t) => t.title === TITLE);
        const liveGone = !(await window.polaris.tasks.list()).some((t) => t.title === TITLE);
        return {
          purge: Boolean(dialog) && copyOk && labelsOk && focusCancel && Boolean(closed) && stillThere &&
            Boolean(reopened) && Boolean(purged) && Boolean(dialogGone) && Boolean(emptyShown) && storedGone && liveGone,
          ghosts
        };
      })()`)
      trashPurgeWorks = purgeResult?.purge === true
      confirmGhostFree = Array.isArray(purgeResult?.ghosts) && purgeResult.ghosts.length === 0
      if (!confirmGhostFree) console.error('CONFIRM_RING_GHOST', JSON.stringify(purgeResult?.ghosts))

      // 清空链：种两条 → UI 软删（留下撤销槽）→ 清空确认（计数文案字面量）→
      // 空状态文案 → D8 撤销槽无条件清空。结束后路由回今天，供后续布局测量。
      trashEmptyWorks = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const due = new Date();
        due.setHours(23, 59, 0, 0);
        for (const name of ['冒烟回收站 清空甲', '冒烟回收站 清空乙']) {
          await window.polaris.tasks.create({ title: name, dueAt: due.toISOString(), projectId: null });
        }
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
        window.dispatchEvent(new Event('focus'));
        const seeded = await waitFor(() => findRow('冒烟回收站 清空甲') && findRow('冒烟回收站 清空乙'));
        if (!seeded) return false;
        findRow('冒烟回收站 清空甲').querySelector('.task-delete').click();
        await waitFor(() => !findRow('冒烟回收站 清空甲'));
        findRow('冒烟回收站 清空乙').querySelector('.task-delete').click();
        await waitFor(() => !findRow('冒烟回收站 清空乙'));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站')).click();
        window.dispatchEvent(new Event('focus'));
        const both = await waitFor(() => document.querySelectorAll('.trash-item').length === 2);
        if (!both) return false;
        document.querySelector('.trash-empty-trigger').click();
        const dialog = await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        const copyOk = document.querySelector('.confirm-message')?.textContent === '清空回收站？将彻底删除 2 个任务，此操作无法撤销。';
        const labelsOk = JSON.stringify([...document.querySelectorAll('.confirm-actions button')].map((b) => b.textContent)) === JSON.stringify(['取消', '确认清空']);
        [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '确认清空').click();
        const emptied = await waitFor(() => document.querySelector('.empty-title')?.textContent === '回收站是空的');
        const descOk = document.querySelector('.empty-desc')?.textContent === '删除的任务会在这里保留 30 天';
        const noCta = !document.querySelector('.empty-cta');
        // D8：清空无条件清撤销槽，不留永远失败的 Ctrl Z。
        const noUndo = await waitFor(() => !document.querySelector('.toast-action'));
        const storedEmpty = (await window.polaris.tasks.listDeleted()).length === 0;
        const countZero = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站'))?.querySelector('.nav-count')?.textContent === '0';
        const disabled = document.querySelector('.trash-empty-trigger')?.disabled === true;
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelector('.quick-add input'));
        return Boolean(dialog) && copyOk && labelsOk && Boolean(emptied) && descOk && noCta &&
          Boolean(noUndo) && storedEmpty && countZero && disabled;
      })()`)

      // 硬删失败注入：摘 tasks:delete-forever → 错误 toast 字面量 + 行回滚到
      // 回收站 + 库里仍在；恢复后重试成功并清场。与写失败块同一手法。
      await seedWriteTask('冒烟回收站 硬删失败')
      await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟回收站 硬删失败';
        findRow(TITLE).querySelector('.task-delete').click();
        await waitFor(() => !findRow(TITLE));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站')).click();
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
      })()`)
      ipcMain.removeHandler('tasks:delete-forever')
      try {
        storagePurgeError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const TITLE = '冒烟回收站 硬删失败';
          const row = [...document.querySelectorAll('.trash-item')].find((el) => el.textContent.includes(TITLE));
          if (!row) return false;
          row.querySelector('.trash-purge').click();
          await waitFor(() => document.querySelector('.confirm-panel'));
          await sleep(350);
          [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '彻底删除').click();
          const toasted = await waitFor(() => errorToast()?.textContent.includes('保存失败，改动未写入本地数据库'));
          // 错误 toast 只能由 catch 产生，出现即回滚已提交；再等行回到回收站。
          const rolledBack = await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
          const stillStored = (await window.polaris.tasks.listDeleted()).some((t) => t.title === TITLE);
          return Boolean(toasted) && Boolean(rolledBack) && stillStored;
        })()`)
      } finally {
        resetTaskIpc()
      }
      storagePurgeClears = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟回收站 硬删失败';
        const row = [...document.querySelectorAll('.trash-item')].find((el) => el.textContent.includes(TITLE));
        if (!row) return false;
        row.querySelector('.trash-purge').click();
        await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '彻底删除').click();
        const gone = await waitFor(() => ![...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        const cleared = await waitFor(() => !errorToast());
        const storedGone = !(await window.polaris.tasks.listDeleted()).some((t) => t.title === TITLE);
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelector('.quick-add input'));
        return Boolean(gone) && Boolean(cleared) && storedGone;
      })()`)

      // 清空失败注入（修复 5）：摘 tasks:empty-trash → 软删留下撤销槽 → 清空确认
      // 失败 → 错误 toast + 行回滚 + 撤销槽还原（撤销 toast 退场落定后仍在）。
      // 未还原撤销槽的话，乐观清空卸载的撤销 toast 不会再出现。
      await seedWriteTask('冒烟回收站 清空失败')
      ipcMain.removeHandler('tasks:empty-trash')
      try {
        storageEmptyError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const TITLE = '冒烟回收站 清空失败';
          findRow(TITLE).querySelector('.task-delete').click();
          await waitFor(() => !findRow(TITLE));
          [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站')).click();
          window.dispatchEvent(new Event('focus'));
          await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
          document.querySelector('.trash-empty-trigger').click();
          await waitFor(() => document.querySelector('.confirm-panel'));
          await sleep(350);
          [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '确认清空').click();
          const toasted = await waitFor(() => errorToast()?.textContent.includes('保存失败，改动未写入本地数据库'));
          const rolledBack = await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
          // 等乐观清空的撤销 toast 退场落定：修复 5 还原撤销槽则它重新在场。
          await sleep(350);
          const undoKept = Boolean(document.querySelector('.toast-action'));
          const stillStored = (await window.polaris.tasks.listDeleted()).some((t) => t.title === TITLE);
          return Boolean(toasted) && Boolean(rolledBack) && undoKept && stillStored;
        })()`)
      } finally {
        resetTaskIpc()
      }
      storageEmptyClears = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        document.querySelector('.trash-empty-trigger').click();
        await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '确认清空').click();
        const emptied = await waitFor(() => document.querySelector('.empty-title')?.textContent === '回收站是空的');
        const noUndo = await waitFor(() => !document.querySelector('.toast-action'));
        const cleared = await waitFor(() => !errorToast());
        const storedEmpty = (await window.polaris.tasks.listDeleted()).length === 0;
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelector('.quick-add input'));
        return Boolean(emptied) && Boolean(noUndo) && Boolean(cleared) && storedEmpty;
      })()`)

      // 双读失败归属（readFailures 集合）：load 与 loadTrash 同时失败后，只让
      // trash 读成功不能清掉 load 的失败证据——错误 toast 必须等两个读都成功
      // 才消失。单槽归属会被后失败者覆盖，先失败的证据就丢了。
      ipcMain.removeHandler('tasks:list')
      ipcMain.removeHandler('tasks:list-deleted')
      try {
        await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          await waitFor(() => errorToast()?.textContent.includes('读取本地数据失败'));
          // toast 由先失败的读挂出；等后一个读的 catch 也落地再进入下一阶段。
          await sleep(350);
        })()`)
      } finally {
        resetTaskIpc()
      }
      // 恢复后不 dispatch focus：load 尚未重试。只重摘主读，让 trash 读单独成功。
      ipcMain.removeHandler('tasks:list')
      try {
        storageDualReadError = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站')).click();
          const shown = await waitFor(() => document.querySelector('.view-title')?.textContent === '回收站');
          // setView 触发的 loadTrash 此刻已成功；load 的失败标记必须仍在。
          await sleep(350);
          return Boolean(shown) && errorToast()?.textContent === '读取本地数据失败';
        })()`)
      } finally {
        resetTaskIpc()
      }
      // 两个读都成功，错误 toast 才允许消失；随后路由回今天。
      storageDualReadCleared = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        window.dispatchEvent(new Event('focus'));
        const cleared = await waitFor(() => !errorToast());
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelector('.quick-add input'));
        return Boolean(cleared);
      })()`)

      // 确认弹窗协调：弹窗开着时 N 不切视图、Ctrl Z 不恢复被确认的行；
      // aria-describedby 指向完整警告；确认硬删退场落定后焦点不丢到 body。
      // 撤销 toast 只有 6 秒窗口，删除→确认→断言在同一个页面块里快速完成。
      await seedWriteTask('冒烟回收站 确认')
      const confirmResult = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const TITLE = '冒烟回收站 确认';
        findRow(TITLE).querySelector('.task-delete').click();
        await waitFor(() => !findRow(TITLE));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('回收站')).click();
        const shown = await waitFor(() => [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        if (!shown) return { blocksN: false, blocksUndo: false, describedBy: false, focusLands: false };
        const row = [...document.querySelectorAll('.trash-item')].find((el) => el.textContent.includes(TITLE));
        row.querySelector('.trash-purge').click();
        await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        // 读屏打开即播报完整警告：aria-describedby 必须指向确认文案本身。
        const descId = document.querySelector('.confirm-panel')?.getAttribute('aria-describedby');
        const describedBy = Boolean(descId) &&
          document.getElementById(descId)?.textContent === '彻底删除「' + TITLE + '」？此操作无法撤销。';
        // N 让位：不切视图、不抢焦点（默认焦点在取消按钮上）。
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
        await sleep(150);
        const blocksN = document.querySelector('.view-title')?.textContent === '回收站' &&
          Boolean(document.querySelector('.confirm-panel')) &&
          Boolean(document.activeElement?.closest('.confirm-panel'));
        // Ctrl Z 让位：被确认的行不恢复，撤销 toast 原样保留。
        const countBefore = document.querySelectorAll('.trash-item').length;
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await sleep(150);
        const blocksUndo = document.querySelectorAll('.trash-item').length === countBefore &&
          [...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)) &&
          Boolean(document.querySelector('.confirm-panel')) &&
          Boolean(document.querySelector('.toast-action'));
        // Esc 只关弹窗不删，焦点还给触发者。
        document.querySelector('.confirm-panel')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const closed = await waitFor(() => !document.querySelector('.confirm-panel'));
        // 重新打开并确认硬删：退场落定后焦点必须落在 .main 或邻行恢复按钮，
        // 不能随失效的落点丢到 body。
        row.querySelector('.trash-purge').click();
        const reopened = await waitFor(() => document.querySelector('.confirm-panel'));
        await sleep(350);
        [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '彻底删除').click();
        const purged = await waitFor(() => ![...document.querySelectorAll('.trash-item')].some((el) => el.textContent.includes(TITLE)));
        const dialogGone = await waitFor(() => !document.querySelector('.confirm-panel'));
        await sleep(350);
        const focusLands = Boolean(closed) && Boolean(reopened) && Boolean(purged) && Boolean(dialogGone) &&
          document.activeElement !== document.body &&
          (document.activeElement?.classList.contains('main') || document.activeElement?.classList.contains('trash-restore'));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelector('.quick-add input'));
        return { blocksN, blocksUndo, describedBy, focusLands };
      })()`)
      confirmBlocksN = confirmResult?.blocksN === true
      confirmBlocksUndo = confirmResult?.blocksUndo === true
      confirmDescribedBy = confirmResult?.describedBy === true
      trashFocusLands = confirmResult?.focusLands === true
    }

    // The strip must stay one row at both the narrow window and the wide window
    // with the inspector open, and the toggle must never be orphaned inside it.
    const measureStrip = async (width: number, withInspector: boolean): Promise<boolean> => {
      if (!mainWindow) return false
      mainWindow.setSize(width, 800)
      // 等渲染层的视口宽度稳定下来再量布局：连续两次读数相同才算落定。
      // 直接量会撞上 resize 尚未生效的那一帧，把窄窗断言量成宽窗。
      let lastWidth = -1
      await waitForCondition(async () => {
        const w = await mainWindow!.webContents.executeJavaScript('window.innerWidth')
        const stable = w === lastWidth
        lastWidth = w
        return stable
      }, 3000, 60)
      await settledFrames(mainWindow.webContents)
      return mainWindow.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const input = document.querySelector('.quick-add input');
        if (${withInspector ? 'true' : 'false'}) {
          const firstTitle = document.querySelector('.task-title');
          if (firstTitle) firstTitle.click();
          await sleep(400);
        }
        setter.call(input, '冒烟布局 这是一段用来把标题撑得很长的任务名称所以标题会被截断 下周三下午3点 #冒烟项目 !高');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);
        const strip = document.querySelector('.quick-add-parse');
        const chips = [...document.querySelectorAll('.qa-chip')];
        const height = strip ? strip.offsetHeight : -1;
        const toggleInStrip = Boolean(strip && strip.querySelector('.qa-toggle'));
        const tops = chips.map((el) => el.offsetTop);
        const singleRow = tops.every((top) => top === tops[0]);
        const ok = chips.length === 3 && height > 0 && height <= 44 && !toggleInStrip && singleRow;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(250);
        if (${withInspector ? 'true' : 'false'}) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(300);
        }
        return ok;
      })()`)
    }

    // Reminder window: one opaque surface, correct theme on the very first
    // frame, and a title that a long project name cannot squeeze flat.
    let reminderSurfaceTested = false
    let reminderTaskId: string | null = null
    const themeBefore = getCurrentTheme()
    try {
      const longProject = await mainWindow?.webContents.executeJavaScript(
        `window.polaris.projects.create({ name: '冒烟超长项目名'.repeat(11) + '尾尾尾', color: '#5EEAD4' })`
      )
      const created = await mainWindow?.webContents.executeJavaScript(`(async () => {
        const task = await window.polaris.tasks.create({
          title: '冒烟提醒 这是一条用来撑满两行的超长中文任务标题所以需要写得足够长才能触发换行分支',
          dueAt: new Date(Date.now() + 3600000).toISOString(),
          projectId: ${JSON.stringify(longProject?.id ?? null)}
        });
        await window.polaris.tasks.update({
          id: task.id,
          remindAt: new Date(Date.now() - 60000).toISOString()
        });
        return task.id;
      })()`)
      reminderTaskId = created
      checkRemindersNow()

      await waitForCondition(() => Boolean(getReminderWindow()), 8000, 150)
      const reminder = getReminderWindow()
      if (reminder) {
        // 等提醒窗真的把内容渲染出来，而不是盲等 900ms。这里只等「就绪」，
        // 绝不等「像素变成期望色」—— 后者会把「首帧颜色就是对的」这条断言
        // 变成永真式：先画错再改正的窗口也会通过。
        await waitForCondition(async () => {
          if (reminder.isDestroyed() || reminder.webContents.isDestroyed()) return false
          return Boolean(
            await reminder.webContents.executeJavaScript(
              `Boolean(document.querySelector('.reminder-shell') && document.querySelector('.reminder-title')?.textContent?.trim())`
            )
          )
        }, 8000)
        await settledFrames(reminder.webContents)
        const shape = await reminder.webContents.executeJavaScript(`(() => {
          const shell = document.querySelector('.reminder-shell');
          const card = document.querySelector('.reminder-card');
          const meta = document.querySelector('.reminder-meta');
          const title = document.querySelector('.reminder-title');
          if (!shell || !card || !meta || !title) return null;
          const cs = getComputedStyle(card);
          const rect = card.getBoundingClientRect();
          const alpha = cs.backgroundColor.startsWith('rgb(') ? 1 : Number((cs.backgroundColor.split(',')[3] || '1').replace(')', ''));
          const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
          return {
            theme: document.documentElement.dataset.theme,
            padTop: getComputedStyle(shell).paddingTop,
            padLeft: getComputedStyle(shell).paddingLeft,
            radius: cs.borderTopLeftRadius,
            border: cs.borderTopWidth,
            alpha,
            fills: Math.abs(rect.left) < 1 && Math.abs(rect.top) < 1 &&
              Math.abs(rect.width - window.innerWidth) < 1 && Math.abs(rect.height - window.innerHeight) < 1,
            metaShort: meta.clientHeight <= 17,
            titleTwoLines: title.getBoundingClientRect().height >= 2 * lineHeight - 0.5,
            // The primary button is accent-filled; its focus ring must not be.
            ringDiffersFromFill: (() => {
              const b = document.querySelector('.reminder-primary');
              if (!b) return false;
              b.focus();
              const cs = getComputedStyle(b);
              // Read while still focused: computed style is live, so blurring
              // first would report outline-style none.
              const style = cs.outlineStyle;
              const ring = cs.outlineColor;
              const fill = cs.backgroundColor;
              b.blur();
              return style !== 'none' && ring !== fill;
            })(),
            buttonGeom: (() => {
              const b = document.querySelector('.reminder-primary');
              const r = b.getBoundingClientRect();
              return {
                x: r.x, y: r.y, w: r.width,
                dpr: window.devicePixelRatio,
                fill: getComputedStyle(b).backgroundColor
              };
            })()
          };
        })()`)

        // Sample a real painted pixel inside the right padding, not a value the
        // main process set itself.
        const image = await reminder.webContents.capturePage()
        const size = image.getSize()
        const pixel = image
          .crop({ x: size.width - 6, y: Math.floor(size.height / 2), width: 1, height: 1 })
          .toBitmap()
        const [b, g, r] = [pixel[0], pixel[1], pixel[2]]
        const want = ({ dark: [11, 14, 21], light: [251, 250, 247], dusk: [24, 44, 78], sand: [250, 246, 238], sky: [238, 246, 252], green: [234, 247, 236] } as Record<string, number[]>)[themeBefore] ?? [11, 14, 21]
        const painted = Math.abs(r - want[0]) <= 1 && Math.abs(g - want[1]) <= 1 && Math.abs(b - want[2]) <= 1

        // Sample 1 CSS px inside the primary button's top edge, unfocused. An
        // inset bevel shows up here as a near-white rim; the fill must be flat.
        const geom = shape?.buttonGeom
        let noBevelRim = false
        if (geom) {
          const edge = image
            .crop({
              x: Math.round((geom.x + geom.w / 2) * geom.dpr),
              y: Math.round((geom.y + 1) * geom.dpr),
              width: 1,
              height: 1
            })
            .toBitmap()
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(geom.fill)
          noBevelRim = Boolean(
            m &&
              Math.abs(edge[2] - Number(m[1])) <= 2 &&
              Math.abs(edge[1] - Number(m[2])) <= 2 &&
              Math.abs(edge[0] - Number(m[3])) <= 2
          )
          if (!noBevelRim) {
            console.error(
              'REMINDER_BEVEL_FAIL',
              JSON.stringify({ edgeRgb: [edge[2], edge[1], edge[0]], fill: geom.fill })
            )
          }
        }

        reminderSurfaceTested = Boolean(
          shape &&
            shape.theme === themeBefore &&
            shape.padTop === '0px' &&
            shape.padLeft === '0px' &&
            shape.radius === '0px' &&
            shape.border === '0px' &&
            shape.alpha === 1 &&
            shape.fills &&
            shape.metaShort &&
            shape.titleTwoLines &&
            shape.ringDiffersFromFill &&
            noBevelRim &&
            painted &&
            reminder.getBackgroundColor().toLowerCase() === themeBackgroundColor().toLowerCase()
        )
        if (!reminderSurfaceTested) {
          console.error('REMINDER_SURFACE_FAIL', JSON.stringify({ shape, painted, rgb: [r, g, b], want }))
        }

        // Flip the theme while the reminder is open: the other window must
        // follow, and its painted surface must match the new theme too.
        await mainWindow?.webContents.executeJavaScript(
          `document.querySelector('.theme-toggle')?.click()`
        )
        // 跨窗口跟随是收敛性质，等条件才是对的断言方式：先等主窗口应用了新主题，
        // 再等提醒窗跟上，最后过绘制栅栏截一次图。原来是两处盲等 900ms。
        await waitForCondition(() => getCurrentTheme() !== themeBefore)
        const flipped = getCurrentTheme()
        await waitForCondition(async () => {
          if (reminder.isDestroyed() || reminder.webContents.isDestroyed()) return false
          return (
            (await reminder.webContents.executeJavaScript(`document.documentElement.dataset.theme`)) ===
            flipped
          )
        })
        await settledFrames(reminder.webContents)
        const flippedTheme = await reminder.webContents.executeJavaScript(
          `document.documentElement.dataset.theme`
        )
        const flippedImage = await reminder.webContents.capturePage()
        const flippedSize = flippedImage.getSize()
        const fp = flippedImage
          .crop({ x: flippedSize.width - 6, y: Math.floor(flippedSize.height / 2), width: 1, height: 1 })
          .toBitmap()
        const flipWant = ({ dark: [11, 14, 21], light: [251, 250, 247], dusk: [24, 44, 78], sand: [250, 246, 238], sky: [238, 246, 252], green: [234, 247, 236] } as Record<string, number[]>)[flipped] ?? [11, 14, 21]
        const flipPainted =
          Math.abs(fp[2] - flipWant[0]) <= 1 &&
          Math.abs(fp[1] - flipWant[1]) <= 1 &&
          Math.abs(fp[0] - flipWant[2]) <= 1
        // Re-check the bevel in the other theme: the day theme is where the
        // 90%-white highlight was glaring.
        const flipGeom = await reminder.webContents.executeJavaScript(`(() => {
          const b = document.querySelector('.reminder-primary');
          const r = b.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, dpr: window.devicePixelRatio, fill: getComputedStyle(b).backgroundColor };
        })()`)
        const flipEdge = flippedImage
          .crop({
            x: Math.round((flipGeom.x + flipGeom.w / 2) * flipGeom.dpr),
            y: Math.round((flipGeom.y + 1) * flipGeom.dpr),
            width: 1,
            height: 1
          })
          .toBitmap()
        const fm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(flipGeom.fill)
        const flipNoBevel = Boolean(
          fm &&
            Math.abs(flipEdge[2] - Number(fm[1])) <= 2 &&
            Math.abs(flipEdge[1] - Number(fm[2])) <= 2 &&
            Math.abs(flipEdge[0] - Number(fm[3])) <= 2
        )
        if (!flipNoBevel) {
          console.error('REMINDER_BEVEL_FLIP_FAIL', JSON.stringify({ edgeRgb: [flipEdge[2], flipEdge[1], flipEdge[0]], fill: flipGeom.fill }))
        }
        const reminderThemeSynced =
          flipped !== themeBefore &&
          flippedTheme === flipped &&
          flipPainted &&
          flipNoBevel &&
          reminder.getBackgroundColor().toLowerCase() === themeBackgroundColor(flipped).toLowerCase()
        if (!reminderThemeSynced) {
          console.error(
            'REMINDER_THEME_FAIL',
            JSON.stringify({ flipped, flippedTheme, flipPainted, rgb: [fp[2], fp[1], fp[0]], flipWant })
          )
        }
        reminderSurfaceTested = reminderSurfaceTested && reminderThemeSynced
        await mainWindow?.webContents.executeJavaScript(
          `document.querySelector('.theme-toggle')?.click()`
        )
        // 复原也是可观测状态：等提醒窗回到原主题，而不是盲等 600ms 就散场。
        await waitForCondition(async () => {
          if (reminder.isDestroyed() || reminder.webContents.isDestroyed()) return true
          return (
            (await reminder.webContents.executeJavaScript(`document.documentElement.dataset.theme`)) ===
            themeBefore
          )
        })
      }
    } catch (error) {
      console.error('REMINDER_SURFACE_ERROR', error)
    } finally {
      dismissReminder()
      if (reminderTaskId) {
        // 软删后再硬删：冒烟夹具不留回收站残留。
        await mainWindow?.webContents.executeJavaScript(
          `window.polaris.tasks.remove(${JSON.stringify(reminderTaskId)}).then(() => window.polaris.tasks.deleteForever(${JSON.stringify(reminderTaskId)}))`
        )
      }
      // 等提醒窗真的关掉再做后面的窗口缩放测量，否则残留窗口会干扰截图与布局。
      await waitForCondition(() => !getReminderWindow(), 4000, 100)
    }

    const originalSize = mainWindow?.getSize() ?? [1280, 800]
    const parseLayoutNarrow = await measureStrip(980, false)
    const parseLayoutWide = await measureStrip(1280, true)
    mainWindow?.setSize(originalSize[0], originalSize[1])
    if (mainWindow) await settledFrames(mainWindow.webContents)

    // 面板 Esc 上移到容器：焦点 Tab 到命令按钮后 Esc 仍应关闭面板（旧实现只挂搜索框）。
    const paletteEscWorks =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        document.querySelector('.search-trigger').click();
        if (!(await waitFor(() => document.querySelector('.command-input')))) return false;
        await sleep(200);
        const firstButton = document.querySelector('.command-item');
        if (!firstButton) return false;
        firstButton.focus();
        await sleep(50);
        const focusOnButton = document.activeElement === firstButton;
        firstButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const closed = await waitFor(() => !document.querySelector('.command-input'));
        return focusOnButton && closed;
      })()`)) === true

    // 空态文案与 CTA：此处在全部数据相关断言之后，清空任务制造空态是安全的。
    const emptyStateWorks =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        for (const t of await window.polaris.tasks.list()) await window.polaris.tasks.remove(t.id);
        for (const t of await window.polaris.tasks.listDeleted()) await window.polaris.tasks.deleteForever(t.id);
        window.dispatchEvent(new Event('focus'));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
        window.dispatchEvent(new Event('focus'));
        const allEmpty = await waitFor(() => document.querySelector('.empty-title')?.textContent === '还没有任务');
        const allCta = document.querySelector('.empty-cta')?.textContent === '添加任务';
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('已完成')).click();
        window.dispatchEvent(new Event('focus'));
        const completedEmpty = await waitFor(() => document.querySelector('.empty-title')?.textContent === '还没有完成的任务');
        const completedCta = document.querySelector('.empty-cta')?.textContent === '查看今天';
        if (!completedCta) return false;
        document.querySelector('.empty-cta').click();
        const navigated = await waitFor(() => document.querySelector('.view-title')?.textContent?.trim() === '今天');
        return allEmpty && allCta && completedEmpty && completedCta && navigated;
      })()`)) === true

    // 逐条具名，而不是串成一条 && 链：失败时必须能一眼看出是哪条断言。
    // 只筛 result 里 value === false 是不够的 —— afterAdd / afterDelete /
    // commandCount 是数值比较，版本号是字符串比较，它们失败时 JSON 里
    // 一个 false 都没有，排查会得出「没有失败项」的假结论。
    const checks: Record<string, boolean> = {
      brand: result.brand === 'Polaris',
      viewTitle: result.viewTitle === '今天',
      afterAdd: result.afterAdd === result.initial + 1,
      detailOpened: result.detailOpened === true,
      detailEditSaved: result.detailEditSaved === true,
      detailClosed: result.detailClosed === true,
      done: result.done === true,
      persisted: result.persisted === true,
      checkDrawn: result.checkDrawn === true,
      commandCount: result.commandCount === 1,
      themeToggled: result.themeToggled === true,
      themeMatrix: result.themeMatrix === true,
      themeMenuWorks: result.themeMenuWorks === true,
      themePaletteWorks: result.themePaletteWorks === true,
      autoStartTested: result.autoStartTested === true,
      // 期望值取自主进程，不经渲染层反算：写死的版本字符串会在这里露馅。
      settingsVersion: result.settingsVersion === app.getVersion(),
      settingsFastClose: result.settingsFastClose === true,
      footerVersion: result.footerVersion === app.getVersion(),
      recurrenceTested: result.recurrenceTested === true,
      recurrenceNoticeTested: result.recurrenceNoticeTested === true,
      afterDelete: result.afterDelete === result.initial,
      parseChipsShown: result.parseChipsShown === true,
      parseDueCorrect: result.parseDueCorrect === true,
      parseShellHeight: result.parseShellHeight === true,
      parseUndoKeepsText: result.parseUndoKeepsText === true,
      parseDismissedSubmit: result.parseDismissedSubmit === true,
      parseProjectMapped: result.parseProjectMapped === true,
      parseNoRegression: result.parseNoRegression === true,
      parseCollapsedHeight: result.parseCollapsedHeight === true,
      parseViewDefault: result.parseViewDefault === true,
      parseEmptyTitleBlocked: result.parseEmptyTitleBlocked === true,
      parseEmptyTitleAnnounced: result.parseEmptyTitleAnnounced === true,
      parseImeGuarded: result.parseImeGuarded === true,
      parseKeyboardUndo: result.parseKeyboardUndo === true,
      parseRestoreWorks: result.parseRestoreWorks === true,
      parseEscapeInStrip: result.parseEscapeInStrip === true,
      parseCaseInsensitiveUndo: result.parseCaseInsensitiveUndo === true,
      parsePriorityPersisted: result.parsePriorityPersisted === true,
      parseEscKeepsInspector: result.parseEscKeepsInspector === true,
      parseLastChipFocus: result.parseLastChipFocus === true,
      parseDraftSurvives: result.parseDraftSurvives === true,
      parseReceiptNamesProject: result.parseReceiptNamesProject === true,
      pickerNoNativeInput: result.pickerNoNativeInput === true,
      pickerGridShape: result.pickerGridShape === true,
      pickerFitsBudget: result.pickerFitsBudget === true,
      pickerDayCommit: result.pickerDayCommit === true,
      pickerValueInvariant: result.pickerValueInvariant === true,
      pickerArrowWrap: result.pickerArrowWrap === true,
      pickerTypeFlow: result.pickerTypeFlow === true,
      pickerStepSemantics: result.pickerStepSemantics === true,
      pickerTextSync: result.pickerTextSync === true,
      pickerBlurKeepsHour: result.pickerBlurKeepsHour === true,
      pickerEscRestores: result.pickerEscRestores === true,
      pickerTodayFuture: result.pickerTodayFuture === true,
      pickerClearWorks: result.pickerClearWorks === true,
      focusRingGhosted: result.focusRingGhosted === true,
      priorityOrdering: result.priorityOrdering === true,
      completedAtTested: result.completedAtTested === true,
      recurrenceStamps: result.recurrenceStamps === true,
      deletedAtTested: result.deletedAtTested === true,
      checkDrawnReduced: checkDrawnReduced === true,
      parseErrorReceipt: parseErrorReceipt === true,
      storageToggleError: storageToggleError === true,
      storageDeleteError: storageDeleteError === true,
      storageUndoError: storageUndoError === true,
      storageLoadError: storageLoadError === true,
      storageErrorDismiss: storageErrorDismiss === true,
      storageErrorClears: storageErrorClears === true,
      trashDeleteVisible: trashDeleteVisible === true,
      trashRestoreWorks: trashRestoreWorks === true,
      trashPurgeWorks: trashPurgeWorks === true,
      confirmGhostFree: confirmGhostFree === true,
      trashEmptyWorks: trashEmptyWorks === true,
      storagePurgeError: storagePurgeError === true,
      storagePurgeClears: storagePurgeClears === true,
      storageEmptyError: storageEmptyError === true,
      storageEmptyClears: storageEmptyClears === true,
      storageDualReadError: storageDualReadError === true,
      storageDualReadCleared: storageDualReadCleared === true,
      confirmBlocksN: confirmBlocksN === true,
      confirmBlocksUndo: confirmBlocksUndo === true,
      confirmDescribedBy: confirmDescribedBy === true,
      trashFocusLands: trashFocusLands === true,
      retentionTable: retentionOk === true,
      recurrenceClampTable: recurrenceOk === true,
      parseGrammarTable: parseAssertions.grammar === true,
      parseInvariants: parseAssertions.invariants === true,
      parseFormatNull: parseAssertions.format === true,
      parseLayoutNarrow: parseLayoutNarrow === true,
      parseLayoutWide: parseLayoutWide === true,
      reminderSurfaceTested: reminderSurfaceTested === true,
      paletteEscWorks: paletteEscWorks === true,
      emptyStateWorks: emptyStateWorks === true
    }
    const failed = Object.keys(checks).filter((name) => !checks[name])
    const ok = failed.length === 0
    // 单独一行、显眼、可 grep：偶发失败时不必再从九十多个字段里肉眼找。
    if (!ok) console.error('POLARIS_SMOKE_FAILED ' + JSON.stringify(failed))

    console.log(
      'POLARIS_SMOKE_RESULT ' +
        JSON.stringify({
          ok,
          failed,
          ...result,
          checkDrawnReduced,
          parseErrorReceipt,
          storageToggleError,
          storageDeleteError,
          storageUndoError,
          storageLoadError,
          storageErrorDismiss,
          storageErrorClears,
          trashDeleteVisible,
          trashRestoreWorks,
          trashPurgeWorks,
          confirmGhostFree,
          trashEmptyWorks,
          storagePurgeError,
          storagePurgeClears,
          storageEmptyError,
          storageEmptyClears,
          storageDualReadError,
          storageDualReadCleared,
          confirmBlocksN,
          confirmBlocksUndo,
          confirmDescribedBy,
          trashFocusLands,
          retentionTable: retentionOk,
          recurrenceClampTable: recurrenceOk,
          paletteEscWorks,
          emptyStateWorks,
          parseGrammarTable: parseAssertions.grammar,
          parseInvariants: parseAssertions.invariants,
          parseFormatNull: parseAssertions.format,
          parseLayoutNarrow,
          parseLayoutWide,
          reminderSurfaceTested
        })
    )
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('POLARIS_SMOKE_ERROR', error)
    app.exit(1)
  }
}

async function captureAndQuit(): Promise<void> {
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

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  // 启动页还在时走同一条过渡，避免托盘/第二实例把主窗口直接怼到启动页前面。
  if (hasSplashWindow()) {
    revealMainWindow(mainWindow)
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

app.on('second-instance', () => {
  if (app.isReady()) {
    showMainWindow()
  } else {
    void app.whenReady().then(showMainWindow)
  }
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  initDatabase()
  // Missed retention windows are caught up on launch, same as missed reminders.
  purgeExpiredDeleted(new Date().toISOString())
  initAppTheme()
  registerIpc()

  ipcMain.handle('app:set-theme', (event, theme: string) => {
    if (!isAppTheme(theme)) return
    // Only the main window owns the global theme; a reminder window echoing its
    // own synced value must not write it back.
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    setCurrentTheme(theme)

    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(themeBackgroundColor(theme))
    }

    mainWindow.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: THEME_SYMBOL_COLOR[themeFamily(theme)],
      height: 48
    })
  })

  ipcMain.handle('reminder:dismiss', () => {
    dismissReminder()
  })

  ipcMain.handle('app:get-autostart', () => getAutoStartState())

  ipcMain.handle('app:set-autostart', (_event, enabled: boolean) => {
    return setAutoStartState(Boolean(enabled))
  })

  // Read-only, no payload to validate. The renderer must never hardcode a version
  // string: app.getVersion() reads the packaged package.json, so a release bump
  // reaches the settings panel without a code edit.
  ipcMain.handle('app:get-version', () => app.getVersion())

  // 启动页先于主窗口创建：页面极小，先画出来；主窗口加载并行进行，互不阻塞。
  // 自启（--hidden）要静默进托盘，三个测试模式要保持确定性，均跳过。
  const harness = Boolean(
    process.env['POLARIS_SMOKE'] ||
    process.env['POLARIS_SHOT'] ||
    process.env['POLARIS_SCREENSHOT']
  )
  if (!startHidden && !harness) {
    openSplashWindow(getCurrentTheme(), app.getVersion(), () => mainWindow)
  }

  createWindow()
  createTray(showMainWindow, () => app.quit())
  startReminderScheduler()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (
    process.env['POLARIS_SMOKE'] ||
    process.env['POLARIS_SHOT'] ||
    process.env['POLARIS_SCREENSHOT']
  ) {
    app.quit()
  }
})
