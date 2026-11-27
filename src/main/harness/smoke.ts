// 冒烟 harness：runSmokeTest 驱动真实 UI（webContents.executeJavaScript），
// 断言全部具名进 checks map，输出协议 POLARIS_SMOKE_RESULT/FAILED/ERROR 不变。
// 只在 harness 构建里存在；index.ts 的模块作用量经 HarnessContext 注入。

import { app, BrowserWindow, globalShortcut, ipcMain, type NativeImage } from 'electron'
import { join } from 'node:path'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  createProject,
  createSubtask,
  createTag,
  createTask,
  deleteProject,
  deleteTag,
  deleteTask,
  deleteTaskForever,
  detectExternalDbChange,
  exportBackup,
  getMeta,
  getTask,
  importBackup,
  listDeletedTasks,
  listProjects,
  listSubtasks,
  listTasks,
  loadSampleTasks,
  purgeExpiredDeleted,
  setMeta,
  updateSubtask,
  updateTask,
  writeDbSyncStamp
} from '../db'
import { registerIpc, registerTaskCreate } from '../ipc'
import { request as httpRequest } from 'node:http'
import { getMcpState, MCP_ENDPOINT, MCP_PORT, setMcpEnabled } from '../mcp'
import {
  applyDataDirectory,
  cancelDataDirectoryOffer,
  flushDataLocationOnQuit,
  getDataLocationState,
  markPointerForTest,
  resetDataDirectory,
  setDataDirectoryOffer
} from '../dataLocation'
import { describeTrayCheck, installingNotice } from '../updater'
import {
  estimateEtaSeconds,
  formatBytes,
  formatEta,
  formatSpeed,
  normalizeReleaseNotes,
  shouldAutoCheck,
  shouldSurfaceUpdate,
  smoothSpeed
} from '../../shared/update'
import {
  getGlobalHotkeyState,
  GLOBAL_HOTKEY_ACCELERATOR,
  probeHotkeyAccelerators,
  setGlobalHotkeyAccelerator,
  setGlobalHotkeyEnabled
} from '../hotkey'
import { getCurrentTheme, themeBackgroundColor } from '../theme'
import { checkRemindersNow, dismissReminder, getReminderWindow } from '../reminders'
import { getTrayMenuLabels } from '../tray'
import { CSV_EXPORT_HEADERS, csvExportFromBackup, formatCsvDue } from '../../shared/csvExport'
import { icsExportFromBackup } from '../../shared/icsExport'
import { SAMPLE_TASKS } from '../../shared/sampleTasks'
import { harnessContext } from './context'
import { settledFrames, waitForCondition } from './util'
import { closeSettingsAndSettle, openSettingsFor, showSettingsSection, withSettings } from './settings'
import { isSettingsWindowVisible } from '../settingsWindow'
import {
  runBackupNameAssertions,
  runCustomRecurrenceAssertions,
  runParseAssertions,
  runRecurrenceAssertions,
  runRetentionAssertions
} from './assertions'

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
    'subtasks:list',
    'subtasks:create',
    'subtasks:update',
    'subtasks:remove',
    'projects:list',
    'projects:create',
    'projects:update',
    'projects:delete',
    'tags:list',
    'tags:create',
    'tags:remove'
  ]) {
    ipcMain.removeHandler(channel)
  }
  registerIpc()
}

export async function runSmokeTest(): Promise<void> {
  const { mainWindow, backupSchema, writeFileAtomic, revealQuickCapture, revealSettings, checkUpdatesFromTray, getSettingsWindow } =
    harnessContext()
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
      // 已完成区默认折叠：勾选后行移入折叠区且不自动展开，先点开关展开再验行。
      // 主块的 waitFor 会抛错，这里用有界轮询把失败记成布尔而不是断整轮。
      let toggleFound = false;
      for (let i = 0; i < 60 && !toggleFound; i++) {
        const toggle = document.querySelector('.completed-toggle');
        if (toggle) {
          if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
          toggleFound = true;
          break;
        }
        await sleep(50);
      }
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
      const themeBgHex = { dark: '#080a0f', light: '#f4f3ef', dusk: '#132644', sand: '#ece0c6', sky: '#dceaf6', green: '#10241a' };
      const themePanelHex = { dark: '#0b0e15', light: '#fbfaf7', dusk: '#182c4e', sand: '#faf6ee', sky: '#eef6fc', green: '#163022' };
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
      for (const [a, b] of [['dark', 'light'], ['dusk', 'sky'], ['green', 'sand']]) {
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
        ['dark', 'light', 'dusk', 'sky', 'green', 'sand'].every((id, i) => menuIds[i] === id);
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
        ['夜阑', '昼白', '暮蓝', '暖砂', '天蓝', '松墨'].every((name) => paletteThemeLabels.includes('主题：' + name));
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

      // 设置已搬进独立窗口：版本号（关于页）、Esc 关窗、单例不叠窗改由主进程侧
      // 经真实侧栏入口断言（见下方 settingsWindow* 段），主窗口这里不再碰设置。

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

      // 上面切去「全部任务」再切回「今天」，展开态已按语义重置为折叠；
      // 冒烟行此刻在已完成区里，删除前先展开，删完收起再数——afterDelete
      // 与 initial 同口径（折叠态的活动行数），示例已完成行不掺进来。
      for (let i = 0; i < 60; i++) {
        const toggle = document.querySelector('.completed-toggle');
        if (toggle) {
          if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
          break;
        }
        await sleep(50);
      }
      await sleep(400);
      findRow().querySelector('.task-delete').click();
      await sleep(700);
      const toggleAfterDelete = document.querySelector('.completed-toggle');
      if (toggleAfterDelete && toggleAfterDelete.getAttribute('aria-expanded') === 'true') {
        toggleAfterDelete.click();
        await sleep(250);
      }
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
      let quickEl = document.querySelector('.quick-add input');
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
      // 注入时钟必须立刻生效：QuickAdd 的 now 是 useMemo(readNow, [nowTick])，
      // 只在重挂载或 60s tick 时重读——注入后不重挂载的话，chip 预览仍按挂载时
      // 的真实时钟解析（提交却用注入时钟），真实日期一旦越过注入周，「下周三」
      // 两边解析到不同日子，chip 标签断言就偶发红。视图往返（统计不挂 QuickAdd）
      // 强制重挂载，让 readNow 在挂载帧读到注入值；断言语义与期望字面量不变。
      [...document.querySelectorAll('.nav-item')]
        .find((el) => el.textContent.includes('统计')).click();
      await sleep(250);
      [...document.querySelectorAll('.nav-item')]
        .find((el) => el.textContent.includes('今天')).click();
      await sleep(350);
      quickEl = document.querySelector('.quick-add input');
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
      const duePast = document.querySelector('.qa-chip')?.classList.contains('past') ?? null;
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
      [...document.querySelectorAll('.project-item')].find((el) => el.textContent.includes('个人'))?.querySelector('.project-select')?.click();
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

      // (q) 英文自然语言与界面语言无关：中文界面下同样出 chip、同样剥离、同样提交
      const enQuick = document.querySelector('.quick-add input');
      const enExpectedDue = new Date(2026, 10, 13, 15, 0).toISOString();
      const enInput = '冒烟解析英文 Call mom tomorrow 3pm';
      setInput(enQuick, enInput);
      await waitFor(() => chipCount() === 1);
      await sleep(320);
      const languageParseEnChip =
        document.querySelector('.qa-chip')?.textContent?.trim() === '明天 15:00' && noticeCount() === 0;

      // 取消识别：整块时间 chip 一起失效，原文一字不动（与中文取消语义一致）
      clickWith(document.querySelector('.qa-chip'), 0);
      await waitFor(() => chipCount() === 0);
      const languageParseEnDismiss = enQuick.value === enInput;
      clickWith(document.querySelector('.qa-toggle'), 0);
      await waitFor(() => chipCount() === 1);
      await sleep(320);

      enter(enQuick);
      await sleep(700);
      const enTask = (await window.polaris.tasks.list()).find((t) => t.title === '冒烟解析英文 Call mom');
      const languageParseEnWorks = Boolean(enTask) && enTask.dueAt === enExpectedDue;

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
      // 收敛断言：字段回填与 19:20 落库是两条异步链（React effect + IPC），
      // 固定 300ms 在机器忙时会超前读数（本机复跑偶发红）。等到「字段回到 19
      // 且库里小时为 19」或超时；端态仍是断言本身，真回归照样红。
      const blurDeadline = Date.now() + 2000;
      let blurHour = -1;
      while (Date.now() < blurDeadline) {
        await sleep(50);
        blurHour = new Date(await storedDue()).getHours();
        if (hourInput().value === '19' && blurHour === 19) break;
      }
      const pickerBlurKeepsHour = hourInput().value === '19' && blurHour === 19;
      const pickerBlurDetail = {
        field: hourInput().value,
        storedHour: blurHour,
        ariaHour: hourInput().getAttribute('aria-valuenow'),
        ariaMinute: minuteInput().getAttribute('aria-valuenow')
      };
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
      // tasks:update 返回形状改为 { task, spawned }（spawned 权威透传）：
      // 断言取 .task，字段与语义与原来完全一致，覆盖不缩水。
      const done1 = (await window.polaris.tasks.update({ id: fresh.id, completed: true })).task;
      const stampSet = typeof done1.completedAt === 'string' && done1.completedAt.length > 0;
      await sleep(60);
      const edited = (await window.polaris.tasks.update({ id: fresh.id, title: '冒烟数据 完成时刻 改' })).task;
      // The whole point of the column: a later edit moves updated_at but must
      // not move completed_at.
      const stampSurvivesEdit =
        edited.completedAt === done1.completedAt && edited.updatedAt !== done1.updatedAt;
      const undone = (await window.polaris.tasks.update({ id: fresh.id, completed: false })).task;
      const stampClearedOnUndo = undone.completedAt === null;
      await sleep(60);
      const done2 = (await window.polaris.tasks.update({ id: fresh.id, completed: true })).task;
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
      // 同上：tasks:update 新返回形状取 .task，断言语义不变。
      const recurDone = (await window.polaris.tasks.update({ id: recur.id, completed: true })).task;
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
        // 诊断字段：失败时直接从结果 JSON 看到实际 chip 标签与过期标记，
        // 不必再盲猜是时钟注入没生效还是标签格式变了。
        parseDueLabel: dueLabel ?? null,
        parseDuePast: duePast,
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
        languageParseEnChip,
        languageParseEnDismiss,
        languageParseEnWorks,
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
        pickerBlurDetail,
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
          // 已完成区默认折叠：勾选后行卸载，点开关展开恰好强制重新挂载——
          // reduce 下的入场路径正是靠这次重挂载走到（比旧实现更真实）。
          let toggle = null;
          for (let i = 0; i < 60 && !toggle; i++) {
            toggle = document.querySelector('.completed-toggle');
            if (!toggle) await sleep(50);
          }
          if (!toggle) return false;
          if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
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
    const backupNameOk = runBackupNameAssertions()

    // 本地 MCP：开启 → 经 IPC 取 bearer token → initialize / tools/list / tools/call
    // 真实 HTTP 往返 → 401 矩阵（无/错 token）→ regenerate 作废旧 token → 关闭后拒连。
    let mcpWorks = false
    let mcpAuthRejects = false
    let mcpTokenRegenerate = false
    let mcpFixtureId: string | null = null
    try {
      setMcpEnabled(true)
      const deadline = Date.now() + 3000
      while (Date.now() < deadline && !getMcpState().running && !getMcpState().error) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (getMcpState().running) {
        // token 走真实 IPC 通道（renderer → preload → main），不直调模块函数：
        // 顺带验证 app:mcp-token-get / app:mcp-token-regenerate 的接线。
        let activeToken = (await mainWindow.webContents.executeJavaScript(
          'window.polaris.app.getMcpToken()'
        )) as string
        const rpc = async (method: string, params: Record<string, unknown>, id: number) => {
          const res = await fetch(MCP_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeToken}` },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
          })
          return (await res.json()) as { result?: Record<string, any> }
        }
        const toolText = (response: { result?: Record<string, any> }): string =>
          (response.result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? '{}'
        const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } }, 1)
        const list = await rpc('tools/list', {}, 2)
        const created = await rpc('tools/call', { name: 'create_task', arguments: { title: '冒烟MCP任务', priority: 2 } }, 3)
        const createdTask = JSON.parse(toolText(created)) as { id?: string }
        mcpFixtureId = createdTask.id ?? null
        const listed = await rpc('tools/call', { name: 'list_tasks', arguments: {} }, 4)
        const tasks = JSON.parse(toolText(listed)) as Array<{ id: string }>
        const completed = await rpc('tools/call', { name: 'complete_task', arguments: { id: mcpFixtureId } }, 5)
        const doneTask = JSON.parse(toolText(completed)) as { completed?: boolean }
        const getRes = await fetch(MCP_ENDPOINT)
        // 拒绝矩阵：用 node:http 精确控制请求头（fetch 不允许覆盖 Host）。
        // Origin 一律 403；非回环 Host 403（DNS rebinding）；非 JSON 415；
        // 过了三重校验后无/错 Bearer token 401。
        const probe = (headers: Record<string, string>): Promise<number> =>
          new Promise((resolve, reject) => {
            const req = httpRequest(
              {
                host: '127.0.0.1',
                port: MCP_PORT,
                path: '/mcp',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers }
              },
              (res) => {
                res.resume()
                resolve(res.statusCode ?? 0)
              }
            )
            req.on('error', reject)
            req.end(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }))
          })
        const originStatus = await probe({ Origin: 'https://evil.example' })
        const hostStatus = await probe({ Host: `evil.example:${MCP_PORT}` })
        const plainStatus = await probe({ 'Content-Type': 'text/plain' })
        // 401 矩阵：无 token / 错 token / 非 Bearer scheme 一律 401。
        const noTokenStatus = await probe({})
        const wrongTokenStatus = await probe({ Authorization: 'Bearer not-the-token' })
        const wrongSchemeStatus = await probe({ Authorization: `Basic ${activeToken}` })
        mcpAuthRejects =
          noTokenStatus === 401 && wrongTokenStatus === 401 && wrongSchemeStatus === 401
        if (!mcpAuthRejects) {
          console.error('MCP_AUTH_FAIL', JSON.stringify({ noTokenStatus, wrongTokenStatus, wrongSchemeStatus }))
        }
        // token 形状与持久性：sk- 前缀 + 64 位 hex，重复读取同值（重启不变的同一存储路径）。
        const tokenAgain = (await mainWindow.webContents.executeJavaScript(
          'window.polaris.app.getMcpToken()'
        )) as string
        const tokenStable = /^sk-[0-9a-f]{64}$/.test(activeToken) && tokenAgain === activeToken
        // regenerate：旧 token 立即 401，新 token initialize 200。
        const oldToken = activeToken
        activeToken = (await mainWindow.webContents.executeJavaScript(
          'window.polaris.app.regenerateMcpToken()'
        )) as string
        const oldTokenStatus = await probe({ Authorization: `Bearer ${oldToken}` })
        const reinit = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } }, 7)
        mcpTokenRegenerate =
          /^sk-[0-9a-f]{64}$/.test(activeToken) &&
          activeToken !== oldToken &&
          oldTokenStatus === 401 &&
          (reinit.result?.serverInfo as { name?: string } | undefined)?.name === 'polaris'
        if (!mcpTokenRegenerate) {
          console.error('MCP_REGEN_FAIL', JSON.stringify({ oldTokenStatus, reinit: reinit.result }))
        }
        // 入参校验对齐 IPC：越界 priority 拒绝（isError），不落库。
        // 放在 regenerate 之后：顺带证明新 token 的 tools/call 也通。
        const badPriority = await rpc('tools/call', { name: 'create_task', arguments: { title: '冒烟MCP越界', priority: 9 } }, 6)
        const badPriorityRejected =
          (badPriority.result as { isError?: boolean } | undefined)?.isError === true &&
          !listTasks().some((task) => task.title === '冒烟MCP越界')
        mcpWorks =
          (init.result?.serverInfo as { name?: string } | undefined)?.name === 'polaris' &&
          Array.isArray(list.result?.tools) &&
          (list.result?.tools as unknown[]).length === 8 &&
          Boolean(mcpFixtureId) &&
          tasks.some((task) => task.id === mcpFixtureId) &&
          doneTask.completed === true &&
          getRes.status === 405 &&
          originStatus === 403 &&
          hostStatus === 403 &&
          plainStatus === 415 &&
          tokenStable &&
          badPriorityRejected
        if (!mcpWorks) {
          console.error('MCP_FAIL', JSON.stringify({ init: init.result, toolCount: (list.result?.tools as unknown[] | undefined)?.length, created: created.result, doneTask, getStatus: getRes.status, originStatus, hostStatus, plainStatus, tokenStable, badPriorityRejected }))
        }
      } else {
        console.error('MCP_START_FAIL', JSON.stringify(getMcpState()))
      }
    } catch (error) {
      console.error('MCP_ERROR', error)
    } finally {
      if (mcpFixtureId) {
        deleteTask(mcpFixtureId)
        deleteTaskForever(mcpFixtureId)
      }
      setMcpEnabled(false)
      const stopDeadline = Date.now() + 2000
      while (Date.now() < stopDeadline && getMcpState().running) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      let refused = false
      try {
        await fetch(MCP_ENDPOINT)
      } catch {
        refused = true
      }
      mcpWorks = mcpWorks && refused
    }

    const recurrenceOk = runRecurrenceAssertions()
    const customRecurrenceOk = runCustomRecurrenceAssertions()

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
      // 已完成区默认折叠：依赖已完成行 DOM 的断言先走这里展开。
      // 幂等——已展开时不点（再点会收回去），开关缺席（N=0）返回 false。
      const expandCompleted = async () => {
        const toggle = await waitFor(() => document.querySelector('.completed-toggle'));
        if (!toggle) return false;
        if (toggle.getAttribute('aria-expanded') === 'false') {
          toggle.click();
          await sleep(400);
        }
        return true;
      };
      // 收起已完成区：行卸载后计数类断言才不受展开态影响。同样幂等。
      const collapseCompleted = async () => {
        const toggle = document.querySelector('.completed-toggle');
        if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
          toggle.click();
          await sleep(250);
        }
      };
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
        // 重试成功后行进入默认折叠的已完成区：先展开再验 .done 终态。
        await expandCompleted();
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
          // 修订号门控后 focus 只在号变化时才重拉：先真写一条（tasks:create
          // 未被摘，触发器跳号）再 focus，保证 load 真的发起并撞上被摘的通道。
          await window.polaris.tasks.create({ title: '冒烟读失败 探针', dueAt: null, projectId: null });
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
        // 探针清场：软删进回收站，由下方回收站链开头的硬删清扫统一处理。
        const probe = (await window.polaris.tasks.list()).find((t) => t.title === '冒烟读失败 探针');
        if (probe) await window.polaris.tasks.remove(probe.id);
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
          // 同 storageLoadError：修订号门控后先真写一条跳号，focus 才会发起
          // 两个读并双双撞上被摘的通道（tasks:create 未被摘）。
          await window.polaris.tasks.create({ title: '冒烟双读失败 探针', dueAt: null, projectId: null });
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
        // 上一次 load 失败没盖章，号与盖章不同 → 这次 focus 门自然打开。
        window.dispatchEvent(new Event('focus'));
        const cleared = await waitFor(() => !errorToast());
        // 探针清场：软删 + 硬删一步到位，不给后面的回收站断言留计数污染。
        const probe = (await window.polaris.tasks.list()).find((t) => t.title === '冒烟双读失败 探针');
        if (probe) {
          await window.polaris.tasks.remove(probe.id);
          await window.polaris.tasks.deleteForever(probe.id);
        }
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
        const flippedTheme = await reminder.webContents.executeJavaScript(
          `document.documentElement.dataset.theme`
        )
        const flipWant = ({ dark: [11, 14, 21], light: [251, 250, 247], dusk: [24, 44, 78], sand: [250, 246, 238], sky: [238, 246, 252], green: [234, 247, 236] } as Record<string, number[]>)[flipped] ?? [11, 14, 21]
        // View Transitions 的 cross-fade 使绘制收敛晚于 dataset.theme。跨窗主题跟随
        // 是收敛断言：轮询真实绘制像素直到匹配新主题，而非等 DOM 状态后单次采样。
        let converged: NativeImage | null = null
        const flipPainted = await waitForCondition(async () => {
          if (reminder.isDestroyed() || reminder.webContents.isDestroyed()) return false
          const img = await reminder.webContents.capturePage()
          const sz = img.getSize()
          const px = img
            .crop({ x: sz.width - 6, y: Math.floor(sz.height / 2), width: 1, height: 1 })
            .toBitmap()
          const match =
            Math.abs(px[2] - flipWant[0]) <= 1 &&
            Math.abs(px[1] - flipWant[1]) <= 1 &&
            Math.abs(px[0] - flipWant[2]) <= 1
          if (match) converged = img
          return match
        }, 3000, 60)
        const flippedImage = converged ?? (await reminder.webContents.capturePage())
        const flippedSize = flippedImage.getSize()
        const fp = flippedImage
          .crop({ x: flippedSize.width - 6, y: Math.floor(flippedSize.height / 2), width: 1, height: 1 })
          .toBitmap()
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

    // 稍后档位：展开 10/30/60 三档，选 30 分钟 → remindAt≈now+30min 且提醒窗关闭。
    let reminderSnoozeWorks = false
    let snoozeTaskId: string | null = null
    try {
      snoozeTaskId = await mainWindow?.webContents.executeJavaScript(`(async () => {
        const task = await window.polaris.tasks.create({ title: '冒烟稍后档位', dueAt: new Date(Date.now() + 3600000).toISOString(), projectId: null });
        await window.polaris.tasks.update({ id: task.id, remindAt: new Date(Date.now() - 60000).toISOString() });
        return task.id;
      })()`)
      checkRemindersNow()
      await waitForCondition(() => Boolean(getReminderWindow()), 8000, 150)
      const snoozeReminder = getReminderWindow()
      if (snoozeReminder && snoozeTaskId) {
        await waitForCondition(async () => {
          if (snoozeReminder.isDestroyed() || snoozeReminder.webContents.isDestroyed()) return false
          return Boolean(await snoozeReminder.webContents.executeJavaScript(`Boolean(document.querySelector('.reminder-secondary'))`))
        }, 8000)
        await snoozeReminder.webContents.executeJavaScript(`(() => {
          const btn = [...document.querySelectorAll('.reminder-secondary')].find((b) => b.textContent.includes('稍后'));
          btn?.click();
        })()`)
        const tiersShown = await waitForCondition(async () => {
          if (snoozeReminder.isDestroyed() || snoozeReminder.webContents.isDestroyed()) return false
          return Boolean(await snoozeReminder.webContents.executeJavaScript(`document.querySelectorAll('.reminder-snooze-tier').length === 3`))
        }, 4000)
        const before = Date.now()
        await snoozeReminder.webContents.executeJavaScript(`(() => {
          const btn = [...document.querySelectorAll('.reminder-snooze-tier')].find((b) => b.textContent.includes('30'));
          btn?.click();
        })()`)
        const dismissed = await waitForCondition(() => !getReminderWindow(), 8000, 150)
        const storedRemindAt = await mainWindow?.webContents.executeJavaScript(`window.polaris.tasks.list().then((ts) => ts.find((t) => t.id === ${JSON.stringify(snoozeTaskId)})?.remindAt ?? null)`)
        const deltaMin = storedRemindAt ? (new Date(storedRemindAt).getTime() - before) / 60000 : -1
        reminderSnoozeWorks = Boolean(tiersShown && dismissed && deltaMin >= 29 && deltaMin <= 31)
        if (!reminderSnoozeWorks) console.error('REMINDER_SNOOZE_FAIL', JSON.stringify({ tiersShown, dismissed, deltaMin }))
      }
    } catch (error) {
      console.error('REMINDER_SNOOZE_ERROR', error)
    } finally {
      dismissReminder()
      if (snoozeTaskId) {
        await mainWindow?.webContents.executeJavaScript(`window.polaris.tasks.remove(${JSON.stringify(snoozeTaskId)}).then(() => window.polaris.tasks.deleteForever(${JSON.stringify(snoozeTaskId)}))`)
      }
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

    // 已完成区默认折叠（completedCollapsedByDefault）：紧跟空态断言之后，
    // 此刻库是空的、视图在「今天」，计数可以从 0 起步钉死字面量。
    // 链条：N=0 整区隐藏 → 折叠态勾选计数 +1 且不自动展开 → 再勾一条计数 2
    // 仍折叠 → 展开后两行可见带 .done → 收起后行卸载（非视觉隐藏）→
    // 展开后切视图再切回，重置为折叠。自建自清：种子任务软删 + 硬删。
    const completedCollapsedByDefault =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const due = new Date(); due.setHours(23, 59, 0, 0);
        const ids = [];
        const toggle = () => document.querySelector('.completed-toggle');
        try {
          // N=0：整区隐藏，连折叠开关都不挂。
          const hiddenAtZero = !toggle();
          const a = await window.polaris.tasks.create({ title: '冒烟折叠 甲', dueAt: due.toISOString(), projectId: null });
          ids.push(a.id);
          window.dispatchEvent(new Event('focus'));
          if (!(await waitFor(() => findRow('冒烟折叠 甲')))) return false;
          findRow('冒烟折叠 甲').querySelector('.task-check').click();
          // 等退场弹簧收敛、行真正卸载，再验折叠态（退出中的节点还在 DOM）。
          if (!(await waitFor(() => !findRow('冒烟折叠 甲')))) return false;
          const collapsedAfterDone = Boolean(toggle()) &&
            toggle().getAttribute('aria-expanded') === 'false' &&
            toggle().textContent.includes('已完成 1 条');
          const b = await window.polaris.tasks.create({ title: '冒烟折叠 乙', dueAt: due.toISOString(), projectId: null });
          ids.push(b.id);
          window.dispatchEvent(new Event('focus'));
          if (!(await waitFor(() => findRow('冒烟折叠 乙')))) return false;
          findRow('冒烟折叠 乙').querySelector('.task-check').click();
          if (!(await waitFor(() => !findRow('冒烟折叠 乙')))) return false;
          const countTwo = Boolean(await waitFor(() => toggle()?.textContent.includes('已完成 2 条')));
          const stillCollapsed =
            toggle().getAttribute('aria-expanded') === 'false' && !findRow('冒烟折叠 甲');
          // 展开：两条已完成行可见且带 .done，aria-expanded 翻真。
          toggle().click();
          const expandedShown = Boolean(await waitFor(() =>
            ['冒烟折叠 甲', '冒烟折叠 乙'].every((t) => findRow(t)?.classList.contains('done')) &&
            toggle().getAttribute('aria-expanded') === 'true'));
          // 收起：行卸载出 DOM，开关回到折叠态。
          toggle().click();
          const collapsedUnmounted = Boolean(await waitFor(() =>
            !findRow('冒烟折叠 甲') && !findRow('冒烟折叠 乙') &&
            toggle().getAttribute('aria-expanded') === 'false'));
          // 切视图重置：展开后切「全部任务」再切回「今天」，回到折叠。
          toggle().click();
          if (!(await waitFor(() => toggle().getAttribute('aria-expanded') === 'true'))) return false;
          [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
          if (!(await waitFor(() => document.querySelector('.view-title')?.textContent.trim() === '全部任务'))) return false;
          [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天')).click();
          const resetOnViewSwitch = Boolean(await waitFor(() =>
            document.querySelector('.view-title')?.textContent.trim() === '今天' &&
            toggle()?.getAttribute('aria-expanded') === 'false'));
          return hiddenAtZero && collapsedAfterDone && countTwo && stillCollapsed &&
            expandedShown && collapsedUnmounted && resetOnViewSwitch;
        } finally {
          for (const id of ids) {
            try { await window.polaris.tasks.remove(id); } catch {}
            try { await window.polaris.tasks.deleteForever(id); } catch {}
          }
          window.dispatchEvent(new Event('focus'));
          await sleep(300);
        }
      })()`)) === true
    if (!completedCollapsedByDefault) console.error('COMPLETED_COLLAPSE_FAIL')

    // 统计视图入口：命令面板直达「统计」，空库时先给空态（完成记录为 0）。
    const statsViewOpens =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const navStats = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('统计'));
        if (!navStats) return false;
        document.querySelector('.search-trigger').click();
        if (!(await waitFor(() => document.querySelector('.command-input')))) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(document.querySelector('.command-input'), '统计');
        document.querySelector('.command-input').dispatchEvent(new Event('input', { bubbles: true }));
        const item = await waitFor(() => document.querySelector('.command-item'));
        if (!item || !item.textContent.includes('统计')) return false;
        item.click();
        const titled = await waitFor(() => document.querySelector('.view-title')?.textContent?.trim() === '统计');
        const empty = document.querySelector('.empty-title')?.textContent === '还没有完成记录';
        const cta = document.querySelector('.empty-cta')?.textContent === '查看今天';
        return Boolean(titled) && empty && cta;
      })()`)) === true

    // 迁移 4 之前完成的任务 completedAt 为 NULL：用备份导入造一条真实的历史行，
    // 它只能进累计与项目分布，不能进今日/趋势/按时率。
    const statsLegacyAt = new Date().toISOString()
    importBackup({
      projects: [],
      tasks: [
        {
          id: randomUUID(),
          title: '冒烟统计 早期',
          notes: '',
          completed: true,
          completedAt: null,
          dueAt: null,
          startAt: null,
          endAt: null,
          allDay: false,
          remindAt: null,
          remindedAt: null,
          recurrenceRule: null,
          projectId: null,
          priority: 0,
          createdAt: statsLegacyAt,
          updatedAt: statsLegacyAt,
          deletedAt: null
        }
      ]
    })

    // 统计数字：4 条今日完成（按时/逾期各 1、无截止 2）+ 1 条无时刻的历史行。
    // 期望值全部写字面量：今天 4 / 本周 4 / 累计 5 / 按时 50% / 项目 2·40% / 无项目 3·60%。
    const statsResult =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const project = await window.polaris.projects.create({ name: '冒烟统计项目', color: '#5EEAD4' });
        const now = Date.now();
        const addDone = async (title, offset, projectId) => {
          const task = await window.polaris.tasks.create({
            title,
            dueAt: offset === null ? null : new Date(now + offset).toISOString(),
            projectId
          });
          await window.polaris.tasks.update({ id: task.id, completed: true });
        };
        let firstPass = false;
        let thirty = false;
        let backSeven = false;
        try {
          await addDone('冒烟统计 按时', 3600000, project.id);
          await addDone('冒烟统计 逾期', -3600000, project.id);
          await addDone('冒烟统计 无截止甲', null, null);
          await addDone('冒烟统计 无截止乙', null, null);
          window.dispatchEvent(new Event('focus'));
          const kpi = (name) => document.querySelector('.stats-kpi[data-stat="' + name + '"] .stats-kpi-value')?.textContent?.trim();
          const ready = await waitFor(() => kpi('total') === '5');
          const rows = [...document.querySelectorAll('.stats-dist-row')];
          const projectRow = rows.find((el) => el.dataset.dist === project.id);
          const noneRow = rows.find((el) => el.dataset.dist === 'none');
          firstPass =
            Boolean(ready) &&
            kpi('today') === '4' &&
            kpi('week') === '4' &&
            kpi('total') === '5' &&
            kpi('ontime') === '50%' &&
            projectRow?.querySelector('.stats-dist-count')?.textContent?.trim() === '2 · 40%' &&
            noneRow?.querySelector('.stats-dist-count')?.textContent?.trim() === '3 · 60%' &&
            document.querySelector('.stats-note')?.textContent.includes('共 1 项') === true &&
            document.querySelectorAll('.stats-chart[data-range="7"] .stats-bar-col').length === 7 &&
            document.querySelector('.stats-chart .stats-bar-col:last-child .stats-bar')?.dataset.count === '4' &&
            !document.querySelector('.quick-add')
          const rangeButton = (label) => [...document.querySelectorAll('.stats-range button')].find((b) => b.textContent.startsWith(label));
          rangeButton('30').click();
          thirty =
            (await waitFor(() => document.querySelectorAll('.stats-chart[data-range="30"] .stats-bar-col').length === 30)) &&
            document.querySelectorAll('.stats-chart-axis[data-range="30"] span').length === 30
          rangeButton('7').click();
          backSeven = await waitFor(() => document.querySelectorAll('.stats-chart[data-range="7"] .stats-bar-col').length === 7)
        } finally {
          for (const t of (await window.polaris.tasks.list()).filter((task) => task.title.startsWith('冒烟统计'))) {
            await window.polaris.tasks.remove(t.id);
          }
          for (const t of (await window.polaris.tasks.listDeleted()).filter((task) => task.title.startsWith('冒烟统计'))) {
            await window.polaris.tasks.deleteForever(t.id);
          }
          await window.polaris.projects.remove(project.id);
          window.dispatchEvent(new Event('focus'));
        }
        return { firstPass, thirty, backSeven };
      })()`)) as { firstPass: boolean; thirty: boolean; backSeven: boolean } | null
    const statsNumbersCorrect = statsResult?.firstPass === true
    const statsRangeToggle = statsResult?.thirty === true && statsResult?.backSeven === true

    // 项目管理闭环：UI 改名 → 任务仍映射；UI 删除（确认弹窗）→ 任务归「无项目」（外键 SET NULL）。
    const projectManageWorks =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const setInput = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const project = await window.polaris.projects.create({ name: '冒烟项目甲', color: '#5EEAD4' });
        const due = new Date(); due.setHours(23, 59, 0, 0);
        const task = await window.polaris.tasks.create({ title: '冒烟项目任务', dueAt: due.toISOString(), projectId: project.id });
        window.dispatchEvent(new Event('focus'));
        if (!(await waitFor(() => [...document.querySelectorAll('.project-item .nav-text')].some((el) => el.textContent === '冒烟项目甲')))) return false;
        const row = [...document.querySelectorAll('.project-item')].find((el) => el.textContent.includes('冒烟项目甲'));
        row.querySelector('.project-action[aria-label^="编辑项目"]').click();
        const editInput = await waitFor(() => document.querySelector('input[name="edit-project-name"]'));
        if (!editInput) return false;
        setInput(editInput, '冒烟项目乙');
        [...document.querySelectorAll('.project-form-actions button')].find((b) => b.textContent === '保存').click();
        const renamed = await waitFor(() => [...document.querySelectorAll('.project-item .nav-text')].some((el) => el.textContent === '冒烟项目乙'));
        const taskStillMapped = (await window.polaris.tasks.list()).find((t) => t.id === task.id)?.projectId === project.id;
        const row2 = [...document.querySelectorAll('.project-item')].find((el) => el.textContent.includes('冒烟项目乙'));
        row2.querySelector('.project-action-danger').click();
        const dialog = await waitFor(() => document.querySelector('.confirm-panel'));
        [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === '删除项目').click();
        const removed = await waitFor(() => ![...document.querySelectorAll('.project-item .nav-text')].some((el) => el.textContent === '冒烟项目乙'));
        const taskOrphaned = (await window.polaris.tasks.list()).find((t) => t.id === task.id)?.projectId === null;
        await window.polaris.tasks.remove(task.id);
        await window.polaris.tasks.deleteForever(task.id);
        return renamed && taskStillMapped && Boolean(dialog) && removed && taskOrphaned;
      })()`)) === true

    // 完成时刻展示：已完成视图行 + 详情信息行显示「完成于」，取消完成后信息行消失。
    const completedAtShown =
      (await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const due = new Date(); due.setHours(23, 59, 0, 0);
        const task = await window.polaris.tasks.create({ title: '冒烟完成时刻', dueAt: due.toISOString(), projectId: null });
        await window.polaris.tasks.toggle(task.id, true);
        window.dispatchEvent(new Event('focus'));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('已完成')).click();
        window.dispatchEvent(new Event('focus'));
        // 已完成视图同样默认折叠（completedForView 覆盖的所有视图统一行为）：
        // 先展开折叠区再验行内「完成于」。
        await expandCompleted();
        const rowShown = await waitFor(() => {
          const row = findRow('冒烟完成时刻');
          return row && row.querySelector('.meta-completed')?.textContent.includes('完成于');
        });
        if (!rowShown) return false;
        findRow('冒烟完成时刻').querySelector('.task-open').click();
        const detailShown = await waitFor(() => document.querySelector('.detail-completed-at')?.textContent.includes('完成于'));
        await window.polaris.tasks.toggle(task.id, false);
        window.dispatchEvent(new Event('focus'));
        const hiddenAfterUncomplete = await waitFor(() => !document.querySelector('.detail-completed-at'));
        await window.polaris.tasks.remove(task.id);
        await window.polaris.tasks.deleteForever(task.id);
        return Boolean(detailShown) && hiddenAfterUncomplete;
      })()`)) === true

    // 检查清单 UI：详情里添加两条 → 勾选一条 → 行内改名 → 删一条 → 硬删父任务。
    // 进度字面量同时验详情区与任务行徽标；持久性用 API 重新读库验证。
    const subtaskUiResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      let step = 'create';
      const due = new Date(); due.setHours(23, 59, 0, 0);
      const task = await window.polaris.tasks.create({ title: '冒烟子任务', dueAt: due.toISOString(), projectId: null });
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const pressEnter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      try {
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
        window.dispatchEvent(new Event('focus'));
        step = 'row';
        if (!(await waitFor(() => findRow('冒烟子任务')))) throw new Error('row not found');
        findRow('冒烟子任务').querySelector('.task-title').click();
        step = 'detail';
        if (!(await waitFor(() => document.querySelector('[data-subtask-add]')))) throw new Error('add input not found');
        const add = document.querySelector('[data-subtask-add]');
        setInput(add, '子任务甲'); pressEnter(add);
        setInput(add, '子任务乙'); pressEnter(add);
        step = 'rows';
        if (!(await waitFor(() => document.querySelectorAll('[data-subtask-id]').length === 2))) throw new Error('rows not 2');
        // 等异步读取落定再动手：焦点触发的 load() 若晚到，旧快照会把乐观更新的
        // 计数打回去。连续两次进度读数相同才算稳（同 measureStrip 的视口稳定模式）。
        let lastProgress = '';
        await waitFor(() => {
          const now = document.querySelector('[data-subtask-progress]')?.textContent.trim() ?? '';
          const stable = now !== '' && now === lastProgress;
          lastProgress = now;
          return stable;
        });
        const progress0 = document.querySelector('[data-subtask-progress]')?.textContent.trim();
        const badge0 = findRow('冒烟子任务').querySelector('[data-subtask-badge]')?.textContent.trim();
        step = 'toggle';
        document.querySelectorAll('.checklist-check')[0].click();
        if (!(await waitFor(() => document.querySelector('[data-subtask-progress]')?.textContent.trim() === '1/2'))) {
          const diag = {
            progressNow: document.querySelector('[data-subtask-progress]')?.textContent.trim(),
            pressed: document.querySelectorAll('.checklist-check')[0]?.getAttribute('aria-pressed'),
            toast: document.querySelector('.toast-error .toast-message')?.textContent ?? null,
            dbRows: await window.polaris.subtasks.list(task.id),
            parent: (await window.polaris.tasks.list()).find((t) => t.id === task.id)
          };
          throw new Error('progress not 1/2 DIAG=' + JSON.stringify(diag));
        }
        const badge1 = findRow('冒烟子任务').querySelector('[data-subtask-badge]')?.textContent.trim();
        const checkPressed = document.querySelectorAll('.checklist-check')[0].getAttribute('aria-pressed') === 'true';
        step = 'rename';
        const titleInput = document.querySelectorAll('.checklist-title')[1];
        titleInput.focus();
        setInput(titleInput, '子任务乙改');
        pressEnter(titleInput);
        // Enter 的提交链是 keydown → blur() → onBlur=commit。冒烟窗口在忙碌桌面上
        // 会被别的应用抢走 OS 焦点：无焦点窗口里 Chromium 把 activeElement 静默重置
        // 为 body（不发 focusout），blur() 成 no-op，提交链断。补一个冒泡 focusout
        // 完成聚焦窗口下 Enter 本会产生的 onBlur 提交；聚焦窗口里幂等无害（落库后
        // title 已相同，再提交是 no-op）。
        titleInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        // 重命名走 React state → IPC → SQLite：高负载下死 sleep(250) 等不到落库就
        // 假红（waitFor 不 await 异步 fn，Promise 恒真不能用）。显式有界轮询 DB
        // 直到新标题落定，超时仍红则抛诊断现场。
        let afterRename = await window.polaris.subtasks.list(task.id);
        const renameDeadline = Date.now() + 6000;
        while (!afterRename.some((s) => s.title === '子任务乙改') && Date.now() < renameDeadline) {
          await sleep(50);
          afterRename = await window.polaris.subtasks.list(task.id);
        }
        const renamed = afterRename.some((s) => s.title === '子任务乙改');
        step = 'persist';
        const parent = (await window.polaris.tasks.list()).find((t) => t.id === task.id);
        const persisted =
          afterRename.length === 2 &&
          afterRename.filter((s) => s.completed).length === 1 &&
          parent?.subtaskTotal === 2 &&
          parent?.subtaskDone === 1;
        step = 'remove';
        document.querySelectorAll('.checklist-remove')[1].click();
        if (!(await waitFor(() => document.querySelectorAll('[data-subtask-id]').length === 1))) throw new Error('rows not 1 after remove');
        const progress2 = document.querySelector('[data-subtask-progress]')?.textContent.trim();
        const badge2 = findRow('冒烟子任务').querySelector('[data-subtask-badge]')?.textContent.trim();
        const remaining = (await window.polaris.subtasks.list(task.id)).map((s) => s.title).join('|');
        step = 'purge';
        await window.polaris.tasks.remove(task.id);
        await window.polaris.tasks.deleteForever(task.id);
        const purged = (await window.polaris.subtasks.list(task.id)).length === 0;
        const rowProgress = progress0 === '0/2' && badge0 === '0/2' && progress2 === '1/1' && badge2 === '1/1';
        const detailChain = progress0 === '0/2' && progress2 === '1/1' && checkPressed;
        return {
          rowProgress,
          detailChain,
          renamed,
          persisted,
          purged,
          step,
          progress0,
          badge0,
          badge1,
          progress2,
          badge2,
          remaining,
          parentTotal: parent?.subtaskTotal,
          parentDone: parent?.subtaskDone
        };
      } catch (error) {
        return { step, error: String(error) };
      } finally {
        try { await window.polaris.tasks.remove(task.id); } catch {}
        try { await window.polaris.tasks.deleteForever(task.id); } catch {}
      }
    })()`)
    const subtaskRowProgress = subtaskUiResult?.rowProgress === true
    const subtaskDetailChain = subtaskUiResult?.detailChain === true
    const subtaskRenamed = subtaskUiResult?.renamed === true
    const subtaskPersisted = subtaskUiResult?.persisted === true
    const subtaskPurged = subtaskUiResult?.purged === true
    if (!subtaskRowProgress || !subtaskDetailChain || !subtaskRenamed || !subtaskPersisted || !subtaskPurged) {
      console.error('SUBTASK_UI_FAIL', JSON.stringify(subtaskUiResult))
    }

    // ---------- focus 修订号门控（迁移 7 触发器 + data:revision） ----------
    // 主进程侧计数探针：tasks:list / tasks:list-deleted 包一层计数，行为与生产
    // 一致（list-deleted 保留 purge 语义），照 resetTaskIpc 的摘装手法恢复。
    // 三段：无变化 focus 不重拉；DB 直写（与 MCP/备份外部写入同一条触发器路径）
    // 后 focus 重拉且 UI 可见；外部写入之后再做自有 UI 写，focus 仍必须重拉并
    // 显示那行外部任务（自有写入不再拿全局号盖章，免得把未拉取的写入盖住）。
    let focusRevisionGate = false
    let focusGateListCalls = 0
    let focusGateTrashCalls = 0
    if (mainWindow) {
      const wc = mainWindow.webContents
      ipcMain.removeHandler('tasks:list')
      ipcMain.handle('tasks:list', () => {
        focusGateListCalls += 1
        return listTasks()
      })
      ipcMain.removeHandler('tasks:list-deleted')
      ipcMain.handle('tasks:list-deleted', () => {
        focusGateTrashCalls += 1
        purgeExpiredDeleted(new Date().toISOString())
        return listDeletedTasks()
      })
      try {
        // 静场：先 focus 一次把盖章与修订号对齐（前段清场是 API 直写，号已跳，
        // 这次会拉），等 fire-and-forget 盖章与在途读全部落地再取基线。
        await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          await sleep(500);
        })()`)
        const baseList = focusGateListCalls
        const baseTrash = focusGateTrashCalls
        // 1) 无变化 focus：门必须关着，两条读通道都不得被调用。真实 OS focus
        // 事件插进来也无害——同样过门，号没变就不拉（门控天然抗焦点噪声）。
        await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('focus'));
          await sleep(450);
        })()`)
        const gateStaysClosed = focusGateListCalls === baseList && focusGateTrashCalls === baseTrash
        // 2) DB 直写绕过渲染层（触发器跳号）→ focus 必须重拉且 UI 可见。
        const gateDue = new Date()
        gateDue.setHours(23, 59, 0, 0)
        const gateProbe = createTask({ title: '冒烟修订门 探针', dueAt: gateDue.toISOString() })
        const gateExternalShown = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          return Boolean(await waitFor(() => findRow('冒烟修订门 探针')));
        })()`)
        const gateExternalPulled = focusGateListCalls > baseList && focusGateTrashCalls > baseTrash
        // 3) 外部写入（直接 DB 建行）之后再做一个自有 UI 写（勾选探针）：
        //    旧实现会在自有写成功后拿全局号盖章，把刚写入的外部行一并盖住，
        //    后续 focus 永远跳过。现在 focus 必须重拉并显示这行。
        const gateHidden = createTask({ title: '冒烟修订门 外部行', dueAt: gateDue.toISOString() })
        await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          findRow('冒烟修订门 探针').querySelector('.task-check').click();
          await waitFor(() => !findRow('冒烟修订门 探针'));
          await sleep(450);
        })()`)
        const baseList2 = focusGateListCalls
        const baseTrash2 = focusGateTrashCalls
        const gateHiddenShown = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          return Boolean(await waitFor(() => findRow('冒烟修订门 外部行')));
        })()`)
        const gateOwnWritePulls = focusGateListCalls > baseList2 && focusGateTrashCalls > baseTrash2
        focusRevisionGate =
          gateStaysClosed && Boolean(gateExternalShown) && gateExternalPulled && Boolean(gateHiddenShown) && gateOwnWritePulls
        if (!focusRevisionGate) {
          console.error('FOCUS_GATE_FAIL', JSON.stringify({
            gateStaysClosed, gateExternalShown: Boolean(gateExternalShown), gateExternalPulled, gateHiddenShown: Boolean(gateHiddenShown), gateOwnWritePulls
          }))
        }
        // 清场：两行探针软删 + 硬删，focus 同步（号跳会拉，属预期行为）。
        deleteTask(gateProbe.id)
        deleteTaskForever(gateProbe.id)
        deleteTask(gateHidden.id)
        deleteTaskForever(gateHidden.id)
        await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          await sleep(350);
        })()`)
      } finally {
        resetTaskIpc()
      }
    }

    // ---------- 子任务字段级回滚（与 runUpdate 同构的并发竞态防护） ----------
    // A（仅改名）被带闸门的 handler 拦截：乐观已应用、IPC 停在闸门上；B（仅
    // 勾选）直通真实 DB 成功落定——模拟并发成功写入。放行 A 令其失败：字段级
    // 回滚只还原 title，B 的 completed 必须存活；整行回滚会把它抹掉（旧缺陷）。
    let subtaskFieldRollback = false
    if (mainWindow) {
      const wc = mainWindow.webContents
      let releaseSubtaskFail: (() => void) | null = null
      const subtaskFailGate = new Promise<void>((resolve) => {
        releaseSubtaskFail = resolve
      })
      ipcMain.removeHandler('subtasks:update')
      ipcMain.handle('subtasks:update', async (_event, input: { id: string; title?: string; completed?: boolean }) => {
        // 只拦「仅改名」的 A；「仅勾选」的 B 直通生产同一个 DB 函数。
        if (input && input.title !== undefined && input.completed === undefined) {
          await subtaskFailGate
          throw new Error('冒烟注入：子任务改名失败')
        }
        return updateSubtask(input)
      })
      let raceParentId: string | null = null
      try {
        const raceDue = new Date()
        raceDue.setHours(23, 59, 0, 0)
        raceParentId = createTask({ title: '冒烟子任务竞态', dueAt: raceDue.toISOString() }).id
        // 阶段 1：开详情 → 加一条 → 发起改名 A（停闸）→ 勾选 B（直通成功）。
        const racePhase1 = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const setInput = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          };
          window.dispatchEvent(new Event('focus'));
          if (!(await waitFor(() => findRow('冒烟子任务竞态')))) return { ok: false, step: 'row' };
          findRow('冒烟子任务竞态').querySelector('.task-title').click();
          if (!(await waitFor(() => document.querySelector('[data-subtask-add]')))) return { ok: false, step: 'detail' };
          const add = document.querySelector('[data-subtask-add]');
          setInput(add, '竞态甲');
          add.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          if (!(await waitFor(() => document.querySelectorAll('[data-subtask-id]').length === 1))) return { ok: false, step: 'add' };
          // 等 focus 触发的 load 落定（连续两次进度读数相同才算稳），避免旧
          // 快照把乐观计数打回去（同 subtaskUiResult 的稳定模式）。
          let lastProgress = '';
          const stable = await waitFor(() => {
            const now = document.querySelector('[data-subtask-progress]')?.textContent.trim() ?? '';
            const ok = now === '0/1' && now === lastProgress;
            lastProgress = now;
            return ok;
          });
          if (!stable) return { ok: false, step: 'progress' };
          // A：仅改名。Enter 提交链 + 冒泡 focusout 兜底（无焦点窗口里 blur()
          // 是 no-op，见 subtaskUiResult 的同款注释）；重复提交幂等无害。
          const titleInput = document.querySelector('.checklist-title');
          titleInput.focus();
          setInput(titleInput, '竞态甲改');
          titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          // 等乐观 title 重渲染进 SubtaskRow 的 item prop（aria-label 由
          // item.title 派生，是 prop 的可观测代理）再派兜底 focusout：否则
          // commit 闭包里的 item.title 还是旧值，兜底会再发一次改名调用（同样
          // 停闸），第二次失败的回滚把乐观 title 又盖回去，断言假红。无焦点
          // 窗口里 blur() 是 no-op、乐观尚未发生，短超时后 focusout 承担唯一
          // 一次提交——两种窗口状态下都恰好一个改名调用。
          await waitFor(() => titleInput.getAttribute('aria-label')?.includes('竞态甲改'), 800);
          titleInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          await sleep(200);
          // B：仅勾选 → 直通真实 DB 成功，权威行替换 store 行（含并发字段）。
          document.querySelector('.checklist-check').click();
          const settled = await waitFor(() =>
            document.querySelector('[data-subtask-progress]')?.textContent.trim() === '1/1' &&
            document.querySelector('.checklist-check')?.getAttribute('aria-pressed') === 'true'
          );
          // A 还停在闸门上：此刻不得有错误 toast（失败尚未发生）。
          const noEarlyError = !errorToast();
          return { ok: Boolean(settled) && noEarlyError, step: 'B' };
        })()`)
        // 放行 A：改名调用真实拒绝 → 触发渲染层字段级回滚。
        if (releaseSubtaskFail) (releaseSubtaskFail as () => void)()
        const racePhase2 = await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          const toasted = await waitFor(() => errorToast()?.textContent.includes('保存失败，改动未写入本地数据库'));
          await sleep(250);
          const row = document.querySelector('[data-subtask-id]');
          // A 的 title 回到 pre-A 值；B 的 completed 必须存活（判别点：整行
          // 回滚会把勾选抹掉，而 done 计数不回滚——行与计数还会互相矛盾）。
          const titleKept = row?.querySelector('.checklist-title')?.value === '竞态甲';
          const completedKept = row?.querySelector('.checklist-check')?.getAttribute('aria-pressed') === 'true';
          const progress = document.querySelector('[data-subtask-progress]')?.textContent.trim();
          const badge = findRow('冒烟子任务竞态')?.querySelector('[data-subtask-badge]')?.textContent.trim();
          const stored = await window.polaris.subtasks.list(${JSON.stringify(raceParentId)});
          const dbOk = stored.length === 1 && stored[0].title === '竞态甲' && stored[0].completed === true;
          // 清掉错误提示，不给后续段留污染。
          document.querySelector('.toast-error .toast-dismiss')?.click();
          await waitFor(() => !document.querySelector('.toast-error'));
          return { ok: Boolean(toasted) && titleKept && completedKept && progress === '1/1' && badge === '1/1' && dbOk,
            titleKept, completedKept, progress, badge, dbOk };
        })()`)
        subtaskFieldRollback = racePhase1?.ok === true && racePhase2?.ok === true
        if (!subtaskFieldRollback) {
          console.error('SUBTASK_FIELD_ROLLBACK_FAIL', JSON.stringify({ racePhase1, racePhase2 }))
        }
      } finally {
        resetTaskIpc()
        if (raceParentId) {
          deleteTask(raceParentId)
          deleteTaskForever(raceParentId)
        }
        await wc.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          await sleep(350);
        })()`)
      }
    }

    // 标签：详情建标签贴标签、任务行 chip、侧栏筛选命中、删标签级联清 chip。
    const tagUiResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      let step = 'create';
      const due = new Date(); due.setHours(23, 59, 0, 0);
      const task = await window.polaris.tasks.create({ title: '冒烟标签甲', dueAt: due.toISOString(), projectId: null });
      const taskB = await window.polaris.tasks.create({ title: '冒烟标签乙', dueAt: due.toISOString(), projectId: null });
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      try {
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
        window.dispatchEvent(new Event('focus'));
        step = 'row';
        if (!(await waitFor(() => findRow('冒烟标签甲') && findRow('冒烟标签乙')))) throw new Error('rows not found');
        findRow('冒烟标签甲').querySelector('.task-title').click();
        step = 'detail';
        if (!(await waitFor(() => document.querySelector('.detail-tag-input')))) throw new Error('tag input not found');
        const input = document.querySelector('.detail-tag-input');
        setInput(input, '冒烟标签');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        step = 'chip';
        if (!(await waitFor(() => document.querySelector('[data-detail-tag="冒烟标签"]')))) throw new Error('detail chip missing');
        if (!(await waitFor(() => findRow('冒烟标签甲').querySelector('[data-tag-name="冒烟标签"]')))) throw new Error('row chip missing');
        const tag = (await window.polaris.tags.list()).find((t) => t.name === '冒烟标签');
        if (!tag) throw new Error('tag not persisted');
        step = 'assign';
        await window.polaris.tasks.update({ id: taskB.id, tagIds: [tag.id] });
        window.dispatchEvent(new Event('focus'));
        if (!(await waitFor(() => findRow('冒烟标签乙')?.querySelector('[data-tag-name="冒烟标签"]')))) throw new Error('second chip missing');
        step = 'sidebar';
        const tagRow = () => [...document.querySelectorAll('.tag-item')].find((el) => el.textContent.includes('冒烟标签'));
        if (!(await waitFor(() => tagRow()))) throw new Error('sidebar tag row missing');
        // 计数落定：连续两次读数相同才算稳（同子任务进度的稳定模式）。
        let lastCount = '';
        await waitFor(() => {
          const now = tagRow()?.querySelector('.nav-count')?.textContent.trim() ?? '';
          const stable = now !== '' && now === lastCount;
          lastCount = now;
          return stable;
        });
        const countText = tagRow().querySelector('.nav-count').textContent.trim();
        tagRow().querySelector('.project-select').click();
        step = 'filter';
        if (!(await waitFor(() => document.querySelector('.view-title')?.textContent.trim() === '#冒烟标签'))) throw new Error('filter title wrong');
        if (!(await waitFor(() => document.querySelectorAll('.task-item').length === 2))) throw new Error('filter rows not 2');
        const filterRows = [...document.querySelectorAll('.task-item')].every((el) => el.querySelector('[data-tag-name="冒烟标签"]'));
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
        await waitFor(() => document.querySelector('.view-title')?.textContent.trim() === '全部任务');
        step = 'cascade';
        tagRow().querySelector('.project-action-danger').click();
        if (!(await waitFor(() => document.querySelectorAll('[data-tag-name]').length === 0))) throw new Error('chips survived tag delete');
        // 首启教学示例自带标签（示例/入门），侧栏标签区不会整段清空——
        // 断言语义收敛到「冒烟标签行已消失」，其余标签行的存在不参与判定。
        const tagRowGone = ![...document.querySelectorAll('.tag-item')].some((el) =>
          el.textContent.includes('冒烟标签')
        );
        const tagsLeft = (await window.polaris.tags.list()).filter((t) => t.name === '冒烟标签').length;
        return {
          ok: countText === '2' && filterRows && tagRowGone && tagsLeft === 0,
          step, countText, filterRows, tagRowGone, tagsLeft
        };
      } catch (error) {
        return { step, error: String(error) };
      } finally {
        for (const id of [task.id, taskB.id]) {
          try { await window.polaris.tasks.remove(id); } catch {}
          try { await window.polaris.tasks.deleteForever(id); } catch {}
        }
      }
    })()`)
    const tagUiWorks = tagUiResult?.ok === true
    if (!tagUiWorks) console.error('TAG_UI_FAIL', JSON.stringify(tagUiResult))

    // 四象限：自种四条任务分落四象限，命令面板直达，断言象限标题、归属与计数自洽。
    const matrixResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      let step = 'seed';
      const ids = [];
      const today = new Date(); today.setHours(23, 59, 0, 0);
      const future = new Date(Date.now() + 3 * 86400000); future.setHours(23, 59, 0, 0);
      try {
        const mk = async (title, priority, dueAt) => {
          const t = await window.polaris.tasks.create({ title, priority, dueAt, projectId: null });
          ids.push(t.id);
        };
        await mk('冒烟象限甲', 3, today.toISOString());
        await mk('冒烟象限乙', 2, future.toISOString());
        await mk('冒烟象限丙', 1, today.toISOString());
        await mk('冒烟象限丁', 0, null);
        window.dispatchEvent(new Event('focus'));
        step = 'open';
        document.querySelector('.search-trigger').click();
        if (!(await waitFor(() => document.querySelector('.command-input')))) throw new Error('palette not open');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(document.querySelector('.command-input'), '四象限');
        document.querySelector('.command-input').dispatchEvent(new Event('input', { bubbles: true }));
        const item = await waitFor(() => document.querySelector('.command-item'));
        if (!item || !item.textContent.includes('四象限')) throw new Error('palette command missing');
        item.click();
        if (!(await waitFor(() => document.querySelector('.view-title')?.textContent?.trim() === '四象限'))) throw new Error('title wrong');
        step = 'quadrants';
        const count = (id) => document.querySelector('[data-quadrant="' + id + '"] [data-quadrant-count]')?.textContent?.trim();
        const titles = (id) => [...document.querySelectorAll('[data-quadrant="' + id + '"] .task-title')].map((el) => el.textContent.trim()).join('|');
        // 示例任务也在矩阵里：计数不断言绝对值，断言「徽标 = 渲染行数」的自洽，
        // 四条自种任务的归属用字面量钉死。等 focus 触发的 load() 落定。
        if (!(await waitFor(() =>
          titles('do').includes('冒烟象限甲') && titles('plan').includes('冒烟象限乙') &&
          titles('quick').includes('冒烟象限丙') && titles('later').includes('冒烟象限丁')
        ))) throw new Error('membership wrong');
        const consistent = ['do', 'plan', 'quick', 'later'].every((id) =>
          count(id) === String(document.querySelectorAll('[data-quadrant="' + id + '"] .task-item').length)
        );
        const membership =
          titles('do').split('|').filter((t) => t === '冒烟象限甲').length === 1 &&
          titles('plan').split('|').filter((t) => t === '冒烟象限乙').length === 1 &&
          titles('quick').split('|').filter((t) => t === '冒烟象限丙').length === 1 &&
          titles('later').split('|').filter((t) => t === '冒烟象限丁').length === 1;
        const labels = [...document.querySelectorAll('.matrix-quadrant-title')].map((el) => el.textContent.trim()).join('|');
        step = 'detail';
        document.querySelector('[data-quadrant="do"] .task-title').click();
        const detailOpened = await waitFor(() => document.querySelector('.detail-title'));
        return {
          ok: membership && consistent && labels === '立即做|计划做|快速处理|有余力再做' && Boolean(detailOpened),
          step, membership, consistent, labels
        };
      } catch (error) {
        return { step, error: String(error) };
      } finally {
        for (const id of ids) {
          try { await window.polaris.tasks.remove(id); } catch {}
          try { await window.polaris.tasks.deleteForever(id); } catch {}
        }
      }
    })()`)
    const matrixWorks = matrixResult?.ok === true
    if (!matrixWorks) console.error('MATRIX_FAIL', JSON.stringify(matrixResult))

    // 四象限套件（偏好）：编辑象限弹窗改筛选看级联迁移、时间分组、象限内
    // 快速添加、视图级全部恢复默认。与 matrixWorks 不同，本段布尔进 checks
    // 门控——失败必须让退出码变红。
    const matrixPrefsResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      let step = 'seed';
      try {
        const today = new Date(); today.setHours(23, 59, 0, 0);
        const seeded = await window.polaris.tasks.create({ title: '冒烟偏好甲', priority: 3, dueAt: today.toISOString(), projectId: null });
        window.dispatchEvent(new Event('focus'));
        step = 'open';
        const nav = await waitFor(() => [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('四象限')));
        if (!nav) throw new Error('matrix nav missing');
        nav.click();
        if (!(await waitFor(() => document.querySelector('.view-title')?.textContent?.trim() === '四象限'))) throw new Error('title wrong');
        step = 'baseline';
        const titles = (id) => [...document.querySelectorAll('[data-quadrant="' + id + '"] .task-title')].map((el) => el.textContent.trim());
        if (!(await waitFor(() => titles('do').includes('冒烟偏好甲')))) throw new Error('baseline membership wrong');
        step = 'edit-dialog';
        document.querySelector('[data-quadrant="do"] [data-matrix-menu="do"]').click();
        const editRow = await waitFor(() => [...document.querySelectorAll('.matrix-menu .matrix-menu-row')].find((el) => el.textContent.trim() === '编辑'));
        if (!editRow) throw new Error('edit row missing');
        editRow.click();
        if (!(await waitFor(() => document.querySelector('.matrix-edit-panel')))) throw new Error('edit dialog missing');
        step = 'edit-save';
        const triggers = document.querySelectorAll('.matrix-select-trigger');
        if (triggers.length < 2) throw new Error('selects missing');
        triggers[1].click();
        const noDateOption = await waitFor(() => [...document.querySelectorAll('.matrix-select-option')].find((el) => el.textContent.trim() === '无日期'));
        if (!noDateOption) throw new Error('noDate option missing');
        noDateOption.click();
        const saveButton = await waitFor(() => document.querySelector('.matrix-edit-save'));
        saveButton.click();
        if (!(await waitFor(() => !document.querySelector('.matrix-edit-panel')))) throw new Error('dialog not closed');
        step = 'cascade';
        // 甲（今天到期）不再命中「无日期」的 do，按级联迁去 plan（重要+所有日期）。
        if (!(await waitFor(() => !titles('do').includes('冒烟偏好甲') && titles('plan').includes('冒烟偏好甲')))) throw new Error('cascade move failed');
        const prefsStored = Boolean(localStorage.getItem('polaris-matrix-view'));
        step = 'group';
        document.querySelector('[data-quadrant="plan"] [data-matrix-menu="plan"]').click();
        const timeRow = await waitFor(() => [...document.querySelectorAll('.matrix-menu .matrix-menu-row')].find((el) => el.textContent.trim() === '时间'));
        if (!timeRow) throw new Error('group option missing');
        timeRow.click();
        if (!(await waitFor(() => document.querySelector('[data-quadrant="plan"] .matrix-group-label')))) throw new Error('group label missing');
        step = 'reset-all';
        document.querySelector('.matrix-view-menu-trigger').click();
        const resetRow = await waitFor(() => [...document.querySelectorAll('.matrix-menu .matrix-menu-row')].find((el) => el.textContent.includes('恢复默认')));
        if (!resetRow) throw new Error('reset row missing');
        resetRow.click();
        if (!(await waitFor(() => titles('do').includes('冒烟偏好甲') && !document.querySelector('[data-quadrant="plan"] .matrix-group-label')))) throw new Error('reset-all failed');
        step = 'quick-add';
        document.querySelector('[data-quadrant="later"] [data-matrix-add="later"]').click();
        const input = await waitFor(() => document.querySelector('.matrix-add-input'));
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '冒烟象限新增');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const added = await waitFor(() => titles('later').includes('冒烟象限新增'));
        step = 'layout';
        for (let i = 1; i <= 20; i += 1) {
          await window.polaris.tasks.create({ title: '冒烟布局' + i, priority: 0, dueAt: null, projectId: null });
        }
        window.dispatchEvent(new Event('focus'));
        if (!(await waitFor(() => document.querySelectorAll('[data-quadrant="later"] .task-item').length > 15))) throw new Error('layout rows missing');
        const cardHeights = [...document.querySelectorAll('.matrix-quadrant')].map((el) => Math.round(el.getBoundingClientRect().height));
        const equalCards = Math.max(...cardHeights) - Math.min(...cardHeights) <= 1;
        const laterList = document.querySelector('[data-quadrant="later"] .matrix-quadrant-list');
        const listScrolls = laterList.scrollHeight > laterList.clientHeight + 2;
        laterList.scrollTop = 50;
        const listScrolled = laterList.scrollTop > 0;
        const mainEl = document.querySelector('.main');
        const noOuterScroll = mainEl.scrollHeight <= mainEl.clientHeight + 1;
        step = 'layout-measured';
        return {
          ok: added && prefsStored && equalCards && listScrolls && listScrolled && noOuterScroll,
          step,
          prefsStored,
          cascadeMoved: true,
          cardHeights,
          equalCards,
          listScrolls,
          listScrolled,
          noOuterScroll
        };
      } catch (error) {
        return { step, error: String(error) };
      } finally {
        try {
          const all = await window.polaris.tasks.list();
          for (const task of all.filter((item) => item.title.startsWith('冒烟'))) {
            try { await window.polaris.tasks.remove(task.id); } catch {}
            try { await window.polaris.tasks.deleteForever(task.id); } catch {}
          }
        } catch {}
      }
    })()`)
    const matrixPrefsWorks = matrixPrefsResult?.ok === true
    if (!matrixPrefsWorks) console.error('MATRIX_PREFS_FAIL', JSON.stringify(matrixPrefsResult))

    // 日历：42 格月矩阵、任务按截止落格、翻月与今天按钮、chip 点开详情。
    // 落格日期选「今天」与「本月 15 号」（今天恰为 15 号则用 16 号），任何运行日都不跨月。
    const calendarResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      let step = 'seed';
      const ids = [];
      const base = new Date(); base.setHours(23, 59, 0, 0);
      const mid = new Date(base.getFullYear(), base.getMonth(), base.getDate() === 15 ? 16 : 15, 23, 59, 0, 0);
      const key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const label = (d) => d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
      try {
        const mk = async (title, dueAt) => {
          const t = await window.polaris.tasks.create({ title, dueAt, projectId: null });
          ids.push(t.id);
        };
        await mk('冒烟日历今', base.toISOString());
        await mk('冒烟日历中', mid.toISOString());
        await mk('冒烟日历无', null);
        window.dispatchEvent(new Event('focus'));
        step = 'open';
        document.querySelector('.search-trigger').click();
        if (!(await waitFor(() => document.querySelector('.command-input')))) throw new Error('palette not open');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(document.querySelector('.command-input'), '日历');
        document.querySelector('.command-input').dispatchEvent(new Event('input', { bubbles: true }));
        const item = await waitFor(() => document.querySelector('.command-item'));
        if (!item || !item.textContent.includes('日历')) throw new Error('palette command missing');
        item.click();
        if (!(await waitFor(() => document.querySelector('.view-title')?.textContent?.trim() === '日历'))) throw new Error('title wrong');
        step = 'grid';
        const now = new Date();
        if (!(await waitFor(() => document.querySelector('[data-calendar-month]')?.textContent?.trim() === label(now)))) throw new Error('month label wrong');
        const cells = document.querySelectorAll('.calendar-cell').length;
        const chipIn = (k, title) => [...document.querySelectorAll('[data-date="' + k + '"] .calendar-chip-title')].some((el) => el.textContent.trim() === title);
        if (!(await waitFor(() => chipIn(key(base), '冒烟日历今')))) throw new Error('today chip missing');
        const placement = chipIn(key(mid), '冒烟日历中');
        const noDueAbsent = ![...document.querySelectorAll('.calendar-chip-title')].some((el) => el.textContent.includes('冒烟日历无'));
        step = 'nav';
        document.querySelector('.calendar-nav[aria-label="下个月"]').click();
        const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        if (!(await waitFor(() => document.querySelector('[data-calendar-month]')?.textContent?.trim() === label(next)))) throw new Error('next month wrong');
        const cellsAfter = document.querySelectorAll('.calendar-cell').length;
        document.querySelector('.calendar-today').click();
        if (!(await waitFor(() => document.querySelector('[data-calendar-month]')?.textContent?.trim() === label(now)))) throw new Error('today button wrong');
        step = 'detail';
        document.querySelector('[data-date="' + key(base) + '"] .calendar-chip').click();
        const detailOpened = await waitFor(() => document.querySelector('.detail-title'));
        return {
          ok: cells === 42 && cellsAfter === 42 && placement && noDueAbsent && Boolean(detailOpened),
          step, cells, cellsAfter, placement, noDueAbsent
        };
      } catch (error) {
        return { step, error: String(error) };
      } finally {
        for (const id of ids) {
          try { await window.polaris.tasks.remove(id); } catch {}
          try { await window.polaris.tasks.deleteForever(id); } catch {}
        }
      }
    })()`)
    const calendarWorks = calendarResult?.ok === true
    if (!calendarWorks) console.error('CALENDAR_FAIL', JSON.stringify(calendarResult))

    // 日历套件（P0–P3 门控守卫，全部进 checks 表）：
    // 1) timeFields：时间段字段链——创建带 startAt/endAt/allDay 的任务，
    //    详情「时间」行读数与全天开关、周视图全天行 chip、拖拽不必自动化
    //    （键盘可达替代即详情编辑，已在 P0.3 覆盖）。只断言终态。
    // 2) suiteViews：切换器切 列表/看板/周 三视图的关键 DOM（分组头、看板列、
    //    时间轴列 + 全天行），再切回月视图 42 格仍在——切换不丢视图骨架。
    // 3) rangeParse：快速添加「3点到5点值班」→ 标题不残留区间、startAt/endAt
    //    落库（dueAt = 开始端）。真值表已在 verify:pure 覆盖语法层，这里断言
    //    提交链路把字段真正写进 DB。
    const calendarSuiteResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      const key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      let step = 'seed';
      const ids = [];
      try {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
        const startAt = new Date(y, m, d, 10, 0, 0, 0).toISOString();
        const endAt = new Date(y, m, d, 11, 30, 0, 0).toISOString();
        const timed = await window.polaris.tasks.create({ title: '冒烟套件时间段', dueAt: startAt, startAt, endAt });
        ids.push(timed.id);
        const allDayStart = new Date(y, m, d, 0, 0, 0, 0).toISOString();
        const allDayEnd = new Date(y, m, d, 23, 59, 0, 0).toISOString();
        const allDay = await window.polaris.tasks.create({ title: '冒烟套件全天', dueAt: allDayStart, startAt: allDayStart, endAt: allDayEnd, allDay: true });
        ids.push(allDay.id);
        window.dispatchEvent(new Event('focus'));
        await sleep(400);

        step = 'open-calendar';
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('日历') || el.textContent.includes('Calendar'))?.click();
        if (!(await waitFor(() => document.querySelector('.calendar-grid')))) throw new Error('calendar not open');

        step = 'week-view';
        document.querySelector('[data-calendar-mode-tab="week"]')?.click();
        if (!(await waitFor(() => document.querySelector('[data-timegrid]')))) throw new Error('timegrid missing');
        const todayKey = key(now);
        const cols = document.querySelectorAll('[data-timegrid-day]').length;
        const block = [...document.querySelectorAll('[data-timegrid-block]')].some((el) => el.textContent.includes('冒烟套件时间段'));
        const alldayChip = [...document.querySelectorAll('[data-allday-day="' + todayKey + '"] .timegrid-allday-chip')].some((el) => el.textContent.includes('冒烟套件全天'));
        if (!(cols === 7 && block && alldayChip)) throw new Error('week view missing parts: cols=' + cols + ' block=' + block + ' allday=' + alldayChip);

        step = 'list-view';
        document.querySelector('[data-calendar-mode-tab="list"]')?.click();
        if (!(await waitFor(() => document.querySelector('[data-calendar-list]')))) throw new Error('list missing');
        const groupHead = document.querySelectorAll('.calendar-list-head').length;
        if (groupHead < 1) throw new Error('no list groups');

        step = 'board-view';
        document.querySelector('[data-calendar-mode-tab="board"]')?.click();
        if (!(await waitFor(() => document.querySelector('[data-calendar-board]')))) throw new Error('board missing');
        const boardCols = document.querySelectorAll('[data-board-col]').length;
        if (boardCols < 9) throw new Error('board cols=' + boardCols);

        step = 'back-month';
        document.querySelector('[data-calendar-mode-tab="month"]')?.click();
        if (!(await waitFor(() => document.querySelectorAll('.calendar-cell').length === 42))) throw new Error('month grid missing');
        // 打印按钮 presence（P4.4）：点击会弹原生打印对话框卡住冒烟，只断言在。
        if (!document.querySelector('[data-calendar-print]')) throw new Error('print button missing');

        step = 'detail-time-row';
        document.querySelector('[data-calendar-task="' + timed.id + '"]')?.click();
        if (!(await waitFor(() => document.querySelector('.detail-title')))) throw new Error('detail missing');
        const timeRow = [...document.querySelectorAll('.detail-row')].find((r) => r.textContent.includes('10:00 – 11:30'));
        if (!timeRow) throw new Error('time summary missing');
        document.querySelector('.detail-close')?.click();
        await sleep(300);

        step = 'range-parse';
        // 快速添加需要回到「今天」（日历不挂输入框）。真提交：区间解析出
        // startAt/endAt 并随任务落库，标题不残留「3点到5点」。输入显式带
        // 「明天」——裸「3点到5点」在本地 15 点后跑会被解析器顺延到明天，
        // 断言却停在今天视图找行，冒烟变成 15:00 后必挂的时间敏感缺陷。
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天') || el.textContent.includes('Today'))?.click();
        await sleep(300);
        const input = document.querySelector('.quick-add input');
        if (!input) throw new Error('quick add missing');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '明天3点到5点冒烟区间');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
        const stripText = document.querySelector('.quick-add-shell')?.textContent ?? '';
        const stripOk = stripText.includes('15:00') && stripText.includes('17:00');
        if (!stripOk) throw new Error('range strip missing: ' + stripText);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        // 任务落明天：行断言切到「即将到来」视图（今天视图不显示未来任务）。
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('即将到来') || el.textContent.includes('Upcoming'))?.click();
        await sleep(300);
        if (!(await waitFor(() => findRow('冒烟区间')))) throw new Error('range task not created');
        const rangeTask = [...(await window.polaris.tasks.list())].reverse().find((t) => t.title === '冒烟区间');
        if (!rangeTask) throw new Error('range task not in db');
        ids.push(rangeTask.id);
        const rangeOk = Boolean(rangeTask.startAt && rangeTask.endAt && rangeTask.dueAt === rangeTask.startAt);
        if (!rangeOk) throw new Error('range fields missing: ' + JSON.stringify({ s: rangeTask.startAt, e: rangeTask.endAt, d: rangeTask.dueAt }));

        return { ok: Boolean(cols === 7 && block && alldayChip && groupHead >= 1 && boardCols >= 9 && timeRow && stripOk && rangeOk), step };
      } catch (error) {
        return { ok: false, step, error: String(error) };
      } finally {
        for (const id of ids) {
          try { await window.polaris.tasks.remove(id); } catch {}
          try { await window.polaris.tasks.deleteForever(id); } catch {}
        }
      }
    })()`)
    const calendarSuiteWorks = calendarSuiteResult?.ok === true
    if (!calendarSuiteWorks) console.error('CALENDAR_SUITE_FAIL', JSON.stringify(calendarSuiteResult))



    // 自定义重复 UI：开弹层 → 自定义 → 周 → 间隔步进(+ 后 −) → 一三五 → 规则落库且弹层不超 420px。
    // 交互套用选择器冒烟的成熟模式：点 .task-title → 等 .detail-title → sleep 稳定 → 点行开弹层。
    // 诊断必须随结果返回主进程再打印：渲染层 console.error 不回传到冒烟 stdout。
    const customRepeatResult = await mainWindow?.webContents.executeJavaScript(`(async () => {
      ${pageHelpers}
      let step = 'create';
      const due = new Date(); due.setHours(23, 59, 0, 0);
      const task = await window.polaris.tasks.create({ title: '冒烟自定义重复', dueAt: due.toISOString(), projectId: null });
      try {
        [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务')).click();
        window.dispatchEvent(new Event('focus'));
        step = 'row';
        if (!(await waitFor(() => findRow('冒烟自定义重复')))) throw new Error('row not found');
        step = 'detail';
        findRow('冒烟自定义重复').querySelector('.task-title').click();
        await waitFor(() => document.querySelector('.detail-title'));
        await sleep(300);
        step = 'repeat-row';
        const repeatRow = [...document.querySelectorAll('.detail-row')].find((r) => r.textContent.includes('重复'));
        if (!repeatRow) throw new Error('repeat row not found');
        repeatRow.click();
        step = 'custom-chip';
        const customChip = await waitFor(() => [...document.querySelectorAll('.detail-chip')].find((c) => c.textContent === '自定义'));
        if (!customChip) throw new Error('custom chip not found');
        await sleep(200);
        customChip.click();
        await sleep(300);
        step = 'week-freq';
        const weekChip = await waitFor(() => [...document.querySelectorAll('.repeat-field .detail-chip')].find((c) => c.textContent === '周'));
        if (!weekChip) throw new Error('week chip not found');
        await sleep(150);
        weekChip.click();
        await sleep(300);
        step = 'stepper';
        const plus = await waitFor(() => document.querySelector('.repeat-step[aria-label="增加间隔"]'));
        if (!plus) throw new Error('plus not found');
        plus.click();
        await sleep(300);
        document.querySelector('.repeat-step[aria-label="减少间隔"]').click();
        await sleep(300);
        step = 'weekdays';
        for (const label of ['一', '三', '五']) {
          const day = [...document.querySelectorAll('.repeat-field .detail-chip')].find((c) => c.textContent === label);
          if (!day) throw new Error('weekday ' + label + ' not found');
          day.click();
          await sleep(300);
        }
        await sleep(300);
        step = 'verify';
        const stored = (await window.polaris.tasks.list()).find((t) => t.id === task.id)?.recurrenceRule;
        const ruleOk = stored === 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR';
        const popover = document.querySelector('.detail-popover');
        const heightOk = Boolean(popover) && popover.getBoundingClientRect().height <= 420 && popover.scrollHeight <= popover.clientHeight + 1;
        return { ok: ruleOk && heightOk, step, stored, ruleOk, heightOk, h: popover ? popover.getBoundingClientRect().height : null };
      } catch (error) {
        return { ok: false, step, error: String(error) };
      } finally {
        await window.polaris.tasks.remove(task.id);
        await window.polaris.tasks.deleteForever(task.id);
      }
    })()`)
    const customRepeatUiWorks = customRepeatResult?.ok === true
    if (!customRepeatUiWorks) console.error('CUSTOM_REPEAT_UI_FAIL', JSON.stringify(customRepeatResult))

    // 备份往返（主进程直调 db）：原样导入全跳过（幂等）；新 ID 插入；孤儿 projectId 归「无项目」。
    let backupRoundTripWorks = false
    const backupFixtureIds: string[] = []
    let backupProjectId: string | null = null
    try {
      const project = createProject({ name: '冒烟备份项目', color: '#5EEAD4' })
      backupProjectId = project.id
      const due = new Date()
      due.setHours(23, 59, 0, 0)
      const task = createTask({ title: '冒烟备份任务', dueAt: due.toISOString(), projectId: project.id })
      backupFixtureIds.push(task.id)
      const backup = exportBackup()
      const reimport = importBackup(backup)
      const idempotent =
        reimport.tasksImported === 0 &&
        reimport.projectsImported === 0 &&
        reimport.tasksSkipped === backup.tasks.length &&
        reimport.projectsSkipped === backup.projects.length
      const copyId = 'smoke-backup-copy'
      const copy = {
        projects: backup.projects,
        tasks: backup.tasks.map((t) => (t.id === task.id ? { ...t, id: copyId, title: '冒烟备份副本' } : t))
      }
      const imported = importBackup(copy)
      backupFixtureIds.push(copyId)
      const insertOk = imported.tasksImported === 1
      const orphanId = 'smoke-backup-orphan'
      const original = backup.tasks.find((t) => t.id === task.id)!
      const orphanResult = importBackup({ projects: [], tasks: [{ ...original, id: orphanId, projectId: 'no-such-project' }] })
      backupFixtureIds.push(orphanId)
      const orphanTask = listTasks().find((t) => t.id === orphanId)
      const orphanOk = orphanResult.tasksImported === 1 && orphanTask?.projectId === null
      // 非法日期必须在 schema 层被整份拒绝：放行会把坏行写进库，渲染层
      // formatDue(new Date('GARBAGE')) 抛 RangeError，整棵 React 树卸载。
      const badDate = backupSchema.safeParse({
        ...backup,
        tasks: backup.tasks.map((t) => (t.id === task.id ? { ...t, dueAt: 'GARBAGE' } : t))
      })
      const dateRejected = badDate.success === false
      backupRoundTripWorks = idempotent && insertOk && orphanOk && dateRejected
      if (!backupRoundTripWorks) console.error('BACKUP_ROUNDTRIP_FAIL', JSON.stringify({ idempotent, insertOk, orphanOk, dateRejected, reimport, imported }))
    } catch (error) {
      console.error('BACKUP_ROUNDTRIP_ERROR', error)
    } finally {
      for (const id of backupFixtureIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
      if (backupProjectId) deleteProject(backupProjectId)
    }

    // 自动备份列表（设置页 E2E，模态版）：fixture 备份落盘 → 点固定行 [管理…]
    // 开对话框 → 断言列表行（newest first）→ 行内「导入」合并回库（反馈落
    // 对话框常驻槽）；全新 profile 周期默认 24（主进程读值 + 界面选中档）；路径穿越入参拒绝；openDataDir 在 harness 恒不真开资源
    // 管理器；「另存为」只断言存在——原生保存对话框无自动化，不点；
    // Esc 只关对话框、面板存活；开/关模态前后面板几何逐像素不变（零抖动）。
    let autoBackupListWorks = false
    const autoBackupFixtureName = 'polaris-auto-2026-11-19T02-00-00-000Z.json'
    const autoBackupFixture2Name = 'polaris-auto-2026-11-19T01-00-00-000Z.json'
    let autoBackupFixtureId: string | null = null
    let autoBackupFixturePath: string | null = null
    let autoBackupFixture2Path: string | null = null
    try {
      const fixtureTask = createTask({ title: '冒烟自动备份任务' })
      autoBackupFixtureId = fixtureTask.id
      const payload = {
        schemaVersion: 4,
        app: 'polaris',
        exportedAt: new Date().toISOString(),
        ...exportBackup()
      }
      const autoBackupDir = join(app.getPath('userData'), 'backups')
      await mkdir(autoBackupDir, { recursive: true })
      autoBackupFixturePath = join(autoBackupDir, autoBackupFixtureName)
      await writeFileAtomic(autoBackupFixturePath, JSON.stringify(payload, null, 2))
      // 第二份夹具专供删除链路：确认框 → 危险钮 → 文件真被 unlink。
      autoBackupFixture2Path = join(autoBackupDir, autoBackupFixture2Name)
      await writeFileAtomic(autoBackupFixture2Path, JSON.stringify(payload, null, 2))
      // 先删掉 fixture 任务，合并导入才有得插（已存在的 ID 会跳过）。
      deleteTask(fixtureTask.id)
      deleteTaskForever(fixtureTask.id)
      {
        // 设置是独立窗口：脚本在设置窗口的 webContents 里跑（withSettings 经
        // 真实侧栏入口开窗、切到数据页、收尾关窗），断言结构不变。
        const listResult = await withSettings('data', null, (settings) => settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const manage = await waitFor(() => document.querySelector('.auto-backup-manage'));
          if (!manage) return { opened: false };
          // 零抖动快照：数据页外框 / 内容高度，开模态前后必须全等。
          const snap = () => ({
            ph: document.querySelector('.settings-page').getBoundingClientRect().height,
            sh: document.querySelector('.settings-page').scrollHeight
          });
          const before = snap();
          manage.click();
          const dialog = await waitFor(() => document.querySelector('.backup-dialog-panel'));
          if (!dialog) return { opened: true, manage: true, dialog: false };
          const row = await waitFor(() =>
            dialog.querySelector('.auto-backup-row[data-backup-name="${autoBackupFixtureName}"]')
          );
          if (!row) return { opened: true, manage: true, dialog: true, row: false };
          await sleep(300);
          const during = snap();
          // newest first：文件名即时间戳，整列必须按名字降序（不依赖目录里
          // 是否还有更新的真实自动备份，断言排序语义本身）。
          const rowNames = [...dialog.querySelectorAll('.auto-backup-row')].map((r) => r.getAttribute('data-backup-name'));
          const sortedDesc = rowNames.length > 0 && rowNames.every((n, i) => i === 0 || rowNames[i - 1] >= n);
          const rowButtons = [...row.querySelectorAll('button')];
          const rowLabels = rowButtons.map((b) => b.textContent);
          const rowActionsOk = rowLabels.includes('导入') && rowLabels.includes('另存为') && rowLabels.includes('删除');
          rowButtons[0].click();
          // 反馈落对话框常驻槽（默认是合并语义说明，导入完成文案替换进槽）。
          const status = await waitFor(() => {
            const el = dialog.querySelector('.backup-dialog-slot');
            const text = el ? el.textContent : '';
            return text && text.includes('导入完成') ? text : null;
          });
          // 周期 chips：5 档即点即存——slot 反馈 + meta 回读双确认。
          const chips = [...dialog.querySelectorAll('.backup-interval-chip')];
          const chipsOk = chips.length === 5;
          // 全新 profile 没设置过周期：必须读回默认 24，界面选中的也是「24 小时」
          // （回归：缺失键曾被读成 0 = 关闭，自动备份静默停摆）。
          const intervalDefault = (await window.polaris.backups.getInterval()) === 24;
          const intervalDefaultChip = chips[2]?.getAttribute('aria-pressed') === 'true';
          chips[1]?.click();
          const intervalSaved = await waitFor(() => {
            const el = dialog.querySelector('.backup-dialog-slot');
            const text = el ? el.textContent : '';
            return text && text.includes('备份周期已更新') ? true : null;
          });
          const intervalStored = (await window.polaris.backups.getInterval()) === 12;
          // 逐份删除：点删除 → 嵌套确认框 → 危险钮 → 行消失 + slot 反馈 + 文件真被删。
          const row2 = dialog.querySelector('.auto-backup-row[data-backup-name="${autoBackupFixture2Name}"]');
          const deleteBtn = row2 ? [...row2.querySelectorAll('button')].find((b) => b.textContent === '删除') : null;
          deleteBtn?.click();
          const confirmPanel = await waitFor(() => document.querySelector('.backup-dialog-panel .confirm-panel'));
          document.querySelector('.backup-dialog-panel .confirm-panel .confirm-actions .detail-popover-danger')?.click();
          const row2Gone = await waitFor(() => (!dialog.querySelector('.auto-backup-row[data-backup-name="${autoBackupFixture2Name}"]') ? true : null));
          const deleteStatus = await waitFor(() => {
            const el = dialog.querySelector('.backup-dialog-slot');
            const text = el ? el.textContent : '';
            return text && text.includes('已删除备份') ? true : null;
          });
          // 周期还原默认档，不留测试痕迹。
          chips[2]?.click();
          const intervalRestored = (await window.polaris.backups.getInterval()) === 24;
          const traversal = await window.polaris.backups.import('../../evil.json');
          const openDir = await window.polaris.backups.openDataDir();
          // Esc 只关对话框：React 在根停传播，设置窗口的 window Esc 兜底不抢关整扇窗口。
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const escClosed = await waitFor(() => !document.querySelector('.backup-dialog-panel'));
          await sleep(300);
          const after = snap();
          const windowAlive = Boolean(document.querySelector('.settings-window'));
          // 整页窗口里反馈行（导入完成/错误）合法地改变页面高度——旧「定高卡」
          // 契约已随浮层退役；这里只钉「开/关模态本身不位移页面」。
          const eq = (a, b) => a.ph === b.ph && a.sh === b.sh;
          return {
            opened: true, manage: true, dialog: true, row: true, rowActionsOk, status,
            sortedDesc, chipsOk, intervalDefault, intervalDefaultChip,
            intervalSaved: Boolean(intervalSaved), intervalStored,
            deleteConfirm: Boolean(confirmPanel), row2Gone: Boolean(row2Gone),
            deleteStatus: Boolean(deleteStatus), intervalRestored,
            traversalOk: traversal.ok === false,
            openDirOpened: openDir.opened === true,
            escClosed: Boolean(escClosed),
            windowAlive,
            zeroShift: eq(before, during)
          };
        })()`)
        )
        const backInDb = listTasks().some((t) => t.id === autoBackupFixtureId)
        // fixture2 是删除链路的验收：行消失之外，磁盘文件必须真被 unlink。
        const fixture2Gone = autoBackupFixture2Path
          ? !(await stat(autoBackupFixture2Path).catch(() => null))
          : false
        autoBackupListWorks =
          listResult?.row === true &&
          listResult?.rowActionsOk === true &&
          typeof listResult?.status === 'string' &&
          listResult?.sortedDesc === true &&
          listResult?.chipsOk === true &&
          listResult?.intervalDefault === true &&
          listResult?.intervalDefaultChip === true &&
          listResult?.intervalSaved === true &&
          listResult?.intervalStored === true &&
          listResult?.deleteConfirm === true &&
          listResult?.row2Gone === true &&
          listResult?.deleteStatus === true &&
          listResult?.intervalRestored === true &&
          fixture2Gone &&
          backInDb &&
          listResult?.traversalOk === true &&
          listResult?.openDirOpened === false &&
          listResult?.escClosed === true &&
          listResult?.windowAlive === true &&
          listResult?.zeroShift === true
        if (!autoBackupListWorks) console.error('AUTO_BACKUP_LIST_FAIL', JSON.stringify({ listResult, backInDb, fixture2Gone }))
      }
    } catch (error) {
      console.error('AUTO_BACKUP_LIST_ERROR', error)
    } finally {
      if (autoBackupFixtureId) {
        deleteTask(autoBackupFixtureId)
        deleteTaskForever(autoBackupFixtureId)
      }
      if (autoBackupFixturePath) await unlink(autoBackupFixturePath).catch(() => {})
      if (autoBackupFixture2Path) await unlink(autoBackupFixture2Path).catch(() => {})
    }

    // 数据存放位置（主进程直驱 + 设置页 E2E）：复制（空目录）/ 采用（已有库）
    // 两条 apply 语义、指针读写、pendingRestart 状态行、恢复默认入口与确认
    // 取消链路。真实重启无法在单进程冒烟里发生——重启后的状态经
    // markPointerForTest 模拟（只翻会话旗标，不碰磁盘/activeDir）。原生目录
    // 对话框无自动化：确认弹框走「取消」路径，
    // 「确定」的迁移语义由主进程直驱 apply 覆盖。
    let dataLocationWorks = false
    const dataLocationFixtureIds: string[] = []
    const dataLocationDirs: string[] = []
    try {
      // no-op 前置：未自定义时 resetDataDirectory 必须原样返回，不触发任何复制。
      const noopBefore = await resetDataDirectory()
      const noopReset = noopBefore.pendingRestart === false

      const dataLocFixture = createTask({ title: '冒烟数据位置任务' })
      dataLocationFixtureIds.push(dataLocFixture.id)
      // fixture 自动备份：复制路径必须把它带到新位置（备份目录跟随数据目录）。
      const backupPayload = {
        schemaVersion: 4,
        app: 'polaris',
        exportedAt: new Date().toISOString(),
        ...exportBackup()
      }
      const dataLocBackupName = 'polaris-auto-2026-11-21T00-00-00-000Z.json'
      const sourceBackups = join(app.getPath('userData'), 'backups')
      await mkdir(sourceBackups, { recursive: true })
      const dataLocBackupPath = join(sourceBackups, dataLocBackupName)
      await writeFileAtomic(dataLocBackupPath, JSON.stringify(backupPayload, null, 2))
      const userDataDb = join(app.getPath('userData'), 'polaris.db')
      const dataLocPointerPath = join(app.getPath('userData'), 'data-location.json')
      const readPointer = async (): Promise<string | null> => {
        try {
          const parsed = JSON.parse(await readFile(dataLocPointerPath, 'utf8')) as {
            directory?: string
          }
          return typeof parsed.directory === 'string' ? parsed.directory : null
        } catch {
          return null
        }
      }

      // ---- 复制路径：空目录 → 在线备份当前库过去 + backups 跟随 + 指针落盘。
      //      会话仍在默认位置（isCustom=false、path=userData），重启前不变。 ----
      const targetA = await mkdtemp(join(app.getPath('temp'), 'polaris-dataloc-a-'))
      dataLocationDirs.push(targetA)
      const offerA = setDataDirectoryOffer(targetA)
      const offerAOk = offerA.offered === targetA && offerA.offeredAdopt === false
      const appliedA = await applyDataDirectory()
      let copiedDb = false
      try {
        copiedDb = (await readFile(join(targetA, 'polaris.db'))).length > 0
      } catch {
        copiedDb = false
      }
      let copiedBackup = false
      try {
        copiedBackup = (await readFile(join(targetA, 'backups', dataLocBackupName), 'utf8')).includes(
          '冒烟数据位置任务'
        )
      } catch {
        copiedBackup = false
      }
      const dataLocProbe = createTask({ title: '冒烟数据位置探针' })
      dataLocationFixtureIds.push(dataLocProbe.id)
      const liveStillWorks = getTask(dataLocProbe.id)?.title === '冒烟数据位置探针'
      const copyOk =
        offerAOk &&
        appliedA.pendingRestart === true &&
        appliedA.isCustom === false &&
        appliedA.path === app.getPath('userData') &&
        (await readPointer()) === targetA &&
        copiedDb &&
        copiedBackup &&
        liveStillWorks

      // ---- UI #1：pendingRestart 状态行替换文案；未自定义时不出现「恢复默认」。
      //      literals 与 settings.dataLocation* zh 词典同步维护。 ----
      let uiPending = false
      {
        // 设置是独立窗口：脚本在设置窗口的数据页里跑（withSettings 负责开/切/关）。
        const pendingResult = await withSettings('data', null, (settings) => settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const row = await waitFor(() => document.querySelector('.settings-dataloc'));
          if (!row) return { opened: false };
          const status = row.querySelector('.settings-dataloc-path');
          const buttons = [...row.querySelectorAll('button')];
          return {
            opened: true,
            row: true,
            statusText: status ? status.textContent : '',
            hasChange: buttons.some((b) => b.textContent === '更改'),
            hasReset: buttons.some((b) => b.textContent === '恢复默认')
          };
        })()`)
        )
        uiPending =
          pendingResult?.opened === true &&
          pendingResult.row === true &&
          pendingResult.hasChange === true &&
          pendingResult.hasReset === false &&
          typeof pendingResult.statusText === 'string' &&
          pendingResult.statusText.includes('重启后生效')
        if (!uiPending) console.error('DATA_LOCATION_UI_PENDING_FAIL', JSON.stringify(pendingResult))
      }

      // ---- 采用路径：目标已有库 → 不覆盖不复制；指针改写；backups 不跟随。 ----
      const targetB = await mkdtemp(join(app.getPath('temp'), 'polaris-dataloc-b-'))
      dataLocationDirs.push(targetB)
      const adoptedDb = join(targetB, 'polaris.db')
      await copyFile(userDataDb, adoptedDb)
      const adoptedBefore = await readFile(adoptedDb)
      const offerB = setDataDirectoryOffer(targetB)
      const adoptApplied = await applyDataDirectory()
      // 退出兜底只属于 copy 模式：adopt 结束后调用一次 flush，被采用的库必须
      // 一个字节都不能变（没修之前这里会被当前会话的新库覆盖）。
      flushDataLocationOnQuit()
      const adoptedAfter = await readFile(adoptedDb)
      let adoptBackupsUntouched = true
      try {
        await readFile(join(targetB, 'backups', dataLocBackupName), 'utf8')
        adoptBackupsUntouched = false
      } catch {
        adoptBackupsUntouched = true
      }
      const adoptOk =
        offerB.offered === targetB &&
        offerB.offeredAdopt === true &&
        adoptApplied.pendingRestart === true &&
        (await readPointer()) === targetB &&
        adoptedBefore.equals(adoptedAfter) &&
        adoptBackupsUntouched

      // ---- UI #2：模拟重启后指针生效（只翻旗标）→「恢复默认」出现；确认框
      //      走「取消」：对话框关、面板活、磁盘指针原样（取消语义零副作用）。----
      markPointerForTest(targetB)
      let uiResetCancel = false
      {
        const resetResult = await withSettings('data', null, (settings) => settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const row = await waitFor(() => document.querySelector('.settings-dataloc'));
          if (!row) return { opened: false };
          const buttons = [...row.querySelectorAll('button')];
          const reset = buttons.find((b) => b.textContent === '恢复默认');
          if (!reset) return { opened: true, hasReset: false };
          reset.click();
          const dialog = await waitFor(() => document.querySelector('.confirm-panel'));
          if (!dialog) return { opened: true, hasReset: true, dialog: false };
          const message = dialog.querySelector('.confirm-message')?.textContent ?? '';
          const cancel = dialog.querySelector('.confirm-actions button');
          cancel.click();
          const closed = await waitFor(() => !document.querySelector('.confirm-panel'));
          await sleep(250);
          return {
            opened: true,
            hasReset: true,
            dialog: true,
            message,
            closed: Boolean(closed),
            windowAlive: Boolean(document.querySelector('.settings-window'))
          };
        })()`)
        )
        uiResetCancel =
          resetResult?.opened === true &&
          resetResult.hasReset === true &&
          resetResult.dialog === true &&
          typeof resetResult.message === 'string' &&
          resetResult.message.includes('默认位置') &&
          resetResult.closed === true &&
          resetResult.windowAlive === true &&
          (await readPointer()) === targetB
        if (!uiResetCancel) console.error('DATA_LOCATION_UI_RESET_FAIL', JSON.stringify(resetResult))
      }
      markPointerForTest(null)

      // ---- offer 生命周期：取消清空；同路径与文件路径都被拒且不产生 offer。----
      const targetC = await mkdtemp(join(app.getPath('temp'), 'polaris-dataloc-c-'))
      dataLocationDirs.push(targetC)
      const offerC = setDataDirectoryOffer(targetC)
      const offerCSet = offerC.offered === targetC
      const offerCCancelled = cancelDataDirectoryOffer()
      const cancelOk = offerCSet && offerCCancelled.offered === undefined
      const sameState = setDataDirectoryOffer(app.getPath('userData'))
      const sameOk = typeof sameState.error === 'string' && sameState.offered === undefined
      const invalidState = setDataDirectoryOffer(userDataDb)
      const invalidOk =
        typeof invalidState.error === 'string' && invalidState.offered === undefined

      dataLocationWorks =
        noopReset && copyOk && uiPending && adoptOk && uiResetCancel && cancelOk && sameOk && invalidOk
      if (!dataLocationWorks) {
        console.error(
          'DATA_LOCATION_FAIL',
          JSON.stringify({ noopReset, copyOk, uiPending, adoptOk, uiResetCancel, cancelOk, sameOk, invalidOk })
        )
      }
    } finally {
      // 会话旗标与磁盘指针都还原：后续设置页契约检查按默认状态测量。
      markPointerForTest(null)
      await unlink(join(app.getPath('userData'), 'data-location.json')).catch(() => {})
      for (const id of dataLocationFixtureIds) {
        try {
          deleteTask(id)
          deleteTaskForever(id)
        } catch {
          // 夹具可能已被硬删；逐条清理互不影响。
        }
      }
      await unlink(join(app.getPath('userData'), 'backups', 'polaris-auto-2026-11-21T00-00-00-000Z.json')).catch(() => {})
      for (const dir of dataLocationDirs) {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }

    // db 同步指纹：首启无 stamp → null；盖章后未变 → false；外部改动 mtime → true。
    // will-quit 的「checkpoint + 关库 + 盖章」链路无法在单进程冒烟里驱动，
    // 读写函数直驱；stamp 收尾清理，不给后续段落留污染。
    let dbSyncStampWorks = false
    try {
      const firstRead = detectExternalDbChange(app.getPath('userData'))
      writeDbSyncStamp()
      const unchanged = detectExternalDbChange(app.getPath('userData')) === false
      // 外部改动：把 db 的 mtime 拨回过去，指纹（收拢时刻的 mtime）必然不再匹配。
      await utimes(
        join(app.getPath('userData'), 'polaris.db'),
        new Date(2020, 0, 1),
        new Date(2020, 0, 1)
      )
      const changed = detectExternalDbChange(app.getPath('userData')) === true
      dbSyncStampWorks = firstRead === null && unchanged && changed
      if (!dbSyncStampWorks) {
        console.error('DB_SYNC_STAMP_FAIL', JSON.stringify({ firstRead, unchanged, changed }))
      }
    } finally {
      await unlink(join(app.getPath('userData'), 'polaris.db.sync-stamp')).catch(() => {})
    }

    // 重复任务继承：完成后旧实例保留自己的勾选，新实例复制全部步骤但全部重置为未完成。
    let subtaskRecurrenceWorks = false
    const recurrenceSubtaskIds: string[] = []
    try {
      const due = new Date()
      due.setHours(23, 59, 0, 0)
      const task = createTask({
        title: '冒烟子任务重复',
        dueAt: due.toISOString(),
        recurrenceRule: 'FREQ=DAILY'
      })
      recurrenceSubtaskIds.push(task.id)
      const first = createSubtask({ taskId: task.id, title: '步骤一' })
      createSubtask({ taskId: task.id, title: '步骤二' })
      updateSubtask({ id: first.id, completed: true })
      updateTask({ id: task.id, completed: true })

      const spawned = listTasks().find(
        (candidate) =>
          candidate.id !== task.id &&
          candidate.title === '冒烟子任务重复' &&
          !candidate.completed &&
          Boolean(candidate.recurrenceRule)
      )
      if (spawned) recurrenceSubtaskIds.push(spawned.id)

      const oldTask = listTasks().find((candidate) => candidate.id === task.id)
      const oldSubtasks = listSubtasks(task.id)
      const newSubtasks = spawned ? listSubtasks(spawned.id) : []
      subtaskRecurrenceWorks =
        Boolean(spawned) &&
        oldTask?.subtaskTotal === 2 &&
        oldTask?.subtaskDone === 1 &&
        oldSubtasks.length === 2 &&
        oldSubtasks.filter((item) => item.completed).length === 1 &&
        newSubtasks.length === 2 &&
        newSubtasks.every((item) => !item.completed) &&
        newSubtasks.map((item) => item.title).join('|') === '步骤一|步骤二'
      if (!subtaskRecurrenceWorks) {
        console.error(
          'SUBTASK_RECURRENCE_FAIL',
          JSON.stringify({ spawned: spawned?.id, oldTask, oldSubtasks, newSubtasks })
        )
      }
    } catch (error) {
      console.error('SUBTASK_RECURRENCE_ERROR', error)
    } finally {
      for (const id of recurrenceSubtaskIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
    }

    // 备份兼容：v2 带 subtasks 且勾选状态保留；v1（无 subtasks 字段）仍能通过校验并导入。
    let subtaskBackupWorks = false
    const backupSubtaskFixtureIds: string[] = []
    let backupSubtaskProjectId: string | null = null
    try {
      const project = createProject({ name: '冒烟子任务备份项目', color: '#5EEAD4' })
      backupSubtaskProjectId = project.id
      const task = createTask({
        title: '冒烟子任务备份',
        dueAt: new Date().toISOString(),
        projectId: project.id
      })
      backupSubtaskFixtureIds.push(task.id)
      const first = createSubtask({ taskId: task.id, title: '备份步骤一' })
      createSubtask({ taskId: task.id, title: '备份步骤二' })
      updateSubtask({ id: first.id, completed: true })

      const backup = exportBackup()
      const exported = backup.subtasks.filter((item) => item.taskId === task.id)
      const exportOk =
        exported.length === 2 &&
        exported.filter((item) => item.completed).length === 1 &&
        exported.map((item) => item.title).join('|') === '备份步骤一|备份步骤二'

      const copyTaskId = 'smoke-subtask-copy'
      const copy = {
        projects: backup.projects,
        tasks: backup.tasks.map((item) =>
          item.id === task.id ? { ...item, id: copyTaskId, title: '冒烟子任务备份副本' } : item
        ),
        subtasks: backup.subtasks.map((item, index) =>
          item.taskId === task.id
            ? { ...item, id: `smoke-subtask-copy-${index}`, taskId: copyTaskId }
            : item
        )
      }
      const imported = importBackup(copy)
      backupSubtaskFixtureIds.push(copyTaskId)
      const copied = listSubtasks(copyTaskId)
      const copiedTask = listTasks().find((item) => item.id === copyTaskId)
      const copyOk =
        imported.subtasksImported === 2 &&
        copied.length === 2 &&
        copied.filter((item) => item.completed).length === 1 &&
        copiedTask?.subtaskTotal === 2 &&
        copiedTask?.subtaskDone === 1

      // 旧备份：schemaVersion 1 且没有 subtasks 字段，必须照常解析、缺省为空数组。
      const v1 = backupSchema.safeParse({
        schemaVersion: 1,
        app: 'polaris',
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: []
      })
      const v1Ok = v1.success && v1.data.subtasks.length === 0
      const legacyImport = importBackup({ projects: [], tasks: [] })
      subtaskBackupWorks =
        exportOk &&
        copyOk &&
        v1Ok &&
        legacyImport.subtasksImported === 0 &&
        legacyImport.subtasksSkipped === 0
      if (!subtaskBackupWorks) {
        console.error(
          'SUBTASK_BACKUP_FAIL',
          JSON.stringify({ exportOk, copyOk, v1Ok, v1: v1.success ? v1.data : v1.error, imported, copied })
        )
      }
    } catch (error) {
      console.error('SUBTASK_BACKUP_ERROR', error)
    } finally {
      for (const id of backupSubtaskFixtureIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
      if (backupSubtaskProjectId) deleteProject(backupSubtaskProjectId)
    }

    // 标签重复继承与备份兼容：新实例继承标签；v3 导出带标签与关联；v1/v2 仍可导入。
    let tagRecurrenceWorks = false
    let tagBackupWorks = false
    const tagFixtureIds: string[] = []
    let tagFixtureProjectId: string | null = null
    let tagFixtureId: string | null = null
    let tagMapFixtureId: string | null = null
    try {
      const tag = createTag({ name: '冒烟继承标签' })
      tagFixtureId = tag.id
      const due = new Date()
      due.setHours(23, 59, 0, 0)
      const task = createTask({
        title: '冒烟标签重复',
        dueAt: due.toISOString(),
        recurrenceRule: 'FREQ=DAILY'
      })
      tagFixtureIds.push(task.id)
      updateTask({ id: task.id, tagIds: [tag.id] })
      updateTask({ id: task.id, completed: true })
      const spawned = listTasks().find(
        (candidate) =>
          candidate.id !== task.id &&
          candidate.title === '冒烟标签重复' &&
          !candidate.completed &&
          Boolean(candidate.recurrenceRule)
      )
      if (spawned) tagFixtureIds.push(spawned.id)
      const oldTask = listTasks().find((candidate) => candidate.id === task.id)
      tagRecurrenceWorks =
        Boolean(spawned) &&
        oldTask?.tags.some((item) => item.id === tag.id) === true &&
        spawned?.tags.some((item) => item.id === tag.id) === true
      if (!tagRecurrenceWorks) {
        console.error('TAG_RECURRENCE_FAIL', JSON.stringify({ spawned: spawned?.id, oldTags: oldTask?.tags, newTags: spawned?.tags }))
      }

      const project = createProject({ name: '冒烟标签备份项目', color: '#5EEAD4' })
      tagFixtureProjectId = project.id
      const backupTask = createTask({
        title: '冒烟标签备份',
        dueAt: new Date().toISOString(),
        projectId: project.id
      })
      tagFixtureIds.push(backupTask.id)
      updateTask({ id: backupTask.id, tagIds: [tag.id] })
      const backup = exportBackup()
      const exportOk =
        backup.tags.some((item) => item.id === tag.id) &&
        backup.taskTags.some((link) => link.taskId === backupTask.id && link.tagId === tag.id)
      // 旧备份：schemaVersion 2 没有 tags/taskTags 字段，必须照常解析、缺省为空数组。
      const v2 = backupSchema.safeParse({
        schemaVersion: 2,
        app: 'polaris',
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        subtasks: []
      })
      const v2Ok = v2.success && v2.data.tags.length === 0 && v2.data.taskTags.length === 0
      const legacyImport = importBackup({ projects: [], tasks: [] })
      // 同名不同 ID：备份里的标签行应被跳过，但备份 id 必须映射到本地同名
      // 标签，随后 taskTags 才能落到本地 id 上，而不是被静默丢掉。
      const sameNameTag = createTag({ name: '冒烟同名映射' })
      tagMapFixtureId = sameNameTag.id
      const mappedTaskId = 'smoke-tag-map-task'
      const mappedBackupTagId = 'smoke-tag-map-tag'
      const mappedSource = backup.tasks.find((item) => item.id === backupTask.id)!
      const mappedImport = importBackup({
        projects: [],
        tasks: [{ ...mappedSource, id: mappedTaskId, title: '冒烟同名映射任务', projectId: null }],
        tags: [{ id: mappedBackupTagId, name: '冒烟同名映射', createdAt: new Date().toISOString() }],
        taskTags: [{ taskId: mappedTaskId, tagId: mappedBackupTagId }]
      })
      tagFixtureIds.push(mappedTaskId)
      const mappedTask = getTask(mappedTaskId)
      const tagMappingWorks =
        mappedImport.tagsSkipped === 1 &&
        mappedImport.taskTagsImported === 1 &&
        Boolean(mappedTask?.tags.some((item) => item.id === sameNameTag.id))
      tagBackupWorks =
        exportOk &&
        v2Ok &&
        legacyImport.tagsImported === 0 &&
        legacyImport.taskTagsImported === 0 &&
        tagMappingWorks
      if (!tagBackupWorks) {
        console.error('TAG_BACKUP_FAIL', JSON.stringify({ exportOk, v2Ok, legacyImport, tagMappingWorks, mappedImport }))
      }
    } catch (error) {
      console.error('TAG_MAIN_ERROR', error)
    } finally {
      for (const id of tagFixtureIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
      if (tagFixtureId) deleteTag(tagFixtureId)
      if (tagMapFixtureId) deleteTag(tagMapFixtureId)
      if (tagFixtureProjectId) deleteProject(tagFixtureProjectId)
    }

    // 原子写：写入与覆盖内容正确，且目录里不留临时文件（只剩目标文件）。
    let atomicWriteWorks = false
    let atomicDir: string | null = null
    try {
      atomicDir = await mkdtemp(join(app.getPath('temp'), 'polaris-atomic-'))
      const file = join(atomicDir, 'backup.json')
      await writeFileAtomic(file, '{"v":1}')
      const first = await readFile(file, 'utf8')
      await writeFileAtomic(file, '{"v":2}')
      const second = await readFile(file, 'utf8')
      const entries = await readdir(atomicDir)
      const noTempLeftover = entries.every((name) => !name.endsWith('.tmp'))
      atomicWriteWorks = first === '{"v":1}' && second === '{"v":2}' && noTempLeftover && entries.length === 1
      if (!atomicWriteWorks) console.error('ATOMIC_WRITE_FAIL', JSON.stringify({ first, second, entries }))
    } catch (error) {
      console.error('ATOMIC_WRITE_ERROR', error)
    } finally {
      if (atomicDir) await rm(atomicDir, { recursive: true, force: true }).catch(() => {})
    }

    // 分数显示缩放：CDP 仿真 deviceScaleFactor 1.25/1.5/2，收起态外框仍守住 56px。
    // 同时校验 devicePixelRatio 确实等于设定值——证明仿真生效，断言非空转。
    let scalingFrameWorks = false
    if (mainWindow) {
      const dbg = mainWindow.webContents.debugger
      const attachedHere = !dbg.isAttached()
      if (attachedHere) dbg.attach('1.3')
      try {
        await mainWindow.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天'))?.click();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          const input = document.querySelector('.quick-add input');
          if (input) { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); }
          await sleep(300);
        })()`)
        let allOk = true
        for (const scale of [1.25, 1.5, 2]) {
          await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: scale, mobile: false })
          await settledFrames(mainWindow.webContents)
          const metrics = await mainWindow.webContents.executeJavaScript(`(() => {
            const shell = document.querySelector('.quick-add-shell');
            return { height: shell ? shell.getBoundingClientRect().height : -1, dpr: window.devicePixelRatio };
          })()`)
          const ok = Math.abs(metrics.height - 56) <= 1 && Math.abs(metrics.dpr - scale) < 0.01
          if (!ok) {
            allOk = false
            console.error('SCALING_FRAME_FAIL', JSON.stringify({ scale, height: metrics.height, dpr: metrics.dpr }))
          }
        }
        scalingFrameWorks = allOk
      } finally {
        await dbg.sendCommand('Emulation.clearDeviceMetricsOverride', {})
        if (attachedHere) dbg.detach()
      }
    }

    // 低分辨率视口：CDP 仿真 1024×536（1024×576 屏减任务栏的工作区），
    // 紧凑档必须让侧栏与今天视图一屏放下，页脚不落滚动线以下。
    let lowResFits = false
    if (mainWindow) {
      const dbg = mainWindow.webContents.debugger
      const attachedHere = !dbg.isAttached()
      if (attachedHere) dbg.attach('1.3')
      try {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1024, height: 536, deviceScaleFactor: 1, mobile: false })
        await settledFrames(mainWindow.webContents)
        const m = await mainWindow.webContents.executeJavaScript(`(async () => {
          const main = document.querySelector('.main');
          const sidebar = document.querySelector('.sidebar');
          const footer = document.querySelector('.view-footer');
          if (!main || !sidebar || !footer) return { ok: false, reason: 'missing nodes' };
          const mr = main.getBoundingClientRect();
          const fr = footer.getBoundingClientRect();
          const sr = sidebar.getBoundingClientRect();
          const st = document.querySelector('.settings-item');
          if (!st) return { ok: false, reason: 'missing settings' };
          const st_r = st.getBoundingClientRect();
          return {
            ok: true,
            compact: matchMedia('(max-height: 620px)').matches,
            mainOver: main.scrollHeight - main.clientHeight,
            sidebarOver: sidebar.scrollHeight - sidebar.clientHeight,
            footerBottom: fr.bottom,
            mainBottom: mr.bottom,
            settingsBottom: st_r.bottom,
            sidebarBottom: sr.bottom,
            rows: document.querySelectorAll('.task-item').length
          };
        })()`)
        lowResFits = m.ok && m.compact && m.mainOver <= 2 && m.sidebarOver <= 2 && m.footerBottom <= m.mainBottom + 1 && m.settingsBottom <= m.sidebarBottom + 1
        if (!lowResFits) console.error('LOW_RES_FAIL', JSON.stringify(m))
      } finally {
        await dbg.sendCommand('Emulation.clearDeviceMetricsOverride', {})
        if (attachedHere) dbg.detach()
      }
    }

    // 大列表窗口化（content-visibility:auto）：种子 1200 条同构任务直写主进程
    // SQLite（不走 1200 次 IPC），断言屏外行跳过渲染但占位尺寸生效、滚动锚定
    // 稳定、屏外行可勾选且落库、AnimatePresence 退场在屏外行上照常收敛卸载、
    // 紧凑档占位随媒体查询切换。性能预算一律用有界 waitFor（渲染等待放宽到
    // 20s 容忍机器偶发卡顿），不设硬毫秒阈值——硬阈值在用户活跃时段会假红。
    // 清场纪律：finally 里逐条软删 + 硬删（只软删会堆进回收站污染后续断言），
    // 渲染层拉回小列表并路由回「今天」。
    let largeListRenders = false
    let largeListWindowed = false
    let largeListRowHeight = false
    let largeListAnchorStable = false
    let largeListBottomInteractive = false
    let largeListOffscreenToggle = false
    let largeListExitSettles = false
    let largeListCompactTier = false
    const largeSeedIds: string[] = []
    const LARGE_SEED_COUNT = 1200
    try {
      const seedDue = new Date()
      seedDue.setHours(23, 59, 0, 0)
      for (let i = 0; i < LARGE_SEED_COUNT; i++) {
        largeSeedIds.push(
          createTask({ title: '冒烟大列表 ' + String(i).padStart(4, '0'), dueAt: seedDue.toISOString() }).id
        )
      }
      const big = await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const out = { step: 'route' };
        const pageErrors = [];
        const onError = (event) => pageErrors.push(String(event.message || 'error'));
        window.addEventListener('error', onError);
        try {
          const nav = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('全部任务'));
          if (!nav) { out.error = 'nav missing'; return out; }
          nav.click();
          window.dispatchEvent(new Event('focus'));
          out.step = 'render';
          const rendered = await waitFor(
            () => document.querySelectorAll('.task-section .task-list .task-item').length >= ${LARGE_SEED_COUNT},
            20000
          );
          out.renders = Boolean(rendered);
          if (!rendered) return out;
          await sleep(500); // 等入场 spring 沉降；入场只动 opacity/y，不改行高
          const main = document.querySelector('.main');
          main.scrollTop = 0;
          await sleep(200);
          const rows = [...document.querySelectorAll('.task-section .task-list .task-item')];
          // 只量自种行（无项目/标签/优先级，行高纯由骨架决定）；示例任务
          // 可能带标签 chip 或高优先级插队，不能拿 rows[0] 当标尺。
          const seedRows = rows.filter((el) => el.textContent.includes('冒烟大列表'));
          out.seedCount = seedRows.length;
          const mainRect = main.getBoundingClientRect();
          const near = seedRows[0];
          const far = seedRows[900];
          out.nearHeight = near.getBoundingClientRect().height;
          out.farTop = far.getBoundingClientRect().top;
          out.farHeight = far.getBoundingClientRect().height;
          out.pitch = seedRows[901].getBoundingClientRect().top - out.farTop;
          out.rowCount = rows.length;
          out.dpr = window.devicePixelRatio;
          out.farPadding = getComputedStyle(far).paddingTop;
          out.mainBottom = mainRect.bottom;
          out.farOffscreen = out.farTop > mainRect.bottom;
          out.farCv = getComputedStyle(far).contentVisibility;
          out.farContain = getComputedStyle(far).getPropertyValue('contain-intrinsic-block-size');
          out.scrollBefore = main.scrollHeight;
          // 滚动高度合理：1200 × (67.5 + 2 gap) ≈ 83400。下限证明屏外行
          // 没塌成 0（占位生效），上限证明占位没被放大。
          out.heightSane = main.scrollHeight > ${LARGE_SEED_COUNT} * 60 && main.scrollHeight < ${LARGE_SEED_COUNT} * 85;
          out.step = 'bottom';
          main.scrollTop = main.scrollHeight;
          await sleep(400);
          out.scrollAfter = main.scrollHeight;
          // 锚定稳定：占位与实测只差分数缩放的物理像素吸附（<1px/行），
          // 滚到底后总高只允许新渲染行的这类小幅修正，不允许量级跳变。
          out.anchorDelta = Math.abs(out.scrollAfter - out.scrollBefore);
          const last = rows[rows.length - 1];
          const lastVisible = await waitFor(() => {
            const r = last.getBoundingClientRect();
            return r.top >= mainRect.top - 1 && r.bottom <= mainRect.bottom + 1;
          });
          out.lastTitle = last.querySelector('.task-title').textContent;
          last.querySelector('.task-open').click();
          const detail = await waitFor(() => document.querySelector('.detail-title'));
          out.bottomInteractive = Boolean(lastVisible && detail && detail.value === out.lastTitle);
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await waitFor(() => !document.querySelector('.detail-title'));
          out.step = 'toggle';
          main.scrollTop = 0;
          await sleep(300);
          const toggleRow = seedRows[900];
          out.toggleId = toggleRow.dataset.taskId;
          toggleRow.querySelector('.task-check').click();
          // 勾选后行移入默认折叠的已完成区（列表尾部）：展开开关再验 .done。
          // 行挂载在屏外不影响 classList 断言，content-visibility 只省绘制。
          await expandCompleted();
          const toggled = await waitFor(() => {
            const node = document.querySelector('[data-task-id="' + CSS.escape(out.toggleId) + '"]');
            return node && node.classList.contains('done');
          });
          out.toggled = Boolean(toggled);
          out.step = 'exit';
          // 屏外行删除：AnimatePresence 退场 spring 必须照常收敛并卸载，
          // 页面无未捕获错误（motion 的 layout 测量打在占位盒上不应报错）。
          const exitRow = seedRows[1000];
          out.exitId = exitRow.dataset.taskId;
          out.exitOffscreen = exitRow.getBoundingClientRect().top > mainRect.bottom;
          exitRow.querySelector('.task-delete').click();
          const exited = await waitFor(
            () => !document.querySelector('[data-task-id="' + CSS.escape(out.exitId) + '"]'),
            8000
          );
          out.exited = Boolean(exited);
          out.pageErrors = pageErrors;
          out.step = 'done';
          return out;
        } catch (error) {
          out.error = String(error);
          out.pageErrors = pageErrors;
          return out;
        } finally {
          window.removeEventListener('error', onError);
        }
      })()`)
      // 紧凑档：CDP 仿真 1024×536，padding 收紧后整行占位自动 59.5px。
      // 量顶部的已渲染行（真实布局）；屏外探针取中段行——滚到底/退场聚焦
      // 渲染过的行会被 auto 记住常规档尺寸，不能拿来验证紧凑档占位。
      let compact: { compact?: boolean; nearHeight?: number; farHeight?: number; farCv?: string; farContain?: string; scrollHeight?: number } | null = null
      if (mainWindow && big?.renders === true) {
        const dbg = mainWindow.webContents.debugger
        const attachedHere = !dbg.isAttached()
        if (attachedHere) dbg.attach('1.3')
        try {
          await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1024, height: 536, deviceScaleFactor: 1, mobile: false })
          await settledFrames(mainWindow.webContents)
          compact = await mainWindow.webContents.executeJavaScript(`(async () => {
            ${pageHelpers}
            const main = document.querySelector('.main');
            main.scrollTop = 0;
            await sleep(300);
            const seedRows = [...document.querySelectorAll('.task-section .task-list .task-item')].filter((el) => el.textContent.includes('冒烟大列表'));
            const near = seedRows[0];
            const far = seedRows[600];
            return {
              compact: matchMedia('(max-height: 620px)').matches,
              nearHeight: near ? near.getBoundingClientRect().height : -1,
              farHeight: far ? far.getBoundingClientRect().height : -1,
              farCv: far ? getComputedStyle(far).contentVisibility : '',
              farContain: far ? getComputedStyle(far).getPropertyValue('contain-intrinsic-block-size') : '',
              scrollHeight: main.scrollHeight
            };
          })()`)
        } finally {
          await dbg.sendCommand('Emulation.clearDeviceMetricsOverride', {})
          if (attachedHere) dbg.detach()
        }
      }
      largeListRenders = big?.renders === true
      // 占位是内容盒估计（41.5px），padding 24 + 边框 2 由盒模型另加 →
      // 屏外行整行占位 67.5px，与渲染行实测同高（±1.5 容忍分数缩放的
      // 物理像素吸附）。farHeight 直接证明占位没有膨胀成 93.5px。
      largeListWindowed =
        big?.farOffscreen === true &&
        big?.farCv === 'auto' &&
        big?.farContain === 'auto 41.5px' &&
        typeof big?.farHeight === 'number' && Math.abs(big.farHeight - 67.5) <= 1.5 &&
        big?.heightSane === true
      largeListRowHeight = typeof big?.nearHeight === 'number' && Math.abs(big.nearHeight - 67.5) <= 1
      largeListAnchorStable = typeof big?.anchorDelta === 'number' && big.anchorDelta <= 200
      largeListBottomInteractive = big?.bottomInteractive === true
      // 落库走主进程直读 SQLite，不经渲染层 store 反算。
      const togglePersisted = typeof big?.toggleId === 'string' && getTask(big.toggleId)?.completed === true
      largeListOffscreenToggle = big?.toggled === true && togglePersisted
      largeListExitSettles =
        big?.exitOffscreen === true &&
        big?.exited === true &&
        Array.isArray(big?.pageErrors) && big.pageErrors.length === 0 &&
        (typeof big?.exitId === 'string' && getTask(big.exitId) === undefined)
      largeListCompactTier =
        compact?.compact === true &&
        typeof compact?.nearHeight === 'number' && Math.abs(compact.nearHeight - 59.5) <= 1 &&
        compact?.farCv === 'auto' &&
        compact?.farContain === 'auto 41.5px' &&
        typeof compact?.farHeight === 'number' && Math.abs(compact.farHeight - 59.5) <= 1.5 &&
        typeof compact?.scrollHeight === 'number' &&
        compact.scrollHeight > LARGE_SEED_COUNT * 55 && compact.scrollHeight < LARGE_SEED_COUNT * 75
      if (!largeListRenders || !largeListWindowed || !largeListRowHeight || !largeListAnchorStable ||
          !largeListBottomInteractive || !largeListOffscreenToggle || !largeListExitSettles || !largeListCompactTier) {
        console.error('LARGE_LIST_FAIL', JSON.stringify({ big, compact, togglePersisted }))
      }
    } catch (error) {
      console.error('LARGE_LIST_ERROR', error)
    } finally {
      for (const id of largeSeedIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
      // 渲染层拉回小列表并路由回「今天」，后续断言不受 1200 行影响。
      await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelectorAll('.task-item').length < 100, 10000);
        const nav = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes('今天'));
        nav?.click();
        const main = document.querySelector('.main');
        if (main) main.scrollTop = 0;
        await sleep(300);
      })()`).catch(() => {})
    }

    // 主视图页脚钉底（用户报障：任务多时快捷键提示/版本被滚出视口）：
    // .view-footer sticky bottom:0，吸住时底缘 == .main 底缘减 paddingBottom
    // （与 in-flow 落点同位）；40 条夹具量顶/中/底三态，滚到底回流仍同位
    // 零跳变；条件渐隐带顶/中亮（fade>0.9）、滚到底灭（fade<0.1）。量完即清。
    let mainFooterPinned = false
    const footerSeedIds: string[] = []
    try {
      const footerDue = new Date()
      footerDue.setHours(23, 59, 0, 0)
      for (let i = 0; i < 40; i++) {
        footerSeedIds.push(
          createTask({ title: '冒烟页脚 ' + String(i).padStart(2, '0'), dueAt: footerDue.toISOString() }).id
        )
      }
      const pin = await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        window.dispatchEvent(new Event('focus'));
        const main = document.querySelector('.main');
        await waitFor(() => document.querySelectorAll('.task-item').length >= 40, 10000);
        await sleep(400);
        const mr = main.getBoundingClientRect();
        const padB = parseFloat(getComputedStyle(main).paddingBottom);
        const at = async (top) => {
          main.scrollTop = top;
          // scrollTop 赋值与前值相同时不触发 scroll 事件（head 步骤常撞上
          // 初始就是 0），fade 状态停在 mount 时的 false——显式补发一次。
          main.dispatchEvent(new Event('scroll'));
          await sleep(260);
          const fr = document.querySelector('.view-footer').getBoundingClientRect();
          const fade = parseFloat(getComputedStyle(document.querySelector('.view-footer'), '::before').opacity);
          return {
            delta: Math.abs(fr.bottom - (mr.bottom - padB)),
            inside: fr.top >= mr.top && fr.bottom <= mr.bottom + 1,
            fade
          };
        };
        const head = await at(0);
        const mid = await at(Math.floor(main.scrollHeight / 2));
        const end = await at(main.scrollHeight);
        main.scrollTop = 0;
        await sleep(150);
        return { head, mid, end, sh: main.scrollHeight, ch: main.clientHeight };
      })()`)
      console.log('MAIN_FOOTER_PIN_METRICS', JSON.stringify(pin))
      mainFooterPinned =
        typeof pin?.sh === 'number' && typeof pin?.ch === 'number' && pin.sh > pin.ch &&
        pin?.head?.delta <= 1 && pin?.mid?.delta <= 1 && pin?.end?.delta <= 1 &&
        pin?.head?.inside === true && pin?.mid?.inside === true && pin?.end?.inside === true &&
        pin?.head?.fade > 0.9 && pin?.mid?.fade > 0.9 && pin?.end?.fade < 0.1
      if (!mainFooterPinned) console.error('MAIN_FOOTER_PIN_FAIL', JSON.stringify(pin))
    } catch (error) {
      console.error('MAIN_FOOTER_PIN_ERROR', error)
    } finally {
      for (const id of footerSeedIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
      await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => document.querySelectorAll('.task-item').length < 40, 10000);
        const main = document.querySelector('.main');
        if (main) main.scrollTop = 0;
        await sleep(200);
      })()`).catch(() => {})
    }

    // 关于署名区：设置窗口「关于」页展示字体/图标许可（OFL 可见署名义务）。
    const aboutCreditsShown =
      (await withSettings('about', false, async (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const credits = await waitFor(() => document.querySelector('.about-credits'));
          const text = credits ? credits.textContent : '';
          return text.includes('Lucide') && text.includes('OFL') && text.includes('Inter');
        })()`)
      )) === true

    // 设置窗口适配（独立子窗口）：MCP 启用最坏态 + 最小窗档（720×520），中英
    // 两轮五页横向零溢出（纵向滚动是窗口的设计行为，不算失败）；令牌掩码
    // k 封顶 12——头尾各 ≤12 hex、中段 ≥37 位永不上屏，盒按内容收窄，反馈槽
    // 吃中间余宽、复制/重置右对齐同一行。旧浮层的一屏守卫/居中/两列布局契约
    // 随面板一起退役，这里只钉独立窗口仍要守的规矩。
    let settingsWindowFits = false
    {
      setMcpEnabled(true)
      try {
        const settings = await openSettingsFor('mcp')
        if (settings) {
          settings.setSize(720, 520)
          await settledFrames(settings.webContents)
          const mcpPage = await settings.webContents.executeJavaScript(`(async () => {
            ${pageHelpers}
            const box = await waitFor(() => document.querySelector('.mcp-token-box'));
            if (!box) return { found: false };
            await sleep(250);
            const full = await window.polaris.app.getMcpToken();
            const boxText = box.textContent ?? '';
            const m = boxText.match(/^sk-([0-9a-f]+)…([0-9a-f]+)$/);
            const k = m ? m[2].length : 0;
            const row = box.closest('.mcp-token-row');
            const slot = row ? row.querySelector('.mcp-token-slot') : null;
            const actions = row ? row.querySelector('.mcp-token-actions') : null;
            const boxRect = box.getBoundingClientRect();
            const rowRect = row ? row.getBoundingClientRect() : null;
            const actRect = actions ? actions.getBoundingClientRect() : null;
            const slotRect = slot ? slot.getBoundingClientRect() : null;
            const buttons = actions ? [...actions.querySelectorAll('.backup-btn')].map((b) => b.textContent) : [];
            const content = document.querySelector('.settings-content');
            return {
              found: true,
              maskShape: Boolean(m),
              middleHidden: Boolean(m) && m[1].length === k && k >= 4 && k <= 12 &&
                !boxText.includes(full.slice(3 + k, full.length - k)),
              maskNotFull: boxText !== full,
              singleLine: box.scrollHeight <= box.clientHeight + 1,
              boxContentWidth: boxRect.width > 0 && boxRect.width < 260,
              slotBetween: Boolean(slotRect) && Boolean(actRect) && slotRect.right <= actRect.left + 1 && slotRect.left >= boxRect.right - 1,
              actionsFlush: Boolean(actRect) && Boolean(rowRect) && Math.abs(actRect.right - rowRect.right) <= 1,
              sameRow: Boolean(actRect) && Math.abs(actRect.top - boxRect.top) <= 2,
              slotOneLine: Boolean(slot) && slot.scrollHeight <= slot.clientHeight + 1,
              buttonsExact: buttons.length === 2 && buttons[0] === '复制' && buttons[1] === '重置',
              noHOverflow: Boolean(content) && content.scrollWidth <= content.clientWidth + 1
            };
          })()`)
          const pageFits: Array<boolean> = []
          for (const lang of ['zh-CN', 'en'] as const) {
            if (lang === 'en') {
              // 英文经真实下拉切换（外观页），量完切回中文。
              await showSettingsSection('appearance')
              await settings.webContents.executeJavaScript(`(async () => {
                ${pageHelpers}
                document.querySelector('.settings-language-select')?.click();
                await sleep(250);
                [...document.querySelectorAll('.settings-language-option')].find((o) => o.textContent.includes('English'))?.click();
                await sleep(350);
              })()`)
            }
            for (const section of ['appearance', 'general', 'hotkey', 'data', 'mcp', 'about'] as const) {
              await showSettingsSection(section)
              const ok = await settings.webContents.executeJavaScript(`(() => {
                const content = document.querySelector('.settings-content');
                const page = document.querySelector('.settings-page');
                return Boolean(content) && content.scrollWidth <= content.clientWidth + 1 &&
                  page?.getAttribute('data-settings-page') === '${section}';
              })()`)
              pageFits.push(ok === true)
            }
          }
          await showSettingsSection('appearance')
          await settings.webContents.executeJavaScript(`(async () => {
            ${pageHelpers}
            document.querySelector('.settings-language-select')?.click();
            await sleep(250);
            document.querySelector('[data-language-index="0"]')?.click();
            await sleep(350);
          })()`)
          settings.setSize(940, 700)
          await settledFrames(settings.webContents)
          await closeSettingsAndSettle()
          settingsWindowFits =
            mcpPage?.found === true && mcpPage?.maskShape === true && mcpPage?.middleHidden === true &&
            mcpPage?.maskNotFull === true && mcpPage?.singleLine === true && mcpPage?.boxContentWidth === true &&
            mcpPage?.slotBetween === true && mcpPage?.actionsFlush === true && mcpPage?.sameRow === true &&
            mcpPage?.slotOneLine === true && mcpPage?.buttonsExact === true && mcpPage?.noHOverflow === true &&
            pageFits.every((v) => v === true)
          if (!settingsWindowFits) console.error('SETTINGS_WINDOW_FITS_FAIL', JSON.stringify({ mcpPage, pageFits }))
        }
      } finally {
        setMcpEnabled(false)
      }
    }

    // 设置窗口布局与关于页：左导航右内容、五个分类、「关于」钉在导航末尾、
    // 窗口标题随语言；关于页品牌行的版本号来自主进程 app.getVersion()
    // （渲染层不得写死——期望值由主进程侧提供，不经渲染层反算）。
    let settingsWindowLayout = false
    {
      const layout = await withSettings('general', null, (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const nav = document.querySelector('.settings-nav');
          const content = document.querySelector('.settings-content');
          if (!nav || !content) return { found: false };
          const navRect = nav.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          const navItems = [...nav.querySelectorAll('.settings-nav-item')];
          const labels = navItems.map((b) => b.textContent);
          const aboutItem = nav.querySelector('[data-settings-section="about"]');
          const dataItem = nav.querySelector('[data-settings-section="data"]');
          const aboutPinned = aboutItem && dataItem
            ? aboutItem.getBoundingClientRect().top > dataItem.getBoundingClientRect().bottom
            : false;
          return {
            found: true,
            navLeft: navRect.right <= contentRect.left + 1,
            sixSections: labels.length === 6 && labels.includes('关于'),
            aboutPinned,
            generalTitle: document.querySelector('.settings-page-title')?.textContent === '常规',
            navTitle: document.querySelector('.settings-nav-title')?.textContent === '设置',
            docTitle: document.title.includes('设置')
          };
        })()`)
      )
      const about = await withSettings('about', null, (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const versionEl = await waitFor(() => document.querySelector('.about-brand-version'));
          const credits = await waitFor(() => document.querySelector('.about-credits'));
          const actions = [...document.querySelectorAll('.settings-card-actions .backup-btn')].map((b) => b.textContent);
          return {
            version: versionEl ? versionEl.textContent : '',
            creditsOk: Boolean(credits),
            noticesAction: actions.includes('打开声明目录')
          };
        })()`)
      )
      settingsWindowLayout =
        layout?.found === true && layout?.navLeft === true && layout?.sixSections === true &&
        layout?.aboutPinned === true && layout?.generalTitle === true && layout?.navTitle === true &&
        layout?.docTitle === true &&
        about?.version === app.getVersion() && about?.creditsOk === true && about?.noticesAction === true
      if (!settingsWindowLayout) console.error('SETTINGS_WINDOW_LAYOUT_FAIL', JSON.stringify({ layout, about }))
    }

    // 设置窗口生命周期：单例（侧栏再点「设置」/「关于」不叠第二扇，「关于」把
    // 已开的窗口切到关于页——经主进程的固定字符串切页事件）；窗口级 Esc 关窗
    // （无浮层挂着时）；关掉后还能经真实侧栏入口再开。
    // 快捷键列表一屏放下（用户报障 2026-11-25：不要纵向滚动条）：默认窗高下
    // 内容 scrollHeight 不超 clientHeight。窗口尺寸已由 fits 守卫还原到默认。
    let shortcutListFits = false
    {
      const fit = await withSettings('hotkey', null, (settings) =>
        settings.webContents.executeJavaScript(`(() => {
          const content = document.querySelector('.settings-content');
          if (!content) return null;
          return { noVScroll: content.scrollHeight <= content.clientHeight + 1, sh: content.scrollHeight, ch: content.clientHeight };
        })()`)
      )
      shortcutListFits = fit?.noVScroll === true
      if (!shortcutListFits) console.error('SHORTCUT_LIST_FITS_FAIL', JSON.stringify(fit))
    }

    let settingsWindowLifecycle = false
    {
      const settings = await openSettingsFor('appearance')
      if (settings) {
        // 侧栏「关于」入口已移除（2026-11-26，关于的唯一入口在设置窗口导航里）：
        // 切页动作改从设置窗口自己的「关于」导航项触发。
        await mainWindow!.webContents.executeJavaScript(`document.querySelector('.settings-item')?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 300))
        await settings.webContents.executeJavaScript(
          `document.querySelector('[data-settings-section="about"]')?.click()`
        )
        const switchedToAbout = await waitForCondition(async () => {
          const window = getSettingsWindow()
          if (!window) return false
          return window.webContents.executeJavaScript(
            `Boolean(document.querySelector('.settings-page[data-settings-page="about"]'))`
          )
        }, 4000)
        // 单例：两个入口各点一次后，全应用仍只有一扇设置窗口（URL hash 认门）。
        const singleton =
          BrowserWindow.getAllWindows().filter(
            (window) => !window.isDestroyed() && window.webContents.getURL().includes('#/settings')
          ).length === 1
        await settings.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
        )
        const escClosed = await waitForCondition(() => !isSettingsWindowVisible(), 4000)
        const reopened = await openSettingsFor('general')
        await closeSettingsAndSettle()
        settingsWindowLifecycle = switchedToAbout === true && singleton && escClosed && Boolean(reopened)
        if (!settingsWindowLifecycle) {
          console.error('SETTINGS_WINDOW_LIFECYCLE_FAIL', JSON.stringify({ switchedToAbout, singleton, escClosed, reopened: Boolean(reopened) }))
        }
      }
    }

    // 侧栏收起/展开（主窗口）：60px 图标栏、文字视觉隐藏但留在文档里（无障碍
    // 名称与断言仍可读）、收起态给 title 悬停提示、再点展开按原宽复位。
    let sidebarCollapseWorks = false
    {
      const collapse = await mainWindow!.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const btn = document.querySelector('.sidebar-collapse');
        if (!btn) return { found: false };
        const sidebar = document.querySelector('.sidebar');
        const before = sidebar.getBoundingClientRect().width;
        const expandedOk = !document.querySelector('.app-body').classList.contains('sidebar-collapsed') && before > 200;
        btn.click();
        const collapsed = await waitFor(() => document.querySelector('.app-body').classList.contains('sidebar-collapsed'));
        await sleep(320);
        const after = sidebar.getBoundingClientRect().width;
        const text = document.querySelector('.settings-item .nav-text');
        const textHidden = Boolean(text) && getComputedStyle(text).position === 'absolute' && text.textContent === '设置';
        const titleSet = document.querySelector('.settings-item').getAttribute('title') === '设置';
        const noAboutItem = !document.querySelector('.about-item');
        const dot = document.querySelector('.project-dot');
        const dotBigger = dot ? dot.getBoundingClientRect().width >= 9 : false;
        btn.click();
        const restored = await waitFor(() => !document.querySelector('.app-body').classList.contains('sidebar-collapsed'));
        await sleep(320);
        const widthBack = Math.abs(sidebar.getBoundingClientRect().width - before) <= 1;
        return { found: true, expandedOk, collapsed: Boolean(collapsed), narrow: Math.abs(after - 60) <= 1, textHidden, titleSet, noAboutItem, dotBigger, restored: Boolean(restored), widthBack };
      })()`)
      sidebarCollapseWorks =
        collapse?.found === true && collapse?.expandedOk === true && collapse?.collapsed === true &&
        collapse?.narrow === true && collapse?.textHidden === true && collapse?.titleSet === true && collapse?.noAboutItem === true &&
        collapse?.dotBigger === true && collapse?.restored === true &&
        collapse?.widthBack === true
      if (!sidebarCollapseWorks) console.error('SIDEBAR_COLLAPSE_FAIL', JSON.stringify(collapse))
    }

    // CSV 导出守卫：导入功能已移除，导出 CSV 独立成钮占原网格 cell。
    // UI 侧钉四钮 2×2、无分体箭头、无格式浮层残留；主进程侧用夹具任务
    // （子任务/标签/项目/完成态/引号逗号）走 csvExportFromBackup，逐行字面量
    // 比对导出文本（escaping/INDENT/优先级/墙钟/完成态），期望不经过被测代码回算。
    let csvExportWorks = false
    const csvFixtureIds: string[] = []
    let csvFixtureProject: string | null = null
    let csvFixtureTag: string | null = null
    try {
      const ui = await withSettings('data', null, (settings) =>
        settings.webContents.executeJavaScript(`(() => {
          const buttons = [...document.querySelectorAll('.backup-actions > .backup-btn')].map((b) => b.textContent);
          const noSplit = !document.querySelector('.backup-btn-split');
          const noPop = !document.querySelector('.csv-help');
          return { found: true, buttons, noSplit, noPop };
        })()`)
      )
      const project = createProject({ name: '冒烟CSV项目', color: '#5EEAD4' })
      csvFixtureProject = project.id
      const tag = createTag({ name: '冒烟CSV标签' })
      csvFixtureTag = tag.id
      const due = new Date()
      due.setHours(9, 0, 0, 0)
      const task = createTask({
        title: '冒烟CSV任务,带逗号',
        dueAt: due.toISOString(),
        projectId: project.id,
        priority: 3
      })
      csvFixtureIds.push(task.id)
      updateTask({ id: task.id, notes: '备注含"引号"与,逗号', tagIds: [tag.id] })
      createSubtask({ taskId: task.id, title: 'CSV步骤一' })
      createSubtask({ taskId: task.id, title: 'CSV步骤二' })
      const done = createTask({ title: '冒烟CSV已完成' })
      csvFixtureIds.push(done.id)
      updateTask({ id: done.id, completed: true })
      const text = csvExportFromBackup(exportBackup())
      const dueCell = formatCsvDue(due.toISOString())
      const wantParent = `task,"冒烟CSV任务,带逗号","备注含""引号""与,逗号",4,1,冒烟CSV项目,冒烟CSV标签,active,${dueCell},en,,`
      const wantSub1 = `task,CSV步骤一,,4,2,,,active,${dueCell},en,,`
      const wantSub2 = `task,CSV步骤二,,4,2,,,active,${dueCell},en,,`
      const wantDone = `task,冒烟CSV已完成,,1,1,,,completed,,en,,`
      const linesOk =
        text.startsWith('\uFEFF' + CSV_EXPORT_HEADERS.join(',') + '\r\n') &&
        text.includes(wantParent + '\r\n' + wantSub1 + '\r\n' + wantSub2 + '\r\n') &&
        text.includes(wantDone + '\r\n')
      csvExportWorks =
        ui?.found === true && ui?.noSplit === true && ui?.noPop === true &&
        JSON.stringify(ui?.buttons) === JSON.stringify(['导出备份', '导入备份', '导出 CSV', '导出 ICS', '载入示例', '打开数据目录']) &&
        linesOk
      if (!csvExportWorks) console.error('CSV_EXPORT_FAIL', JSON.stringify({ ui, linesOk }))
    } catch (error) {
      console.error('CSV_EXPORT_ERROR', error)
    } finally {
      for (const id of csvFixtureIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
      if (csvFixtureProject) deleteProject(csvFixtureProject)
      if (csvFixtureTag) deleteTag(csvFixtureTag)
    }

    // ICS 导出（P4.2）：主进程 fixture 与字面量逐行对比（同 csvExportWorks 的
    // 模式）；同一段 UI 探针顺带确认第五钮在网格里（上面 csvExportWorks 已断言
    // 按钮清单含「导出 ICS」，这里断言 ICS 文本本身）。
    let icsExportWorks = false
    const icsFixtureIds: string[] = []
    try {
      const due = new Date(2026, 11, 25, 9, 0, 0, 0)
      const timed = createTask({
        title: '冒烟ICS; 带分号',
        dueAt: due.toISOString(),
        startAt: due.toISOString(),
        endAt: new Date(2026, 11, 25, 10, 30, 0, 0).toISOString(),
        priority: 2
      })
      icsFixtureIds.push(timed.id)
      updateTask({ id: timed.id, notes: '备注, 含逗号' })
      const allDay = createTask({
        title: '冒烟ICS全天',
        dueAt: new Date(2026, 11, 26, 0, 0, 0, 0).toISOString(),
        startAt: new Date(2026, 11, 26, 0, 0, 0, 0).toISOString(),
        endAt: new Date(2026, 11, 27, 23, 59, 0, 0).toISOString(),
        allDay: true
      })
      icsFixtureIds.push(allDay.id)
      const done = createTask({ title: '冒烟ICS完成', dueAt: due.toISOString() })
      icsFixtureIds.push(done.id)
      updateTask({ id: done.id, completed: true })
      const noDate = createTask({ title: '冒烟ICS无日期' })
      icsFixtureIds.push(noDate.id)

      const { text, count } = icsExportFromBackup(exportBackup())
      // 冒烟时钟固定：DTSTAMP 用导出真实时刻，不能钉字面量，改用形状断言。
      const stampShape = /^DTSTAMP:\d{8}T\d{6}Z$/m
      // UTC 字面量：本机 UTC+8 → 2026-12-25 09:00 本地 = 20261225T010000Z。
      // DTSTAMP 夹在 UID 与 DTSTART 之间，逐段断言（每段都是真实连续行序）。
      const textOk =
        text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Polaris//Polaris Todo//CN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Polaris\r\n') &&
        text.endsWith('END:VCALENDAR\r\n') &&
        stampShape.test(text) &&
        text.includes(`UID:${timed.id}@polaris.local\r\n`) &&
        text.includes('DTSTART:20261225T010000Z\r\nDTEND:20261225T023000Z\r\nSUMMARY:冒烟ICS\\; 带分号\r\nDESCRIPTION:备注\\, 含逗号\r\nPRIORITY:5\r\nSTATUS:CONFIRMED\r\n') &&
        text.includes(`BEGIN:VEVENT\r\nUID:${allDay.id}@polaris.local\r\n`) &&
        text.includes('DTSTART;VALUE=DATE:20261226\r\nDTEND;VALUE=DATE:20261228\r\nSUMMARY:冒烟ICS全天\r\nPRIORITY:0\r\nSTATUS:CONFIRMED\r\n') &&
        text.includes('X-POLARIS-COMPLETED:TRUE') &&
        !text.includes('冒烟ICS无日期')
      icsExportWorks = textOk && count >= 3
      if (!icsExportWorks) console.error('ICS_EXPORT_FAIL', JSON.stringify({ textOk, count, sample: text.slice(0, 400) }))
    } catch (error) {
      console.error('ICS_EXPORT_ERROR', error)
    } finally {
      for (const id of icsFixtureIds) {
        deleteTask(id)
        deleteTaskForever(id)
      }
    }

    // 载入示例任务（主进程直调 loadSampleTasks）：合并语义对任意起点成立——
    // first 载入后任务数 = before + tasksAdded；立即再来一次应全部跳过（幂等）；
    // 软删+硬删删掉「时间段」示例（固定 ID）再载入，恰好补回 1 条且时段字段
    // 齐全；项目按名复用（不重名重建）。结束把示例行清干净，不留尾巴给后续守卫。
    let sampleLoadWorks = false
    try {
      const before = listTasks().length
      const projectsBefore = listProjects().length
      const first = loadSampleTasks('zh-CN')
      const afterFirst = listTasks().length
      const mergeOk = afterFirst === before + first.tasksAdded && afterFirst >= SAMPLE_TASKS.length
      const second = loadSampleTasks('zh-CN')
      const idempotent = second.tasksAdded === 0 && second.tasksSkipped === SAMPLE_TASKS.length
      deleteTask('sample-task-9')
      deleteTaskForever('sample-task-9')
      const third = loadSampleTasks('zh-CN')
      const refilled = getTask('sample-task-9')
      const refilledOk =
        third.tasksAdded === 1 &&
        Boolean(refilled?.startAt && refilled?.endAt) &&
        refilled?.allDay === false
      // 跨天全天示例只给 endDayOffset：加载器必须补出 endAt，否则月格/全天行
      // 只亮一天，与示例文案矛盾。
      const multiDay = getTask('sample-task-11')
      const multiDayStart = multiDay?.startAt ? new Date(multiDay.startAt) : null
      const multiDayEnd = multiDay?.endAt ? new Date(multiDay.endAt) : null
      const multiDayOk =
        multiDay?.allDay === true &&
        multiDayStart !== null &&
        multiDayEnd !== null &&
        multiDayEnd.getDate() !== multiDayStart.getDate()
      const projectsStable = listProjects().length === projectsBefore
      sampleLoadWorks = mergeOk && idempotent && refilledOk && multiDayOk && projectsStable
      if (!sampleLoadWorks) {
        console.error(
          'SAMPLE_LOAD_FAIL',
          JSON.stringify({ before, first, second, third, refilledOk, multiDayOk, projectsStable, afterFirst })
        )
      }
      // 清场：示例行软删+硬删，不污染后续守卫（trash 空态断言等）。
      for (const sample of SAMPLE_TASKS) {
        deleteTask(sample.id)
        deleteTaskForever(sample.id)
      }
    } catch (error) {
      console.error('SAMPLE_LOAD_ERROR', error)
    }

    // 设置页备份零抖动（独立窗口版）：列表住对话框，开/关 [管理…] 模态前后
    // 数据页外框/内容高度逐像素相等；行真渲染在对话框列表内（非恒真）、首行
    // 免滚可见、页面里没有内联展开体。3 份 fixture 触发列表分支，量完即清。
    let settingsBackupNoShift = false
    {
      const noShiftFixtureNames = [
        'polaris-auto-2026-11-19T00-00-01-000Z.json',
        'polaris-auto-2026-11-19T00-00-02-000Z.json',
        'polaris-auto-2026-11-19T00-00-03-000Z.json'
      ]
      const noShiftFixturePaths: string[] = []
      try {
        const noShiftBackupDir = join(app.getPath('userData'), 'backups')
        await mkdir(noShiftBackupDir, { recursive: true })
        for (const name of noShiftFixtureNames) {
          const fixturePath = join(noShiftBackupDir, name)
          await writeFileAtomic(fixturePath, JSON.stringify({ schemaVersion: 3, app: 'polaris', tasks: [], projects: [] }))
          noShiftFixturePaths.push(fixturePath)
        }
        const stable = await withSettings('data', null, (settings) => settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const page = document.querySelector('.settings-page');
          if (!page) return { found: false };
          const snap = () => ({ ph: page.getBoundingClientRect().height, sh: page.scrollHeight });
          const before = snap();
          document.querySelector('.auto-backup-manage')?.click();
          const dialog = await waitFor(() => document.querySelector('.backup-dialog-panel'));
          if (!dialog) return { found: true, dialog: false };
          const rows = await waitFor(() => dialog.querySelectorAll('.auto-backup-row').length >= 3, 8000);
          if (!rows) {
            const dbg = await window.polaris.backups.list();
            return {
              found: true, dialog: true, rows: false,
              err: dialog.querySelector('.settings-error')?.textContent ?? null,
              rowCount: dialog.querySelectorAll('.auto-backup-row').length,
              rowNames: [...dialog.querySelectorAll('.auto-backup-row')].map((r) => r.getAttribute('data-backup-name')),
              emptyHint: dialog.querySelector('.backup-dialog-empty')?.textContent ?? null,
              listOk: dbg.ok,
              listCount: dbg.items ? dbg.items.length : -1,
              listDetail: dbg.items ? dbg.items.map((i) => i.name) : dbg.error
            };
          }
          await sleep(300);
          const open = snap();
          const dlgRect = dialog.getBoundingClientRect();
          const list = dialog.querySelector('.auto-backup-list');
          const listRect = list ? list.getBoundingClientRect() : null;
          const rowRects = [...dialog.querySelectorAll('.auto-backup-row')].map((r) => r.getBoundingClientRect());
          // 收容契约：行住在对话框列表滚动内容里，首行免滚可见；列表超高
          // 对话框内滚动是设计行为（max-height 帽），不要求全行可见。
          const rowsInDialog = Boolean(listRect) && rowRects.every((r) =>
            r.left >= dlgRect.left - 1 && r.right <= dlgRect.right + 1 &&
            r.top >= listRect.top - 1 && r.bottom <= listRect.top + list.scrollHeight + 1);
          const firstRowVisible = rowRects.length > 0 && Boolean(listRect) &&
            rowRects[0].bottom <= Math.min(dlgRect.bottom, listRect.top + list.clientHeight) + 1;
          // 页面里永远没有内联展开体：列表只住对话框（按 closest 排除其子树）。
          const noInline = !document.querySelector('.auto-backup-body') &&
            [...document.querySelectorAll('.auto-backup-list')].every((el) => el.closest('.backup-dialog-panel'));
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await waitFor(() => !document.querySelector('.backup-dialog-panel'));
          await sleep(300);
          const closed = snap();
          const eq = (a, b) => a.ph === b.ph && a.sh === b.sh;
          return {
            found: true,
            dialog: true,
            rows: true,
            rowsInDialog,
            firstRowVisible,
            noInline,
            openStable: eq(before, open),
            closedStable: eq(before, closed)
          };
        })()`)
        )
        settingsBackupNoShift =
          stable?.found === true &&
          stable?.dialog === true &&
          stable?.rows === true &&
          stable?.rowsInDialog === true &&
          stable?.firstRowVisible === true &&
          stable?.noInline === true &&
          stable?.openStable === true &&
          stable?.closedStable === true
        if (!settingsBackupNoShift) console.error('SETTINGS_BACKUP_NO_SHIFT_FAIL', JSON.stringify(stable))
      } finally {
        for (const fixturePath of noShiftFixturePaths) await unlink(fixturePath).catch(() => {})
      }
    }

    // 托盘驻留开关：默认开；UI 往返持久化；开启时关窗=隐藏而非退出。
    let trayToggleWorks = false
    try {
      const defaultOn = await mainWindow?.webContents.executeJavaScript(`window.polaris.app.getCloseToTray()`)
      const uiRoundTrip = await withSettings('general', false, async (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const sel = '.switch[aria-label="关闭窗口后驻留托盘"]';
          const sw = document.querySelector(sel);
          if (!sw) return false;
          const initial = sw.getAttribute('aria-checked') === 'true';
          sw.click(); await sleep(200);
          const afterOff = await window.polaris.app.getCloseToTray();
          const offChecked = document.querySelector(sel).getAttribute('aria-checked') === 'false';
          document.querySelector(sel).click(); await sleep(200);
          const afterOn = await window.polaris.app.getCloseToTray();
          return initial === true && afterOff === false && offChecked && afterOn === true;
        })()`)
      )
      mainWindow?.close()
      const hiddenAlive = await waitForCondition(
        () => Boolean(mainWindow) && !mainWindow!.isDestroyed() && !mainWindow!.isVisible(),
        2000,
        50
      )
      mainWindow?.show()
      if (mainWindow) await settledFrames(mainWindow.webContents)
      trayToggleWorks = defaultOn === true && uiRoundTrip === true && hiddenAlive
      if (!trayToggleWorks) console.error('TRAY_TOGGLE_FAIL', JSON.stringify({ defaultOn, uiRoundTrip, hiddenAlive }))
    } catch (error) {
      console.error('TRAY_TOGGLE_ERROR', error)
    }

    // 托盘菜单增强：「设置 / 检查更新」真实存在于构建出来的菜单；
    // 「设置」与热键共用 revealAndDispatch 路径，隐藏窗口时也能唤起并开面板；
    // 「检查更新」反馈文案走纯函数表逐条验证；unsupported 环境把真实托盘
    // 检查路径走一遍，必须不唤起窗口、不弹更新对话框。
    // 放在更新合成快照之前：那时渲染层还是干净状态，noDialog 才可证。
    let trayMenuEntries = false
    let traySettingsOpens = false
    let trayCheckFeedback = false
    let trayCheckFeedbackEn = false
    let trayCheckSilent = false
    try {
      const labels = getTrayMenuLabels()
      trayMenuEntries =
        labels.length === 4 &&
        labels[0] === '打开 Polaris' &&
        labels[1] === '设置' &&
        labels[2] === '检查更新' &&
        labels[3] === '退出'
      if (!trayMenuEntries) console.error('TRAY_MENU_FAIL', JSON.stringify(labels))

      // 先藏窗口再走真实托盘路径：唤起主窗口 + 打开设置窗口要一次完成
      // （设置是主窗口的子窗口，主窗口不可见时不该独自出现）。全应用只有
      // 一扇设置窗口（URL hash 认门），量完关掉收尾。
      mainWindow?.hide()
      await revealSettings()
      const wokeForSettings = await waitForCondition(
        () => Boolean(mainWindow) && !mainWindow!.isDestroyed() && mainWindow!.isVisible(),
        2000,
        50
      )
      // 窗口创建是同步的，但 URL 要等导航开始才认得出 hash：先等它就绪再数。
      const settingsOpened = await waitForCondition(
        () => {
          const window = getSettingsWindow()
          return Boolean(window) && window!.webContents.getURL().includes('#/settings')
        },
        4000,
        50
      )
      const settingsWindowCount =
        BrowserWindow.getAllWindows().filter(
          (window) => !window.isDestroyed() && window.webContents.getURL().includes('#/settings')
        ).length
      await closeSettingsAndSettle()
      traySettingsOpens = wokeForSettings === true && settingsOpened === true && settingsWindowCount === 1
      if (!traySettingsOpens) console.error('TRAY_SETTINGS_FAIL', JSON.stringify({ wokeForSettings, settingsOpened, settingsWindowCount }))

      const feedbackBase = {
        currentVersion: '0.0.1',
        latestVersion: null,
        percent: null,
        transferred: null,
        total: null,
        bytesPerSecond: null,
        releaseNotes: null,
        skippedVersion: null,
        error: null
      }
      trayCheckFeedback =
        describeTrayCheck({ ...feedbackBase, status: 'unsupported' }).surface === false &&
        describeTrayCheck({ ...feedbackBase, status: 'unsupported' }).balloon.includes('不提供在线更新') &&
        describeTrayCheck({ ...feedbackBase, status: 'checking' }).surface === false &&
        describeTrayCheck({ ...feedbackBase, status: 'up-to-date' }).surface === false &&
        describeTrayCheck({ ...feedbackBase, status: 'up-to-date' }).balloon.includes('0.0.1') &&
        describeTrayCheck({ ...feedbackBase, status: 'available', latestVersion: '9.9.9' }).surface === true &&
        describeTrayCheck({ ...feedbackBase, status: 'available', latestVersion: '9.9.9' }).balloon.includes('9.9.9') &&
        describeTrayCheck({ ...feedbackBase, status: 'downloading', latestVersion: '9.9.9', percent: 42 }).balloon.includes('42%') &&
        describeTrayCheck({ ...feedbackBase, status: 'downloaded', latestVersion: '9.9.9' }).surface === true &&
        describeTrayCheck({ ...feedbackBase, status: 'error', error: '网络超时' }).surface === false &&
        describeTrayCheck({ ...feedbackBase, status: 'error', error: '网络超时' }).balloon.includes('网络超时')
      if (!trayCheckFeedback) console.error('TRAY_FEEDBACK_FAIL')

      // 同一张状态表逐条走英文：托盘气泡是主进程文案，必须跟界面语言一致。
      // 末尾统一扫一遍汉字，防止某个分支漏翻仍显示中文。
      const enFeedback = [
        describeTrayCheck({ ...feedbackBase, status: 'unsupported' }, 'en'),
        describeTrayCheck({ ...feedbackBase, status: 'checking' }, 'en'),
        describeTrayCheck({ ...feedbackBase, status: 'up-to-date' }, 'en'),
        describeTrayCheck({ ...feedbackBase, status: 'available', latestVersion: '9.9.9' }, 'en'),
        describeTrayCheck({ ...feedbackBase, status: 'downloading', latestVersion: '9.9.9', percent: 42 }, 'en'),
        describeTrayCheck({ ...feedbackBase, status: 'downloaded', latestVersion: '9.9.9' }, 'en'),
        describeTrayCheck({ ...feedbackBase, status: 'error', error: 'network timeout' }, 'en')
      ]
      trayCheckFeedbackEn =
        enFeedback[0].surface === false &&
        enFeedback[0].balloon.includes("aren't available") &&
        enFeedback[1].surface === false &&
        enFeedback[1].balloon.includes('Checking for updates') &&
        enFeedback[2].surface === false &&
        enFeedback[2].balloon.includes("You're up to date") &&
        enFeedback[2].balloon.includes('0.0.1') &&
        enFeedback[3].surface === true &&
        enFeedback[3].balloon.includes('Version v9.9.9') &&
        enFeedback[4].balloon.includes('Downloading v9.9.9 (42%)') &&
        enFeedback[5].surface === true &&
        enFeedback[5].balloon.includes('ready') &&
        enFeedback[6].surface === false &&
        enFeedback[6].balloon.includes('Update check failed') &&
        enFeedback.every((item) => !/[一-鿿]/.test(item.balloon))
      if (!trayCheckFeedbackEn) console.error('TRAY_FEEDBACK_EN_FAIL', JSON.stringify(enFeedback))

      // 真实路径走一遍：dev = unsupported，检查后窗口必须保持隐藏、无更新弹窗。
      mainWindow?.hide()
      await checkUpdatesFromTray()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const noUpdateDialog = await mainWindow!.webContents.executeJavaScript(`!document.querySelector('.update-panel')`)
      trayCheckSilent =
        Boolean(mainWindow) && !mainWindow!.isDestroyed() && !mainWindow!.isVisible() && noUpdateDialog === true
      mainWindow?.show()
      if (mainWindow) await settledFrames(mainWindow.webContents)
      if (!trayCheckSilent) console.error('TRAY_CHECK_SILENT_FAIL', JSON.stringify({ noUpdateDialog }))
    } catch (error) {
      console.error('TRAY_MENU_ERROR', error)
    }

    // 界面语言切换：页面文案、<html lang>、托盘菜单三处必须同步。
    // 切到英文后等 React 重渲染落定再读；切回中文复原，避免影响后续断言。
    let languageSwitchWorks = false
    try {
      const en = await mainWindow!.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const navTexts = () => [...document.querySelectorAll('.nav-section .nav-item .nav-text')].map((node) => node.textContent || '');
        window.__polarisSetLocale?.('en');
        const navEn = await waitFor(() => navTexts().includes('Today') && navTexts().includes('Upcoming'));
        const viewTitleEn = await waitFor(() => document.querySelector('.view-title')?.textContent === 'Today');
        const eyebrowEn = document.querySelector('.view-eyebrow')?.textContent || '';
        return { navEn, viewTitleEn, eyebrowEn, langEn: document.documentElement.lang };
      })()`)
      const trayEn = await waitForCondition(() => {
        const labels = getTrayMenuLabels()
        return (
          labels[0] === 'Open Polaris' &&
          labels[1] === 'Settings' &&
          labels[2] === 'Check for updates' &&
          labels[3] === 'Quit'
        )
      }, 3000, 50)
      // 托盘已是英文 = 主进程权威 locale 已落地，这时开设置窗口，首帧语言
      // （URL ?locale=）才是确定的英文；导航标题即语言守卫的取样点。
      const settingsNavTitleEn = await withSettings('appearance', '', (settings) =>
        settings.webContents.executeJavaScript(`document.querySelector('.settings-nav-title')?.textContent ?? ''`)
      )
      const zh = await mainWindow!.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const navTexts = () => [...document.querySelectorAll('.nav-section .nav-item .nav-text')].map((node) => node.textContent || '');
        window.__polarisSetLocale?.('zh-CN');
        const navZh = await waitFor(() => navTexts().includes('今天') && navTexts().includes('即将到来'));
        const viewTitleZh = await waitFor(() => document.querySelector('.view-title')?.textContent === '今天');
        const eyebrowZh = document.querySelector('.view-eyebrow')?.textContent || '';
        return { navZh, viewTitleZh, eyebrowZh, langZh: document.documentElement.lang };
      })()`)
      const trayZh = await waitForCondition(() => {
        const labels = getTrayMenuLabels()
        return labels[0] === '打开 Polaris' && labels[1] === '设置'
      }, 3000, 50)
      // 英文日期形如 "Nov 16 · Monday"，中文形如 "11月16日 · 星期一"。
      languageSwitchWorks =
        en?.navEn === true &&
        en?.viewTitleEn === true &&
        settingsNavTitleEn === 'Settings' &&
        en?.langEn === 'en' &&
        /^[A-Z][a-z]{2} \d{1,2} · [A-Z][a-z]+$/.test(String(en?.eyebrowEn)) &&
        trayEn === true &&
        zh?.navZh === true &&
        zh?.viewTitleZh === true &&
        zh?.langZh === 'zh-CN' &&
        /月\d{1,2}日 · 星期/.test(String(zh?.eyebrowZh)) &&
        trayZh === true
      if (!languageSwitchWorks) {
        console.error('LANGUAGE_SWITCH_FAIL', JSON.stringify({ en, zh, trayEn, trayZh }))
      }
    } catch (error) {
      console.error('LANGUAGE_SWITCH_ERROR', error)
    }

    // 语言下拉手绘菜单：弹出层必须用主题 panel 令牌而不是系统白底，
    // 点选选项走真实 setLocale 路径，Esc 只收菜单不收设置面板。
    let languageMenuThemed = false
    try {
      const menuResult = await withSettings('appearance', null, (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const trigger = document.querySelector('.settings-language-select');
          if (!trigger) return { found: false };
          trigger.click();
          const menu = await waitFor(() => document.querySelector('.settings-language-menu'));
          if (!menu) return { found: true, menu: false };
          // 令牌对照：临时节点吃 var(--panel-bg)，与菜单实际背景逐字节比。
          const probe = document.createElement('div');
          probe.style.background = 'var(--panel-bg)';
          document.body.appendChild(probe);
          const tokenBg = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const menuBg = getComputedStyle(menu).backgroundColor;
          const themed = menuBg === tokenBg && menuBg !== 'rgb(255, 255, 255)';
          const options = [...menu.querySelectorAll('.settings-language-option')];
          const twoOptions = options.length === 2 && options[0].getAttribute('aria-selected') === 'true';
          // 点英文选项：真实点击路径切语言，菜单收起，触发器文案跟随。
          options[1].click();
          const switchedEn = await waitFor(() => document.documentElement.lang === 'en' && !document.querySelector('.settings-language-menu'));
          const triggerEn = document.querySelector('.settings-language-select')?.textContent?.includes('English') === true;
          // 再切回中文复原，避免影响后续断言。
          document.querySelector('.settings-language-select').click();
          const menu2 = await waitFor(() => document.querySelector('.settings-language-menu'));
          menu2?.querySelector('[data-language-index="0"]')?.click();
          const switchedZh = await waitFor(() => document.documentElement.lang === 'zh-CN');
          // Esc 只收菜单：在聚焦选项上派发 Escape，设置窗口必须还在。
          document.querySelector('.settings-language-select').click();
          const menu3 = await waitFor(() => document.querySelector('.settings-language-menu'));
          const activeOption = menu3?.querySelector('.settings-language-option.is-active');
          activeOption?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const escClosedMenu = await waitFor(() => !document.querySelector('.settings-language-menu'));
          const windowStillOpen = Boolean(document.querySelector('.settings-window'));
          return { found: true, themed, menuBg, tokenBg, twoOptions, switchedEn, triggerEn, switchedZh, escClosedMenu, windowStillOpen };
        })()`)
      )
      languageMenuThemed =
        menuResult?.found === true &&
        menuResult?.themed === true &&
        menuResult?.twoOptions === true &&
        menuResult?.switchedEn === true &&
        menuResult?.triggerEn === true &&
        menuResult?.switchedZh === true &&
        menuResult?.escClosedMenu === true &&
        menuResult?.windowStillOpen === true
      if (!languageMenuThemed) console.error('LANGUAGE_MENU_FAIL', JSON.stringify(menuResult))
    } catch (error) {
      console.error('LANGUAGE_MENU_ERROR', error)
    }

    // 全局热键：默认开且注册成功、设置开关 IPC 往返 + meta 持久化、
    // 组合键被占用时降级为「开但未注册」并给出中文提示、隐藏窗口时按热键
    // 能唤起窗口、切回「今天」并聚焦输入框。真实按键无法从页面合成，
    // 这里直接调用热键处理器 revealQuickCapture 走同一条路径。
    let hotkeyDefaultOn = false
    let hotkeySettingsRoundTrip = false
    let hotkeyConflictDegrades = false
    let hotkeyAcceleratorCustom = false
    let shortcutNavigationWorks = false
    let shortcutRebindWorks = false
    let hotkeyWakesAndFocuses = false
    try {
      const initial = getGlobalHotkeyState()
      // 环境预检：加速键已被其他程序占用（截图工具 / PowerToys / 电脑管家 /
      // 音乐播放器等都可能占 Ctrl+Alt+P）时，下面三个断言必然红——显式打一
      // 行醒目提示，免得从 FAILED 数组里猜环境原因。
      if (initial.registered === false) {
        console.error(
          'HOTKEY_ENV_OCCUPIED Ctrl+Alt+P 已被其他程序占用（设置行会显示冲突错误），' +
            'hotkeyDefaultOn / hotkeySettingsRoundTrip / hotkeyConflictDegrades 将因此失败；' +
            '请在占用程序里改键或退出后重跑。'
        )
      }
      hotkeyDefaultOn =
        initial.enabled === true &&
        initial.registered === true &&
        initial.accelerator === 'Ctrl+Alt+P' &&
        getMeta('global_hotkey') === null &&
        getMeta('global_hotkey_accelerator') === null &&
        getMeta('app_shortcuts') === null

      const roundTrip = await withSettings('hotkey', null, (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const row = document.querySelector('.shortcut-row[data-shortcut-row="global"]');
          const sw = row ? row.querySelector('.switch') : null;
          const caps = row ? [...row.querySelectorAll('.shortcut-keycap')].map((k) => k.textContent).join('+') : '';
          const described = caps === 'Ctrl+Alt+P';
          const initialChecked = sw ? sw.getAttribute('aria-checked') === 'true' : false;
          if (!sw) {
            return { found: true, described, initialChecked, off: null, offChecked: false, on: null, onChecked: false };
          }
          sw.click();
          await sleep(250);
          const off = await window.polaris.app.getGlobalHotkey();
          const offSwitch = document.querySelector('.switch[aria-label="全局快速添加"]');
          const offChecked = offSwitch ? offSwitch.getAttribute('aria-checked') === 'false' : false;
          offSwitch?.click();
          await sleep(250);
          const on = await window.polaris.app.getGlobalHotkey();
          const onSwitch = document.querySelector('.switch[aria-label="全局快速添加"]');
          const onChecked = onSwitch ? onSwitch.getAttribute('aria-checked') === 'true' : false;
          return { found: true, described, initialChecked, off, offChecked, on, onChecked };
        })()`)
      )

      // meta 持久化单独验证：关掉写 '0' 且立刻注销，再打开写 '1' 并重新注册。
      setGlobalHotkeyEnabled(false)
      const offPersisted =
        getMeta('global_hotkey') === '0' &&
        globalShortcut.isRegistered(GLOBAL_HOTKEY_ACCELERATOR) === false
      setGlobalHotkeyEnabled(true)
      const onPersisted =
        getMeta('global_hotkey') === '1' &&
        globalShortcut.isRegistered(GLOBAL_HOTKEY_ACCELERATOR) === true

      hotkeySettingsRoundTrip =
        roundTrip?.found === true &&
        roundTrip?.described === true &&
        roundTrip?.initialChecked === true &&
        roundTrip?.off?.enabled === false &&
        roundTrip?.off?.registered === false &&
        roundTrip?.offChecked === true &&
        roundTrip?.on?.enabled === true &&
        roundTrip?.on?.registered === true &&
        roundTrip?.onChecked === true &&
        offPersisted &&
        onPersisted

      // 占用模拟：先关掉我们的注册，再由测试进程占住同一个组合键。此时再打开
      // 开关，register() 必须失败，但用户的「开」仍要保留，并给出中文原因。
      setGlobalHotkeyEnabled(false)
      const occupied = globalShortcut.register(GLOBAL_HOTKEY_ACCELERATOR, () => {})
      const conflict = setGlobalHotkeyEnabled(true)
      const conflictUi = await withSettings('hotkey', false, async (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const row = document.querySelector('.shortcut-row[data-shortcut-row="global"]');
          const sw = row ? row.querySelector('.switch') : null;
          // 占用报错整行换行落 .shortcut-row-error（role=alert）。
          const err = row ? row.querySelector('.shortcut-row-error') : null;
          return Boolean(sw) && sw.getAttribute('aria-checked') === 'true' &&
            Boolean(err) && err.getAttribute('role') === 'alert' &&
            err.textContent.includes('被其他程序占用');
        })()`)
      )
      globalShortcut.unregister(GLOBAL_HOTKEY_ACCELERATOR)
      setGlobalHotkeyEnabled(false)
      const recovered = setGlobalHotkeyEnabled(true)

      hotkeyConflictDegrades =
        occupied === true &&
        conflict.enabled === true &&
        conflict.registered === false &&
        typeof conflict.error === 'string' &&
        conflict.error.includes('被其他程序占用') &&
        conflictUi === true &&
        recovered.enabled === true &&
        recovered.registered === true

      // 全局热键改键（快捷键页列表铅笔 → 内联录制 → 按下即自动应用）：默认组合
      // 被占的机器上也要走得通——先探测挑一个实测空闲候选，走真实 UI 换绑落库。
      // 应用信号 = 录制框消失且全局行键帽变成新组合。收尾先关热键再写默认组合
      // （关闭态写入不试注册，不受占用影响），最后开回。
      {
        const probed = probeHotkeyAccelerators(['Ctrl+Alt+T', 'Ctrl+Alt+N', 'Ctrl+Shift+P', 'Alt+Shift+P'])
        const picked = probed.find((item) => item.free)?.accelerator
        const ui = await withSettings('hotkey', null, (settings) =>
          settings.webContents.executeJavaScript(`(async () => {
            ${pageHelpers}
            const edit = await waitFor(() => document.querySelector('.shortcut-row[data-shortcut-row="global"] .shortcut-edit'));
            if (!edit) return { found: false };
            edit.click();
            const recorder = await waitFor(() => document.querySelector('.shortcut-recorder'));
            if (!recorder) return { found: true, recorder: false };
            const parts = ${JSON.stringify(picked ?? '')}.split('+');
            const key = parts[parts.length - 1];
            recorder.dispatchEvent(new KeyboardEvent('keydown', {
              key: key.toLowerCase(), code: 'Key' + key,
              ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'),
              bubbles: true, cancelable: true
            }));
            const applied = await waitFor(() => {
              if (document.querySelector('.shortcut-recorder')) return false;
              const caps = [...document.querySelectorAll('.shortcut-row[data-shortcut-row="global"] .shortcut-keycap')].map((k) => k.textContent).join('+');
              return caps === ${JSON.stringify(picked ?? '')} ? true : false;
            });
            return { found: true, recorder: true, applied: Boolean(applied) };
          })()`)
        )
        const after = getGlobalHotkeyState()
        const metaApplied = getMeta('global_hotkey_accelerator') === picked
        setGlobalHotkeyEnabled(false)
        setGlobalHotkeyAccelerator(GLOBAL_HOTKEY_ACCELERATOR)
        setGlobalHotkeyEnabled(true)
        const restored = getMeta('global_hotkey_accelerator') === GLOBAL_HOTKEY_ACCELERATOR
        hotkeyAcceleratorCustom =
          typeof picked === 'string' &&
          ui?.recorder === true &&
          ui?.applied === true &&
          after.accelerator === picked &&
          after.registered === true &&
          metaApplied &&
          restored
        if (!hotkeyAcceleratorCustom) {
          console.error('HOTKEY_CUSTOM_FAIL', JSON.stringify({ picked, ui, after, metaApplied, restored }))
        }
      }

      // 视图导航快捷键（默认 Ctrl+1-8）：非输入态按 Ctrl+数字切视图，侧栏 active 项随之变。
      {
        const nav = await mainWindow?.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          const activeText = () => document.querySelector('.nav-item.active .nav-text')?.textContent ?? '';
          const press = (digit) => window.dispatchEvent(new KeyboardEvent('keydown', { key: digit, code: 'Digit' + digit, ctrlKey: true, bubbles: true, cancelable: true }));
          press('2');
          const upcoming = await waitFor(() => activeText() === '即将到来');
          press('3');
          const calendar = await waitFor(() => activeText() === '日历');
          press('1');
          const today = await waitFor(() => activeText() === '今天');
          return { upcoming: Boolean(upcoming), calendar: Boolean(calendar), today: Boolean(today) };
        })()`)
        shortcutNavigationWorks = nav?.upcoming === true && nav?.calendar === true && nav?.today === true
        if (!shortcutNavigationWorks) console.error('SHORTCUT_NAV_FAIL', JSON.stringify(nav))
      }

      // 应用内改键（列表铅笔 → 内联录制）：view-today 1→9 落库 + 主窗口 focus 重拉
      // 后按 9 回今天；冲突检测（view-upcoming 改成 9 应被拒）；收尾还原默认。
      {
        const ui = await withSettings('hotkey', null, (settings) =>
          settings.webContents.executeJavaScript(`(async () => {
            ${pageHelpers}
            const edit = await waitFor(() => document.querySelector('.shortcut-row[data-shortcut-row="view-today"] .shortcut-edit'));
            edit.click();
            let rec = await waitFor(() => document.querySelector('.shortcut-recorder'));
            rec.dispatchEvent(new KeyboardEvent('keydown', { key: '9', code: 'Digit9', bubbles: true, cancelable: true }));
            const rebound = await waitFor(() => !document.querySelector('.shortcut-recorder'));
            const edit2 = document.querySelector('.shortcut-row[data-shortcut-row="view-upcoming"] .shortcut-edit');
            edit2.click();
            rec = await waitFor(() => document.querySelector('.shortcut-recorder'));
            rec.dispatchEvent(new KeyboardEvent('keydown', { key: '9', code: 'Digit9', bubbles: true, cancelable: true }));
            const conflictShown = await waitFor(() => {
              const r = document.querySelector('.shortcut-recorder');
              return r && r.textContent.includes('冲突') ? true : false;
            });
            rec.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await waitFor(() => !document.querySelector('.shortcut-recorder'));
            return { rebound: Boolean(rebound), conflictShown: Boolean(conflictShown) };
          })()`)
        )
        const metaRebound = (getMeta('app_shortcuts') ?? '').includes('"view-today":"9"')
        const effect = await mainWindow?.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          window.dispatchEvent(new Event('focus'));
          await sleep(200);
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '9', code: 'Digit9', bubbles: true, cancelable: true }));
          const viaNine = await waitFor(() => document.querySelector('.nav-item.active .nav-text')?.textContent === '今天');
          return { viaNine: Boolean(viaNine) };
        })()`)
        await mainWindow?.webContents.executeJavaScript(`window.polaris.app.setShortcut('view-today', 'Ctrl+1')`)
        const metaRestored = !(getMeta('app_shortcuts') ?? '').includes('view-today')
        shortcutRebindWorks =
          ui?.rebound === true && ui?.conflictShown === true &&
          metaRebound && effect?.viaNine === true && metaRestored
        if (!shortcutRebindWorks) console.error('SHORTCUT_REBIND_FAIL', JSON.stringify({ ui, metaRebound, effect, metaRestored }))
      }

      // 隐藏窗口 + 先切到「统计」：热键要同时负责唤起、回今天、聚焦输入框。
      const switchedAway = await mainWindow?.webContents.executeJavaScript(`(async () => {
        ${pageHelpers}
        const nav = [...document.querySelectorAll('.nav-item')].find((el) => el.querySelector('.nav-text')?.textContent === '统计');
        if (!nav) return false;
        nav.click();
        return Boolean(await waitFor(() => document.querySelector('.view-title')?.textContent === '统计'));
      })()`)

      mainWindow?.hide()
      const hidden = await waitForCondition(
        () => Boolean(mainWindow) && !mainWindow!.isDestroyed() && !mainWindow!.isVisible(),
        2000,
        50
      )
      await revealQuickCapture()
      const woke = await waitForCondition(
        () => Boolean(mainWindow) && !mainWindow!.isDestroyed() && mainWindow!.isVisible(),
        2000,
        50
      )
      const focused = await waitForCondition(async () => {
        if (!mainWindow || mainWindow.webContents.isDestroyed()) return false
        return (
          (await mainWindow.webContents.executeJavaScript(`(() => {
            const input = document.querySelector('.quick-add input');
            return document.querySelector('.view-title')?.textContent === '今天' && Boolean(input) && document.activeElement === input;
          })()`)) === true
        )
      }, 3000, 50)
      hotkeyWakesAndFocuses = switchedAway === true && hidden && woke && focused
      if (!hotkeyWakesAndFocuses) {
        console.error('HOTKEY_WAKE_FAIL', JSON.stringify({ switchedAway, hidden, woke, focused }))
      }
      if (!hotkeySettingsRoundTrip) {
        console.error('HOTKEY_ROUND_TRIP_FAIL', JSON.stringify({ roundTrip, offPersisted, onPersisted }))
      }
      if (!hotkeyConflictDegrades) {
        console.error('HOTKEY_CONFLICT_FAIL', JSON.stringify({ occupied, conflict, conflictUi, recovered }))
      }
    } catch (error) {
      console.error('HOTKEY_CHECK_ERROR', error)
    }

    // 在线更新：纯逻辑真值表 + 设置页手动检查（dev 无通道，答案必须确定）+
    // 用合成快照走真实 update:state 推送通道，驱动弹窗全流程：
    // 发现 → 进度 → 就绪 → 稍后不再弹 → 设置页重开 → 跳过持久化 → 安装守卫。
    const updateLogicTable =
      normalizeReleaseNotes('  fix bug  ') === 'fix bug' &&
      normalizeReleaseNotes('') === null &&
      normalizeReleaseNotes(null) === null &&
      normalizeReleaseNotes(undefined) === null &&
      normalizeReleaseNotes([{ note: 'a' }, { note: ' b ' }, { note: '' }]) === 'a\n\nb' &&
      normalizeReleaseNotes([{ note: '' }]) === null &&
      normalizeReleaseNotes(42) === null &&
      shouldSurfaceUpdate('1.2.3', null, false) === true &&
      shouldSurfaceUpdate('1.2.3', '1.2.3', false) === false &&
      shouldSurfaceUpdate('1.2.3', '1.2.3', true) === true &&
      shouldSurfaceUpdate('1.2.4', '1.2.3', false) === true &&
      // 焦点/唤醒补查节流闸：恰好到点放行、差 1ms 挡住、时钟回拨放行。
      shouldAutoCheck(null, 1_000_000, 1_800_000) === true &&
      shouldAutoCheck(1_000_000, 2_800_000, 1_800_000) === true &&
      shouldAutoCheck(1_000_000, 2_799_999, 1_800_000) === false &&
      shouldAutoCheck(1_000_000, 999_999, 1_800_000) === true &&
      shouldAutoCheck(Number.NaN, 1_000_000, 1_800_000) === true
    // 立即重启前的系统通知文案：中英期望值全部写死字面量，不经被测代码反算。
    // 真实 Notification 弹出只在打包版可达（dev 走 notReady 早退分支），属手动验证项。
    const installingZh = installingNotice('0.4.893')
    const installingEn = installingNotice('0.4.893', 'en')
    const updateInstallingNotice =
      installingZh.title === 'Polaris 正在更新到 v0.4.893' &&
      installingZh.body === '正在后台安装，窗口会消失几秒钟，装好后自动重新打开。' &&
      installingEn.title === 'Polaris is updating to v0.4.893' &&
      installingEn.body ===
        'Installing in the background. The window will disappear for a few seconds and reopen automatically when done.'
    if (!updateInstallingNotice) console.error('UPDATE_INSTALLING_NOTICE_FAIL', JSON.stringify({ installingZh, installingEn }))
    // 下载进度格式化与速度平滑：期望值全部写死字面量，不经过被测函数反算。
    const UPDATE_MB = 1024 * 1024
    const updateFormatTable =
      formatBytes(0) === '0 KB' &&
      formatBytes(18.1 * UPDATE_MB) === '18.1 MB' &&
      formatBytes(172 * UPDATE_MB) === '172.0 MB' &&
      formatBytes(-1) === null &&
      formatBytes(null) === null &&
      formatSpeed(2.8 * UPDATE_MB) === '2.8 MB/s' &&
      formatSpeed(512 * 1024) === '512 KB/s' &&
      formatSpeed(0) === '0 KB/s' &&
      formatSpeed(Number.NaN) === null &&
      estimateEtaSeconds(172 * UPDATE_MB, 18.1 * UPDATE_MB, 2.8 * UPDATE_MB) === 55 &&
      estimateEtaSeconds(100, 100, 2) === 0 &&
      estimateEtaSeconds(100, 50, 0) === null &&
      estimateEtaSeconds(null, 50, 2) === null &&
      estimateEtaSeconds(100, null, 2) === null &&
      estimateEtaSeconds(100, 50, null) === null &&
      formatEta(56, 'zh-CN') === '56 秒' &&
      formatEta(56, 'en') === '56s' &&
      formatEta(120, 'zh-CN') === '约 2 分钟' &&
      formatEta(120, 'en') === '~2 min' &&
      formatEta(0, 'zh-CN') === '1 秒' &&
      formatEta(null) === null &&
      smoothSpeed(null, 100) === 100 &&
      smoothSpeed(null, 0) === null &&
      smoothSpeed(100, 200) === 130 &&
      Math.abs((smoothSpeed(130, 0) ?? 0) - 91) < 1e-9 &&
      smoothSpeed(100, Number.NaN) === 100
    let updateSettingsCheck = false
    let updateDialogFlow = false
    let updateProgressDetails = false
    let updateMetaStable = false
    let updateSkipPersists = false
    let updateNotesRendered = false
    let updateInstallGuard = false
    try {
      const wc = mainWindow!.webContents
      const pushUpdate = (over: Record<string, unknown>): void => {
        wc.send('update:state', {
          status: 'available',
          currentVersion: app.getVersion(),
          latestVersion: '99.0.0',
          percent: 0,
          transferred: null,
          total: null,
          bytesPerSecond: null,
          releaseNotes: '修复若干问题\n提升稳定性',
          skippedVersion: getMeta('update_skipped_version'),
          error: null,
          ...over
        })
      }

      // 先做手动检查：此时渲染层还是真实快照（dev = unsupported），
      // 答案必须确定且不弹窗；合成快照之后会覆盖渲染层状态，不能反过来。
      // 检查入口在设置窗口的「关于」页（独立窗口自己的更新状态行）。
      const manualCheck = await withSettings('about', null, (settings) =>
        settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          const btn = [...document.querySelectorAll('.update-action')].find((b) => b.textContent === '检查更新');
          btn?.click();
          const answered = await waitFor(() => {
            const line = document.querySelector('.settings-update-status');
            return line && line.textContent.includes('当前环境不提供在线更新') ? line : null;
          });
          const state = await window.polaris.update.getState();
          const noDialog = !document.querySelector('.update-panel');
          return { found: Boolean(btn), answered: Boolean(answered), unsupported: state?.status === 'unsupported', noDialog };
        })()`)
      )
      updateSettingsCheck =
        manualCheck?.found === true &&
        manualCheck?.answered === true &&
        manualCheck?.unsupported === true &&
        manualCheck?.noDialog === true

      pushUpdate({})
      const dialogShown = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const dlg = await waitFor(() => document.querySelector('.update-panel'));
        if (!dlg) return { found: false };
        await sleep(300);
        const text = dlg.textContent;
        const install = dlg.querySelector('.update-install');
        return {
          found: true,
          titled: text.includes('软件更新') && text.includes('发现新版本可用'),
          versions: text.includes('99.0.0') && text.includes('${app.getVersion()}'),
          notes: text.includes('修复若干问题') && text.includes('提升稳定性'),
          installDisabled: install ? install.disabled : false
        };
      })()`)
      pushUpdate({ status: 'downloading', percent: 42 })
      const progressShown = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const bar = await waitFor(() => document.querySelector('.update-progress [role="progressbar"], .update-progress[role="progressbar"]'));
        if (!bar) return false;
        return bar.getAttribute('aria-valuenow') === '42' && bar.textContent.includes('42%');
      })()`)
      // 带完整字节字段的下载快照：上排「下载中… / 已下载 / 总量」，
      // 下排「速度 / 预计剩余」。ETA 由纯函数按 (total-transferred)/speed 算。
      pushUpdate({
        status: 'downloading',
        percent: 11,
        transferred: 18.1 * UPDATE_MB,
        total: 172 * UPDATE_MB,
        bytesPerSecond: 2.8 * UPDATE_MB
      })
      const progressDetails = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const bar = await waitFor(() => {
          const el = document.querySelector('.update-progress[role="progressbar"]');
          return el && el.textContent.includes('18.1 MB / 172.0 MB') ? el : null;
        });
        if (!bar) return { found: false };
        const eta = await waitFor(() => bar.querySelector('.update-progress-eta'));
        return {
          found: true,
          label: bar.textContent.includes('下载中…'),
          bytes: bar.textContent.includes('18.1 MB / 172.0 MB'),
          speed: bar.textContent.includes('2.8 MB/s'),
          eta: eta ? eta.textContent.includes('预计 55 秒') : false
        };
      })()`)
      // 速度为 0：ETA 槽常驻但落空串（语义隐藏），速度仍可读，且不允许 NaN/Infinity 漏进界面。
      pushUpdate({
        status: 'downloading',
        percent: 11,
        transferred: 18.1 * UPDATE_MB,
        total: 172 * UPDATE_MB,
        bytesPerSecond: 0
      })
      const progressNoEta = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const bar = await waitFor(() => {
          const el = document.querySelector('.update-progress[role="progressbar"]');
          return el && el.textContent.includes('0 KB/s') ? el : null;
        });
        if (!bar) return { found: false };
        const etaEl = bar.querySelector('.update-progress-eta');
        return {
          found: true,
          noEta: !etaEl || etaEl.textContent === '',
          noBadValue: !bar.textContent.includes('NaN') && !bar.textContent.includes('Infinity')
        };
      })()`)
      updateProgressDetails =
        progressDetails?.found === true &&
        progressDetails?.label === true &&
        progressDetails?.bytes === true &&
        progressDetails?.speed === true &&
        progressDetails?.eta === true &&
        progressNoEta?.found === true &&
        progressNoEta?.noEta === true &&
        progressNoEta?.noBadValue === true
      pushUpdate({ status: 'downloaded', percent: 100 })
      const readyAndLater = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const ready = await waitFor(() => document.querySelector('.update-ready'));
        if (!ready) return { ready: false };
        const readyText = ready.textContent.includes('下载完成');
        const install = document.querySelector('.update-install');
        const enabled = install ? !install.disabled : false;
        const later = [...document.querySelectorAll('.update-panel button')].find((b) => b.textContent === '稍后');
        later?.click();
        // 退场是弹簧动画，等它真正离场而不是赌一个固定时长。
        const closed = (await waitFor(() => !document.querySelector('.update-panel'))) === true;
        return { ready: true, readyText, enabled, closed };
      })()`)
      // 「稍后」过的版本：再推同版本快照不许自动弹。
      pushUpdate({ status: 'downloaded', percent: 100 })
      const staysDismissed = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        await sleep(450);
        return !document.querySelector('.update-panel');
      })()`)
      // 设置窗口关于页「查看更新」重开 → 「跳过此版本」关闭并持久化。
      // 设置窗口的 store 只收主进程推送/IPC 回执：合成快照先直接发给它
      // （dismissedVersion 忠实还原「稍后」已记账的状态——真实推送带它），
      // 「查看更新」负责重开弹窗。
      const skipViaSettings = await withSettings('about', null, async (settings) => {
        settings.webContents.send('update:state', {
          status: 'downloaded',
          currentVersion: app.getVersion(),
          latestVersion: '99.0.0',
          percent: 100,
          transferred: null,
          total: null,
          bytesPerSecond: null,
          releaseNotes: '修复若干问题\n提升稳定性',
          skippedVersion: getMeta('update_skipped_version'),
          dismissedVersion: '99.0.0',
          error: null
        })
        return settings.webContents.executeJavaScript(`(async () => {
          ${pageHelpers}
          // 快照经 IPC 落地后 React 重渲染是异步的：状态行与按钮都要轮询等，
          // 不能发完快照就查一次 DOM。
          const desc = await waitFor(() => {
            const line = document.querySelector('.settings-update-status');
            return line && line.textContent.includes('99.0.0 已就绪') ? true : null;
          });
          const viewBtn = await waitFor(() =>
            [...document.querySelectorAll('.update-action')].find((b) => b.textContent === '查看更新')
          );
          if (!viewBtn) return { found: false };
          viewBtn.click();
          const dlg = await waitFor(() => document.querySelector('.update-panel'));
          const reopened = Boolean(dlg);
          const skipBtn = [...document.querySelectorAll('.update-panel button')].find((b) => b.textContent === '跳过此版本');
          skipBtn?.click();
          const closed = (await waitFor(() => !document.querySelector('.update-panel'))) === true;
          return { found: true, desc: Boolean(desc), reopened, closed };
        })()`)
      })
      const skippedState = await wc.executeJavaScript(`window.polaris.update.getState()`)
      updateSkipPersists =
        skipViaSettings?.found === true &&
        skipViaSettings?.desc === true &&
        skipViaSettings?.reopened === true &&
        skipViaSettings?.closed === true &&
        skippedState?.skippedVersion === '99.0.0' &&
        getMeta('update_skipped_version') === '99.0.0'
      // 跳过后的版本再推快照：保持安静。
      pushUpdate({ status: 'downloaded', percent: 100 })
      const skipStaysSilent = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        await sleep(450);
        return !document.querySelector('.update-panel');
      })()`)
      updateDialogFlow =
        dialogShown?.found === true &&
        dialogShown?.titled === true &&
        dialogShown?.versions === true &&
        dialogShown?.notes === true &&
        dialogShown?.installDisabled === true &&
        progressShown === true &&
        readyAndLater?.ready === true &&
        readyAndLater?.readyText === true &&
        readyAndLater?.enabled === true &&
        readyAndLater?.closed === true &&
        staysDismissed === true &&
        skipStaysSilent === true
      // HTML 说明（GitHub atom feed 的真实形态）：富文本渲染、标签不露出、
      // script 被 DOMPurify 消毒——纯文本分支已由前面的 dialogShown 覆盖。
      pushUpdate({
        status: 'downloaded',
        percent: 100,
        latestVersion: '99.0.2',
        releaseNotes: '<h2>更新标题</h2><ul><li>条目一</li><li>条目二</li></ul><script>window.__pwned=1</script>'
      })
      const notesRendered = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const body = await waitFor(() => document.querySelector('.update-notes-body.rich'));
        if (!body) return { found: false };
        const text = body.textContent;
        const result = {
          found: true,
          rendered: text.includes('更新标题') && text.includes('条目一') && text.includes('条目二'),
          noRawTags: !text.includes('<h2>') && !text.includes('<li>'),
          sanitized: !body.querySelector('script') && window.__pwned === undefined
        };
        const later = [...document.querySelectorAll('.update-panel button')].find((b) => b.textContent === '稍后');
        later?.click();
        await waitFor(() => !document.querySelector('.update-panel'));
        return result;
      })()`)
      updateNotesRendered =
        notesRendered?.found === true &&
        notesRendered?.rendered === true &&
        notesRendered?.noRawTags === true &&
        notesRendered?.sanitized === true
      if (!updateNotesRendered) console.error('UPDATE_NOTES_FAIL', JSON.stringify(notesRendered))
      // 安装守卫：未打包环境点「立即重启」必须报错且进程活着。
      pushUpdate({ status: 'downloaded', percent: 100, latestVersion: '99.0.1' })
      const installAttempt = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const dlg = await waitFor(() => document.querySelector('.update-panel'));
        if (!dlg) return false;
        const install = dlg.querySelector('.update-install');
        if (!install || install.disabled) return false;
        install.click();
        await sleep(450);
        return true;
      })()`)
      const guardState = await wc.executeJavaScript(`window.polaris.update.getState()`)
      updateInstallGuard =
        installAttempt === true &&
        !wc.isDestroyed() &&
        typeof guardState?.error === 'string' &&
        guardState.error.includes('无法安装')
      // 更新弹窗零抖动与完成/重启反馈：速度/ETA 行常驻占位槽，四档快照
      // （速度 null→有值→null→100% 校验）面板顶边与高度零位移；校验文案落槽；
      // 点重启先落「正在重启」反馈再被守卫报错重置（dev 不 quit 进程）。
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
      pushUpdate({ status: 'downloading', percent: 40, transferred: 26700000, total: 66800000, bytesPerSecond: null, latestVersion: '99.0.3' })
      const metaMeasure = () => wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const dlg = document.querySelector('.update-panel');
        if (!dlg) return null;
        const r = dlg.getBoundingClientRect();
        return { top: r.top, h: r.height, meta: dlg.querySelector('.update-progress-meta')?.textContent ?? null };
      })()`)
      await pause(250)
      const m1 = await metaMeasure()
      pushUpdate({ status: 'downloading', percent: 60, transferred: 40000000, total: 66800000, bytesPerSecond: 1400000, latestVersion: '99.0.3' })
      await pause(250)
      const m2 = await metaMeasure()
      pushUpdate({ status: 'downloading', percent: 60, transferred: 40000000, total: 66800000, bytesPerSecond: null, latestVersion: '99.0.3' })
      await pause(250)
      const m3 = await metaMeasure()
      pushUpdate({ status: 'downloading', percent: 100, transferred: 66800000, total: 66800000, bytesPerSecond: null, latestVersion: '99.0.3' })
      await pause(250)
      const m4 = await metaMeasure()
      const metaStable = [m1, m2, m3, m4].every((m) => m && Math.abs(m.top - m1.top) <= 1 && Math.abs(m.h - m1.h) <= 1)
      const metaAlways = [m1, m2, m3, m4].every((m) => m && m.meta !== null)
      const speedShown = (m2?.meta ?? '').includes('MB/s')
      const verifyingShown = (m4?.meta ?? '').includes('校验安装包')
      pushUpdate({ status: 'downloaded', percent: 100, transferred: 66800000, total: 66800000, latestVersion: '99.0.3' })
      await pause(250)
      const installFeedback = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const dlg = document.querySelector('.update-panel');
        const btn = dlg?.querySelector('.update-install');
        if (!btn || btn.disabled) return { found: false };
        btn.click();
        const labeled = await waitFor(() => btn.textContent.includes('正在重启'));
        // dev 守卫报错推回的是主进程自身快照（unsupported/无版本号），合成态被洗、
        // 弹窗整体卸载属预期；真实生产快照带版本号，错误会落在弹窗里。
        await sleep(600);
        const mainError = (await window.polaris.update.getState())?.error ?? null;
        return { found: true, labeled: Boolean(labeled), mainError };
      })()`)
      // 重置语义单独钉：推带 error 的就绪快照，installing 必须被效应重置回可点。
      pushUpdate({ status: 'downloaded', percent: 100, latestVersion: '99.0.4', error: '合成守卫错误' })
      await pause(250)
      const installReset = await wc.executeJavaScript(`(async () => {
        ${pageHelpers}
        const dlg = await waitFor(() => document.querySelector('.update-panel'));
        if (!dlg) return { found: false };
        const btn = dlg.querySelector('.update-install');
        const errDiv = dlg.querySelector('.settings-error');
        const reset = btn?.textContent.includes('立即重启') === true && btn?.disabled === false;
        const later = [...dlg.querySelectorAll('button')].find((b) => b.textContent === '稍后');
        later?.click();
        await waitFor(() => !document.querySelector('.update-panel'));
        return { found: true, reset, errored: Boolean(errDiv) };
      })()`)
      updateMetaStable =
        metaStable === true && metaAlways === true && speedShown === true && verifyingShown === true &&
        installFeedback?.found === true && installFeedback?.labeled === true &&
        typeof installFeedback?.mainError === 'string' && installFeedback.mainError.includes('无法安装') &&
        !wc.isDestroyed() &&
        installReset?.found === true && installReset?.reset === true && installReset?.errored === true
      if (!updateMetaStable) console.error('UPDATE_META_STABLE_FAIL', JSON.stringify({ m1, m2, m3, m4, metaStable, metaAlways, speedShown, verifyingShown, installFeedback, installReset }))
      if (!updateLogicTable) console.error('UPDATE_LOGIC_FAIL')
      if (!updateFormatTable) console.error('UPDATE_FORMAT_FAIL')
      if (!updateDialogFlow) console.error('UPDATE_DIALOG_FAIL', JSON.stringify({ dialogShown, progressShown, readyAndLater, staysDismissed, skipStaysSilent }))
      if (!updateProgressDetails) console.error('UPDATE_PROGRESS_DETAILS_FAIL', JSON.stringify({ progressDetails, progressNoEta }))
      if (!updateSkipPersists) console.error('UPDATE_SKIP_FAIL', JSON.stringify({ skipViaSettings, skippedState }))
      if (!updateSettingsCheck) console.error('UPDATE_SETTINGS_FAIL', JSON.stringify(manualCheck))
      if (!updateInstallGuard) console.error('UPDATE_GUARD_FAIL', JSON.stringify({ installAttempt, guardState }))
    } catch (error) {
      console.error('UPDATE_CHECK_ERROR', error)
    }

    // 逐条具名，而不是串成一条 && 链：失败时必须能一眼看出是哪条断言。
    // 只筛 result 里 value === false 是不够的 —— afterAdd / afterDelete /
    // commandCount 是数值比较，版本号是字符串比较，它们失败时 JSON 里
    // 一个 false 都没有，排查会得出「没有失败项」的假结论。
    if (result.pickerBlurKeepsHour !== true) {
      console.error('PICKER_BLUR_FAIL', JSON.stringify(result.pickerBlurDetail))
    }
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
      languageParseEnChip: result.languageParseEnChip === true,
      languageParseEnDismiss: result.languageParseEnDismiss === true,
      languageParseEnWorks: result.languageParseEnWorks === true,
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
      mcpWorks,
      mcpAuthRejects: mcpAuthRejects === true,
      mcpTokenRegenerate: mcpTokenRegenerate === true,
      recurrenceClampTable: recurrenceOk === true,
      parseGrammarTable: parseAssertions.grammar === true,
      parseGrammarEnTable: parseAssertions.english === true,
      parseInvariants: parseAssertions.invariants === true,
      parseFormatNull: parseAssertions.format === true,
      parseLayoutNarrow: parseLayoutNarrow === true,
      parseLayoutWide: parseLayoutWide === true,
      reminderSurfaceTested: reminderSurfaceTested === true,
      paletteEscWorks: paletteEscWorks === true,
      emptyStateWorks: emptyStateWorks === true,
      // 已完成区默认折叠：N=0 隐藏 / 折叠勾选计数 +1 不自动展开 / 展开可见 /
      // 收起卸载 / 切视图重置，全链一条具名断言。
      completedCollapsedByDefault: completedCollapsedByDefault === true,
      statsViewOpens: statsViewOpens === true,
      statsNumbersCorrect: statsNumbersCorrect === true,
      statsRangeToggle: statsRangeToggle === true,
      projectManageWorks: projectManageWorks === true,
      completedAtShown: completedAtShown === true,
      reminderSnoozeWorks: reminderSnoozeWorks === true,
      customRecurrenceTable: customRecurrenceOk === true,
      backupNameTable: backupNameOk === true,
      customRepeatUiWorks: customRepeatUiWorks === true,
      backupRoundTripWorks: backupRoundTripWorks === true,
      autoBackupListWorks: autoBackupListWorks === true,
      dataLocationWorks: dataLocationWorks === true,
      dbSyncStampWorks: dbSyncStampWorks === true,
      atomicWriteWorks: atomicWriteWorks === true,
      scalingFrameWorks: scalingFrameWorks === true,
      lowResFits: lowResFits === true,
      largeListRenders: largeListRenders === true,
      largeListWindowed: largeListWindowed === true,
      largeListRowHeight: largeListRowHeight === true,
      largeListAnchorStable: largeListAnchorStable === true,
      largeListBottomInteractive: largeListBottomInteractive === true,
      largeListOffscreenToggle: largeListOffscreenToggle === true,
      largeListExitSettles: largeListExitSettles === true,
      largeListCompactTier: largeListCompactTier === true,
      mainFooterPinned: mainFooterPinned === true,
      aboutCreditsShown: aboutCreditsShown === true,
      settingsWindowFits: settingsWindowFits === true,
      settingsWindowLayout: settingsWindowLayout === true,
      shortcutListFits: shortcutListFits === true,
      settingsWindowLifecycle: settingsWindowLifecycle === true,
      sidebarCollapseWorks: sidebarCollapseWorks === true,
      csvExportWorks: csvExportWorks === true,
      settingsBackupNoShift: settingsBackupNoShift === true,
      trayToggleWorks: trayToggleWorks === true,
      trayMenuEntries: trayMenuEntries === true,
      traySettingsOpens: traySettingsOpens === true,
      trayCheckFeedback: trayCheckFeedback === true,
      trayCheckFeedbackEn: trayCheckFeedbackEn === true,
      trayCheckSilent: trayCheckSilent === true,
      languageSwitchWorks: languageSwitchWorks === true,
      languageMenuThemed: languageMenuThemed === true,
      hotkeyDefaultOn: hotkeyDefaultOn === true,
      hotkeySettingsRoundTrip: hotkeySettingsRoundTrip === true,
      hotkeyConflictDegrades: hotkeyConflictDegrades === true,
      hotkeyAcceleratorCustom: hotkeyAcceleratorCustom === true,
      shortcutNavigationWorks: shortcutNavigationWorks === true,
      shortcutRebindWorks: shortcutRebindWorks === true,
      hotkeyWakesAndFocuses: hotkeyWakesAndFocuses === true,
      subtaskRowProgress: subtaskRowProgress === true,
      subtaskDetailChain: subtaskDetailChain === true,
      subtaskRenamed: subtaskRenamed === true,
      subtaskPersisted: subtaskPersisted === true,
      subtaskPurged: subtaskPurged === true,
      subtaskRecurrenceWorks: subtaskRecurrenceWorks === true,
      subtaskBackupWorks: subtaskBackupWorks === true,
      focusRevisionGate: focusRevisionGate === true,
      subtaskFieldRollback: subtaskFieldRollback === true,
      updateLogicTable: updateLogicTable === true,
      updateInstallingNotice: updateInstallingNotice === true,
      updateFormatTable: updateFormatTable === true,
      updateSettingsCheck: updateSettingsCheck === true,
      updateDialogFlow: updateDialogFlow === true,
      updateProgressDetails: updateProgressDetails === true,
      updateMetaStable: updateMetaStable === true,
      updateSkipPersists: updateSkipPersists === true,
      updateNotesRendered: updateNotesRendered === true,
      updateInstallGuard: updateInstallGuard === true,
      // 四象限偏好套件：编辑弹窗/级联/分组/快速添加/恢复默认的门控断言。
      matrixPrefsWorks: matrixPrefsWorks === true
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
          mcpWorks,
          mcpAuthRejects,
          mcpTokenRegenerate,
          recurrenceClampTable: recurrenceOk,
          paletteEscWorks,
          emptyStateWorks,
          completedCollapsedByDefault,
          statsViewOpens,
          statsNumbersCorrect,
          statsRangeToggle,
          projectManageWorks,
          completedAtShown,
          reminderSnoozeWorks,
          customRecurrenceTable: customRecurrenceOk,
          backupNameTable: backupNameOk,
          customRepeatUiWorks,
          backupRoundTripWorks,
          autoBackupListWorks,
          dataLocationWorks,
          dbSyncStampWorks,
          atomicWriteWorks,
          scalingFrameWorks,
          lowResFits,
          largeListRenders,
          largeListWindowed,
          largeListRowHeight,
          largeListAnchorStable,
          largeListBottomInteractive,
          largeListOffscreenToggle,
          largeListExitSettles,
          largeListCompactTier,
          mainFooterPinned,
          aboutCreditsShown,
          settingsWindowFits,
          settingsWindowLayout,
          shortcutListFits,
          settingsWindowLifecycle,
          sidebarCollapseWorks,
          csvExportWorks,
          settingsBackupNoShift,
          trayToggleWorks,
          trayMenuEntries,
          traySettingsOpens,
          trayCheckFeedback,
          trayCheckFeedbackEn,
          trayCheckSilent,
          languageSwitchWorks,
          languageMenuThemed,
          hotkeyDefaultOn,
          hotkeySettingsRoundTrip,
          hotkeyConflictDegrades,
          hotkeyAcceleratorCustom,
          shortcutNavigationWorks,
          shortcutRebindWorks,
          hotkeyWakesAndFocuses,
          subtaskRowProgress,
          subtaskDetailChain,
          subtaskRenamed,
          subtaskPersisted,
          subtaskPurged,
          subtaskRecurrenceWorks,
          subtaskBackupWorks,
          focusRevisionGate,
          subtaskFieldRollback,
          updateLogicTable,
          updateInstallingNotice,
          updateFormatTable,
          updateSettingsCheck,
          updateDialogFlow,
          updateProgressDetails,
          updateMetaStable,
          updateSkipPersists,
          updateNotesRendered,
          updateInstallGuard,
          tagUiWorks,
          tagRecurrenceWorks,
          tagBackupWorks,
          matrixWorks,
          matrixPrefsWorks,
          calendarWorks,
          calendarSuiteWorks,
          icsExportWorks,
          sampleLoadWorks,
          parseGrammarTable: parseAssertions.grammar,
          parseInvariants: parseAssertions.invariants,
          parseFormatNull: parseAssertions.format,
          parseGrammarEnTableJson: parseAssertions.english,
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
