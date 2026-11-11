# Polaris

Windows 11 上的本地优先待办应用。深色墨黑界面、青绿信号色、原生窗口控件，数据默认只保存在本机。

[![版本](https://img.shields.io/badge/version-0.1.0-0F766E?style=flat-square)](package.json)
[![平台](https://img.shields.io/badge/platform-Windows%2011-334155?style=flat-square)](package.json)
[![许可证](https://img.shields.io/badge/license-MIT-0F766E?style=flat-square)](package.json)

## 项目简介

Polaris 面向 Windows 11 桌面，用 Electron 构建，数据落在本机 SQLite 文件里，不依赖账号或云同步。界面使用简体中文，强调键盘操作、可访问性和安静的视觉层级。

## 技术栈

| 类别 | 技术 | 版本 |
|---|---|---|
| 运行时 | Electron | 45.3（Chromium 156 / Node 24） |
| 构建 | electron-vite / Vite / TypeScript | 6.0 / 8.3 / 7.0 |
| 界面 | React / Tailwind CSS / Motion / Zustand | 19.3 / 4.3 / 14.12 / 5.1 |
| 数据 | better-sqlite3 / rrule / zod | 13.0 / 2.8 / 4.6 |
| 打包 | electron-builder（NSIS） | 26.18 |
| 图标与日期 | lucide-react / date-fns | 1.72 / 4.4 |

字体：Manrope（标题）、Inter（正文）、Noto Sans SC（中文）、Geist Mono（数字与时间）。

## 项目架构

```text
┌──────────────────────────────────────────────┐
│ Renderer（React 19 + Zustand + Motion）       │
│ 视图 / 详情 / 命令面板 / 提醒窗 / 设置         │
└───────────────────┬──────────────────────────┘
                    │ window.polaris（preload contextBridge）
┌───────────────────▼──────────────────────────┐
│ Main（Electron 45）                           │
│ IPC + zod · SQLite · 提醒调度 · 托盘 · 自启    │
└──────────────────────────────────────────────┘
```

- 主进程负责窗口生命周期、SQLite、提醒调度、托盘和开机自启；渲染层运行在 `contextIsolation` + `sandbox` 中，不直接访问 Node。
- `src/preload/index.ts` 通过 `contextBridge` 暴露类型化的 `window.polaris`；IPC 参数在 `src/main/ipc.ts` 用 zod 校验。
- `src/shared/` 放主进程与渲染层共用的类型和重复规则计算，避免两端各写一套。
- 数据库位于 Electron `userData/polaris.db`，WAL 模式；任务采用软删除，撤销时恢复。
- 提醒窗复用同一个渲染入口，通过 `#/reminder/<taskId>` 加载 `ReminderView`。
- 渲染层没有路由，视图、项目筛选、选中任务和命令面板状态都由 Zustand 管理。

更细的模块边界和修改注意事项见 [CLAUDE.md](CLAUDE.md)。

## 快速开始

前置条件：

- Windows 11（目标平台）
- Node.js 与 npm（开发环境验证：Node 26.13 / npm 11.20）

```bash
npm install
npm run dev
```

如果安装后 Electron 二进制缺失（npm 11 默认阻止生命周期脚本），补跑：

```bash
node node_modules/electron/install.js
```

`package.json` 的 `allowScripts` 已列出需要安装脚本的依赖。

常用命令：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动 electron-vite 开发服务器 |
| `npm run typecheck` | 主进程 + 渲染层 TypeScript 检查 |
| `npm run build` | 构建到 `out/` |
| `npm run smoke` | 启动真实应用跑冒烟测试（需先 `npm run build`） |
| `npm run preview` | 预览生产构建 |
| `npm run build:win` | 构建并生成 NSIS 安装包 |

开发时关闭主窗口只会隐藏到托盘；结束 `npm run dev` 请用托盘菜单「退出」或 `Ctrl+C`。首次启动会创建数据库并写入示例任务。

## 目录结构

```text
src/
  main/        Electron 主进程、SQLite、IPC、提醒、托盘、自启
  preload/     contextBridge API
  shared/      共享类型、重复规则计算
  renderer/
    index.html
    src/
      components/  视图、详情、命令面板、提醒窗、设置、提示条
      lib/         日期格式化、焦点陷阱
      stores/      Zustand 状态
      styles/      单一样式表 globals.css
scripts/       冒烟测试启动器、图标生成脚本
design-system/ Polaris 品牌系统、token、组件规范
build/         应用图标与安装包资源
```

## 主要功能

- 今天 / 即将到来 / 全部 / 已完成四个视图，支持项目筛选与今日完成进度环。
- 任务详情检查器：宽屏固定右侧列，窄屏模态抽屉；标题和备注自动保存，截止、提醒、重复用行内弹层编辑，Esc 保存并收起。
- 删除撤销：底部「撤销」保留 6 秒，悬停或聚焦时暂停；也支持 `Ctrl Z`。底层为软删除，可恢复。
- 任务提醒：到点弹出右下角提醒窗，可完成或稍后 10 分钟；退出期间错过的提醒会在下次启动补弹。
- 重复任务：每天、工作日、每周、每月、每年；完成时保留当前实例并生成下一次，提醒按相对截止时间的偏移继承。
- 关闭主窗口后驻留系统托盘，提醒继续运行；托盘菜单可重新打开或退出。
- 设置里可开启开机自启：登录 Windows 后以 `--hidden` 后台启动到托盘；单实例保护，再次启动会唤起已有窗口。
- 侧栏新建项目，内置六种配色。
- 命令面板（`Ctrl K`）：搜索任务、切换视图、新建任务或项目、切换主题。
- 深色 / 浅色主题：标题栏按钮或命令面板切换，选择会记住；首次启动跟随系统。
- 键盘优先：命令面板、设置和窄屏详情有焦点陷阱；宽屏详情保持列表可操作，支持 skip link、reduced motion 和可见焦点环。
- SQLite 本地持久化，自定义标题栏保留 Windows 原生最小化 / 最大化 / 关闭按钮。

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `N` | 聚焦快速添加 |
| `Ctrl K` | 打开命令面板 |
| `Enter` | 保存快速添加 / 打开选中项 |
| `Esc` | 保存并收起详情，或关闭命令面板 / 弹层 |
| `Ctrl Z` | 撤销最近一次删除（输入框内保留文字撤销） |

## 设计系统

品牌系统在 [`design-system/polaris-design/`](design-system/polaris-design/)：一个北极星、一个青绿信号；夜是冷墨，日是暖瓷。设计模型、token、组件规范和平台映射都在这个目录：

- [设计语言与工艺规则](design-system/polaris-design/SKILL.md)
- [颜色、字体、间距、圆角与动效 token](design-system/polaris-design/references/tokens.md)
- [组件规范](design-system/polaris-design/references/components.md)
- [平台与字体加载映射](design-system/polaris-design/references/platform-mapping.md)

界面的实时实现（`src/renderer`）就是这套设计系统的应用屏幕预览。

## 开发流程

当前仓库只有 `main` 分支，没有配置分支保护、PR 模板或 CI。推荐的本地流程：

1. 改代码，用 `npm run dev` 验证交互。
2. 运行 `npm run typecheck`。
3. 运行 `npm run build && npm run smoke`。
4. 需要看视觉结果时，构建后用 `POLARIS_SHOT=<mode> npx electron .` 截图到仓库根目录；模式包括 `detail`、`palette`、`projects`、`reminder`、`reminder-detail`、`settings`、`toast`、`recurrence` 及各自的 `light-` 变体。
5. 发布前运行 `npm run build:win`。

打包产物：

- `dist/Polaris-Setup-0.1.0.exe`：NSIS 安装包，按用户安装，无需管理员权限，安装界面为简体中文。
- `dist/win-unpacked/Polaris.exe`：免安装目录版。

安装包未做代码签名，首次运行可能触发 SmartScreen 或杀毒软件扫描提示。应用图标来自 `build/icon.ico`，可用 `node scripts/make-app-icon.mjs` 重新生成。

## 编码约定

- TypeScript 开启 `strict`；`@shared` 和 `@renderer` 是相对路径别名，需同时维护 `tsconfig.*.json` 与 `electron.vite.config.ts`。
- 现有代码风格：2 空格、单引号、不写分号。仓库没有 ESLint 或 Prettier，类型检查是主要静态保障。
- 新增数据操作时同步修改四处：`src/shared/types.ts`、`src/preload/index.ts`、`src/main/ipc.ts`、`src/main/db.ts`，并用 zod 校验输入。
- 数据库迁移按 `PRAGMA user_version` 顺序追加，已发布的迁移块不要改。
- 时间统一存 ISO UTC 字符串；日期分组和格式化只在渲染层进行。
- 重复规则按 RFC 5545 RRULE 计算，并按本地墙钟时间推进；COUNT 和 UNTIL 不接受。
- 界面文案使用简体中文；改动 UI 时沿用现有 token 和组件规范，不要引入新的视觉方向。

## 测试

仓库没有单元测试框架，也没有 lint 脚本。唯一的自动化检查是冒烟测试：

```bash
npm run build
npm run smoke
```

`scripts/smoke.mjs` 启动真实 Electron，`runSmokeTest()`（在 `src/main/index.ts`）通过 `webContents.executeJavaScript` 驱动界面，覆盖快速添加、详情编辑、完成、删除与撤销、命令面板、主题切换、开机自启、重复任务和「已创建下一次」提示。测试使用临时 userData 配置目录，不会碰本机数据，结束后自动清理；失败时进程以非零退出码结束。

视觉检查通过上面的 `POLARIS_SHOT` 截图完成；目前没有 CI，截图和冒烟测试都需要在本地运行。

## 已知限制

- 提醒依赖 Polaris 正在运行；关闭窗口后驻留托盘即可，退出期间错过的提醒会在下次启动补弹。
- 提醒使用自绘的右下角窗口，不走 Windows Toast；系统勿扰模式不会拦截它。
- 重复任务完成时会推进系列；取消完成不会回滚已经生成的下一次。
- 撤销只保留最近一次删除，连续删除会覆盖上一条。
- 窗口底色保持不透明，Mica 尚未作为视觉层启用；`backgroundMaterial: 'mica'` 已预留，等界面稳定后再做透明标题栏实验。
- 主题选择保存在 `localStorage` 的 `polaris-theme` 键；没有保存过时按系统浅色 / 深色偏好启动。
- 开发态的开机自启项指向 `electron.exe`，打包后指向正式安装路径。
- 示例任务只用于首次启动展示；删除数据可清空 Electron userData 目录下的 `polaris.db`。
- 开发模式下 Vite 可能提示 `React DevTools global hook` 被 shim、Fast Refresh 被禁用；不影响构建和运行。

## 贡献

这个仓库目前没有单独的 `CONTRIBUTING.md` 或代码范例文档；现有 `src/` 实现就是范例。参与改动时：

- 先读 [CLAUDE.md](CLAUDE.md) 了解进程边界、数据流和测试方式。
- UI 改动遵循既定设计流程：UI UX Pro Max 定方向，hue 维护品牌系统，web-design-guidelines 查规范，unslop 做最后精修。
- 改动行为、命令或已知限制时同步更新本 README。
- 提交前至少运行 `npm run typecheck`、`npm run build` 和 `npm run smoke`。

## 许可证

MIT，见 [`package.json`](package.json)。仓库目前还没有独立的 `LICENSE` 文件，正式发布前建议补一份。