import { BrowserWindow, powerMonitor, screen } from 'electron'
import { join } from 'node:path'
import { listDueReminders, markTaskReminded } from './db'
import { themeBackgroundColor } from './theme'

let reminderWindow: BrowserWindow | null = null
let currentTaskId: string | null = null
const reminderQueue: string[] = []

export function startReminderScheduler(): void {
  setInterval(checkRemindersNow, 30_000)
  setTimeout(checkRemindersNow, 4_000)
  powerMonitor.on('resume', checkRemindersNow)
}

export function checkRemindersNow(): void {
  const now = new Date()
  const nowIso = now.toISOString()

  for (const task of listDueReminders(nowIso)) {
    enqueueReminder(task.id)
  }
}

function enqueueReminder(taskId: string): void {
  if (currentTaskId === taskId || reminderQueue.includes(taskId)) return

  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderQueue.push(taskId)
    return
  }

  openReminderWindow(taskId)
}

export function openReminderWindow(taskId: string): void {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    if (currentTaskId !== taskId && !reminderQueue.includes(taskId)) {
      reminderQueue.push(taskId)
    }
    return
  }

  currentTaskId = taskId
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const windowWidth = 420
  const windowHeight = 212

  reminderWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round(x + width - windowWidth - 24),
    y: Math.round(y + height - windowHeight - 24),
    // thickFrame stays at its default true: Windows 11 DWM uses it to draw the
    // rounded corners and the native shadow. Do not set transparent or
    // thickFrame:false — the renderer already fills the window edge to edge.
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: true,
    show: false,
    backgroundColor: themeBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  reminderWindow.setAlwaysOnTop(true, 'floating')
  // Mark only once the reminder is actually on screen, so a window that fails
  // to load (or the app quitting first) leaves the reminder pending.
  reminderWindow.once('ready-to-show', () => {
    markTaskReminded(taskId, new Date().toISOString())
    reminderWindow?.show()
  })
  reminderWindow.on('closed', () => {
    reminderWindow = null
    currentTaskId = null
    const next = reminderQueue.shift()
    if (next) setTimeout(() => openReminderWindow(next), 350)
  })

  const hash = `reminder/${encodeURIComponent(taskId)}`
  if (process.env['ELECTRON_RENDERER_URL']) {
    void reminderWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    void reminderWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

export function dismissReminder(): void {
  reminderWindow?.close()
}

export function getReminderWindow(): BrowserWindow | null {
  return reminderWindow
}