import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { getAutoStartState, setAutoStartState } from './autostart'
import { initDatabase } from './db'
import { registerIpc } from './ipc'
import {
  checkRemindersNow,
  dismissReminder,
  getReminderWindow,
  startReminderScheduler
} from './reminders'
import { createTray } from './tray'

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
    backgroundColor: '#080A0F',
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

      return {
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
      result.afterDelete === result.initial

    console.log('POLARIS_SMOKE_RESULT ' + JSON.stringify({ ok, ...result }))
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
  registerIpc()

  ipcMain.handle('app:set-theme', (_event, theme: string) => {
    if (theme !== 'light' && theme !== 'dark') return
    const light = theme === 'light'

    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(light ? '#F4F3EF' : '#080A0F')
    }

    mainWindow?.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: light ? '#4B5563' : '#9CA3AF',
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