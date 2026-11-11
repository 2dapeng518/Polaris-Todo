# Polaris

Windows 11 上的本地优先待办应用。深色墨黑界面、极光色点缀、原生窗口控件，数据默认只保存在本机。

## 设计系统

Polaris 的品牌系统在 [`design-system/polaris-design/`](design-system/polaris-design/)：一个北极星、一个青绿信号；夜是冷墨，日是暖瓷。字体为 Manrope（标题）、Inter（正文）、Noto Sans SC（中文）、Geist Mono（数字和时间）。设计模型、token、组件规范和平台映射都在这个目录。

## 技术栈

- **外壳**：Electron 45（Chromium 156 / Node 24）
- **构建**：electron-vite 6、Vite 8、TypeScript 7
- **界面**：React 19、Tailwind CSS 4、Motion 14、Zustand 5
- **数据**：better-sqlite3 13（WAL，本地文件数据库）
- **打包**：electron-builder 26（NSIS）

## 快速开始

```bash
npm install
npm run dev
```

其他命令：

```bash
npm run typecheck   # 主进程 + 渲染层类型检查
npm run build       # 构建 out/
npm run smoke       # 启动应用并跑一遍增删改查冒烟测试
npm run build:win   # 生成 Windows NSIS 安装包
```

## 当前功能

- 今天 / 即将到来 / 全部 / 已完成四个视图
- 项目筛选、今日完成进度环
- 任务详情抽屉：标题、备注、截止时间、项目、优先级，失焦自动保存
- 删除撤销：删除任务后底部出现「撤销」（6 秒，悬停或聚焦时暂停），也可按 `Ctrl Z`；底层为软删除，可恢复
- 任务提醒：详情里设置提醒时间，支持「1 小时后 / 明天 09:00 / 清除」；到点弹出右下角提醒窗，可完成或稍后 10 分钟
- 重复任务：每天、工作日、每周、每月、每年；完成时保留当前完成实例并自动创建下一次，提醒按相对截止时间的偏移继承，底部提示下一次时间
- 关闭主窗口后驻留系统托盘，提醒继续；托盘菜单可打开或退出
- 设置里可开启开机自启：登录 Windows 后以 `--hidden` 后台启动到托盘，不弹主窗口；单实例保护，再次启动会唤起已有窗口
- 侧栏新建项目，内置六种配色
- 命令面板（`Ctrl K`）：搜索任务、切换视图、新建任务 / 项目、切换主题
- 深色 / 浅色主题：标题栏按钮或命令面板切换，选择会记住；首次启动跟随系统
- 快速添加（`N`）、完成、删除、列表动效
- 键盘优先：详情/命令/设置焦点陷阱，skip link，reduced motion，可见焦点环
- SQLite 本地持久化，首次启动带示例任务
- 自定义标题栏：保留 Windows 原生最小化 / 最大化 / 关闭按钮，并随主题调整按钮颜色

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `N` | 聚焦快速添加 |
| `Ctrl K` | 打开命令面板 |
| `Enter` | 保存快速添加 / 打开选中项 |
| `Esc` | 关闭详情抽屉或命令面板 |
| `Ctrl Z` | 撤销最近一次删除（输入框内保留文字撤销） |

## 目录结构

```text
src/
  main/       Electron 主进程、SQLite、IPC
  preload/    contextBridge API
  shared/     主进程与渲染层共享类型
  renderer/   React 界面
scripts/
  smoke.mjs   冒烟测试启动器
```

## 打包

```bash
npm run build:win
```

产物：

- `dist/Polaris-Setup-0.1.0.exe` — NSIS 安装包，按用户安装，无需管理员权限
- `dist/win-unpacked/Polaris.exe` — 免安装目录版

安装包未做代码签名，首次运行可能触发 SmartScreen 或杀毒软件扫描提示；应用图标由 `build/icon.ico` 提供，安装界面为简体中文。

## 已知事项

- 开发模式下 Vite 会提示 `React DevTools global hook` 被 shim，Fast Refresh 被禁用；不影响构建和运行，后续调整 React / 插件版本时再处理。
- 当前窗口底色不透明，Mica 材质尚未作为视觉层启用；`backgroundMaterial: 'mica'` 已预留，等界面稳定后再做透明标题栏实验。
- 主题选择保存在 `localStorage` 的 `polaris-theme` 键；没有保存过时按系统浅色 / 深色偏好启动。
- 开机自启在「设置」里开启；登录 Windows 后会以 `--hidden` 后台启动到托盘，不弹主窗口。开发态的自启项指向 `electron.exe`，打包后指向正式安装路径。
- 提醒依赖 Polaris 正在运行（关闭窗口后驻留托盘即可）。退出应用期间错过的提醒会在下次启动时补弹。
- 提醒使用自绘的右下角窗口，不走 Windows Toast；系统勿扰模式不会拦截它。
- 重复任务按 RFC 5545 RRULE 计算；完成时会生成下一条实例并保留当前完成实例。取消完成不会回滚已经生成的下一次，系列按向前推进处理。
- 开发时关闭窗口只会隐藏，结束 `npm run dev` 请用托盘「退出」或 `Ctrl+C`。
- 示例任务只用于首次启动展示；删除数据可清空 Electron userData 目录下的 `polaris.db`。