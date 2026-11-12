import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { getAutoStartState, setAutoStartState } from './autostart'
import { initDatabase } from './db'
import { registerIpc, registerTaskCreate } from './ipc'
import { getCurrentTheme, initAppTheme, setCurrentTheme, themeBackgroundColor } from './theme'
import {
  checkRemindersNow,
  dismissReminder,
  getReminderWindow,
  startReminderScheduler
} from './reminders'
import { createTray } from './tray'
import { dismissKeys, formatParsedDue, parseQuickAdd, pruneDismissed } from '../shared/quickAddParse'

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
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: themeBackgroundColor(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#9CA3AF',
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
    if (!startHidden) mainWindow?.show()
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
    if (!mode.startsWith('light')) {
      await mainWindow.webContents.executeJavaScript(
        `(() => { if (document.documentElement.dataset.theme !== 'dark') document.querySelector('.theme-toggle')?.click(); })()`
      )
      await new Promise((resolve) => setTimeout(resolve, 600))
    }

    if (mode.startsWith('light')) {
      await mainWindow.webContents.executeJavaScript(
        `(() => { if (document.documentElement.dataset.theme !== 'light') document.querySelector('.theme-toggle')?.click(); })()`
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
      } else if (mode === 'light-toast') {
        await captureToastScreenshot('screenshot-light-toast.png')
      } else if (mode === 'light-recurrence') {
        await captureRecurrenceScreenshot('screenshot-light-recurrence.png')
      } else if (mode === 'light-due-picker') {
        await captureDuePickerScreenshot('screenshot-light-due-picker.png', false)
      } else if (mode === 'light-due-clear') {
        await captureDuePickerScreenshot('screenshot-light-due-clear.png', true)
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
    } else if (mode === 'toast') {
      await captureToastScreenshot('screenshot-toast.png')
    } else if (mode === 'recurrence') {
      await captureRecurrenceScreenshot('screenshot-recurrence.png')
    } else if (mode === 'due-picker') {
      await captureDuePickerScreenshot('screenshot-due-picker.png', false)
    } else if (mode === 'due-clear') {
      await captureDuePickerScreenshot('screenshot-due-clear.png', true)
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

async function runSmokeTest(): Promise<void> {
  if (!mainWindow) {
    app.exit(1)
    return
  }

  await new Promise((resolve) => setTimeout(resolve, 1200))

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
        /^(冒烟测试|重复提示|重复冒烟) /.test(task.title)
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

      const autoStartBefore = await window.polaris.app.getAutoStart();
      await window.polaris.app.setAutoStart(!autoStartBefore.enabled);
      const autoStartToggled = await window.polaris.app.getAutoStart();
      await window.polaris.app.setAutoStart(autoStartBefore.enabled);
      const autoStartRestored = await window.polaris.app.getAutoStart();
      const autoStartTested =
        !autoStartBefore.supported ||
        (autoStartToggled.enabled === !autoStartBefore.enabled &&
          autoStartRestored.enabled === autoStartBefore.enabled);

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
      document.querySelectorAll('.dp-step')[1].click();
      await sleep(400);
      const syncDue = new Date(await storedDue());
      const pickerTextSync = hourInput().value === '19' && syncDue.getHours() === 19;

      await escOnce();
      const pickerEscRestores =
        !document.querySelector('.detail-popover') && Boolean(document.querySelector('.detail-title'));

      await openPicker();
      document.querySelector('.dp-today').click();
      await sleep(500);
      const todayDue = new Date(await storedDue());
      const nowReal = new Date();
      const pickerTodayFuture =
        todayDue.getTime() > nowReal.getTime() && todayDue.getDate() === nowReal.getDate();

      document.querySelector('.detail-popover-clear').click();
      await sleep(500);
      const pickerClearWorks = (await storedDue()) === null;
      await escOnce();
      await escOnce();
      await window.polaris.tasks.remove(pickerTask.id);
      window.dispatchEvent(new Event('focus'));
      await sleep(300);

      // ---------- focus-ring ghosting ----------
      // A ring in the same colour as the control it surrounds reads as a
      // duplicate of that control. Check every focusable, not a fixed list, so
      // a newly added accent button cannot reintroduce it.
      const rgbOf = (s) => {
        const m = /rgba?\(([^)]+)\)/.exec(s || '');
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const sameColor = (a, b) =>
        Boolean(a && b) && Math.abs(a.r - b.r) <= 6 && Math.abs(a.g - b.g) <= 6 && Math.abs(a.b - b.b) <= 6;
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
          if (cs.outlineStyle !== 'none' && el.matches(':focus-visible')) {
            const ring = rgbOf(cs.outlineColor);
            const fill = rgbOf(cs.backgroundColor);
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
      const focusRingGhosted = ghosts.length === 0;
      if (!focusRingGhosted) console.error('FOCUS_RING_GHOST', JSON.stringify([...new Set(ghosts)]));

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
        pickerEscRestores,
        pickerTodayFuture,
        pickerClearWorks,
        focusRingGhosted,
        brand: document.querySelector('.brand-name')?.textContent?.trim(),
        viewTitle: document.querySelector('.view-title')?.textContent?.trim(),
        initial,
        afterAdd,
        detailOpened,
        detailEditSaved,
        detailClosed,
        done,
        persisted,
        commandCount,
        themeToggled,
        autoStartTested,
        recurrenceTested,
        recurrenceNoticeTested,
        afterDelete
      };
    })()`)

    const parseAssertions = runParseAssertions()

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

    // The strip must stay one row at both the narrow window and the wide window
    // with the inspector open, and the toggle must never be orphaned inside it.
    const measureStrip = async (width: number, withInspector: boolean): Promise<boolean> => {
      if (!mainWindow) return false
      mainWindow.setSize(width, 800)
      await new Promise((resolve) => setTimeout(resolve, 400))
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

      const deadline = Date.now() + 8000
      while (!getReminderWindow() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      const reminder = getReminderWindow()
      if (reminder) {
        await new Promise((resolve) => setTimeout(resolve, 900))
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
        const want = themeBefore === 'light' ? [251, 250, 247] : [11, 14, 21]
        const painted = Math.abs(r - want[0]) <= 1 && Math.abs(g - want[1]) <= 1 && Math.abs(b - want[2]) <= 1

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
        await new Promise((resolve) => setTimeout(resolve, 900))
        const flipped = getCurrentTheme()
        const flippedTheme = await reminder.webContents.executeJavaScript(
          `document.documentElement.dataset.theme`
        )
        const flippedImage = await reminder.webContents.capturePage()
        const flippedSize = flippedImage.getSize()
        const fp = flippedImage
          .crop({ x: flippedSize.width - 6, y: Math.floor(flippedSize.height / 2), width: 1, height: 1 })
          .toBitmap()
        const flipWant = flipped === 'light' ? [251, 250, 247] : [11, 14, 21]
        const flipPainted =
          Math.abs(fp[2] - flipWant[0]) <= 1 &&
          Math.abs(fp[1] - flipWant[1]) <= 1 &&
          Math.abs(fp[0] - flipWant[2]) <= 1
        const reminderThemeSynced =
          flipped !== themeBefore &&
          flippedTheme === flipped &&
          flipPainted &&
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
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
    } catch (error) {
      console.error('REMINDER_SURFACE_ERROR', error)
    } finally {
      dismissReminder()
      if (reminderTaskId) {
        await mainWindow?.webContents.executeJavaScript(
          `window.polaris.tasks.remove(${JSON.stringify(reminderTaskId)})`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }

    const originalSize = mainWindow?.getSize() ?? [1280, 800]
    const parseLayoutNarrow = await measureStrip(980, false)
    const parseLayoutWide = await measureStrip(1280, true)
    mainWindow?.setSize(originalSize[0], originalSize[1])
    await new Promise((resolve) => setTimeout(resolve, 250))

    const ok =
      result.brand === 'Polaris' &&
      result.viewTitle === '今天' &&
      result.afterAdd === result.initial + 1 &&
      result.detailOpened === true &&
      result.detailEditSaved === true &&
      result.detailClosed === true &&
      result.done === true &&
      result.persisted === true &&
      result.commandCount === 1 &&
      result.themeToggled === true &&
      result.autoStartTested === true &&
      result.recurrenceTested === true &&
      result.recurrenceNoticeTested === true &&
      result.afterDelete === result.initial &&
      result.parseChipsShown === true &&
      result.parseDueCorrect === true &&
      result.parseShellHeight === true &&
      result.parseUndoKeepsText === true &&
      result.parseDismissedSubmit === true &&
      result.parseProjectMapped === true &&
      result.parseNoRegression === true &&
      result.parseCollapsedHeight === true &&
      result.parseViewDefault === true &&
      result.parseEmptyTitleBlocked === true &&
      result.parseEmptyTitleAnnounced === true &&
      result.parseImeGuarded === true &&
      result.parseKeyboardUndo === true &&
      result.parseRestoreWorks === true &&
      result.parseEscapeInStrip === true &&
      result.parseCaseInsensitiveUndo === true &&
      result.parsePriorityPersisted === true &&
      result.parseEscKeepsInspector === true &&
      result.parseLastChipFocus === true &&
      result.parseDraftSurvives === true &&
      result.parseReceiptNamesProject === true &&
      result.pickerNoNativeInput === true &&
      result.pickerGridShape === true &&
      result.pickerFitsBudget === true &&
      result.pickerDayCommit === true &&
      result.pickerValueInvariant === true &&
      result.pickerArrowWrap === true &&
      result.pickerTypeFlow === true &&
      result.pickerStepSemantics === true &&
      result.pickerTextSync === true &&
      result.pickerEscRestores === true &&
      result.pickerTodayFuture === true &&
      result.pickerClearWorks === true &&
      result.focusRingGhosted === true &&
      parseErrorReceipt === true &&
      parseAssertions.grammar === true &&
      parseAssertions.invariants === true &&
      parseAssertions.format === true &&
      parseLayoutNarrow === true &&
      parseLayoutWide === true &&
      reminderSurfaceTested === true

    console.log(
      'POLARIS_SMOKE_RESULT ' +
        JSON.stringify({
          ok,
          ...result,
          parseErrorReceipt,
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
  initAppTheme()
  registerIpc()

  ipcMain.handle('app:set-theme', (event, theme: string) => {
    if (theme !== 'light' && theme !== 'dark') return
    // Only the main window owns the global theme; a reminder window echoing its
    // own synced value must not write it back.
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    setCurrentTheme(theme)

    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(themeBackgroundColor(theme))
    }

    mainWindow.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: theme === 'light' ? '#4B5563' : '#9CA3AF',
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