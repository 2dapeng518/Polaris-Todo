import type { SettingsSection } from './settings'

export type { SettingsSection }

export type Task = {
  id: string
  title: string
  notes: string
  completed: boolean
  /** When the task was finished. Null while active, and null for rows completed
   *  before migration 4 — the instant was never recorded. Set by the DB, never
   *  supplied by the renderer. */
  completedAt: string | null
  dueAt: string | null
  remindAt: string | null
  remindedAt: string | null
  recurrenceRule: string | null
  projectId: string | null
  priority: number
  createdAt: string
  updatedAt: string
  /** When the task was soft-deleted into the trash. Null while the task is
   *  live. Set by the DB on delete and cleared on restore, never supplied by
   *  the renderer. */
  deletedAt: string | null
  /** Derived checklist progress, computed by the DB on every read. Never part
   *  of CreateTaskInput/UpdateTaskInput and never stored on the task row. */
  subtaskTotal: number
  subtaskDone: number
  /** Associated tags, derived by the DB on every read (ordered by name).
   *  UpdateTaskInput.tagIds is the only write path; never stored on the task
   *  row itself. */
  tags: Tag[]
}

/** A global label. Tags have no colour, due date or hierarchy — they are an
 *  organisation axis orthogonal to projects, so a task can carry several. */
export type Tag = {
  id: string
  name: string
  createdAt: string
}

export type CreateTagInput = {
  name: string
}

/** A lightweight checklist item. Subtasks carry no due date, reminder,
 *  recurrence, project or priority — they belong to exactly one task. */
export type Subtask = {
  id: string
  taskId: string
  title: string
  completed: boolean
  sortOrder: number
  createdAt: string
}

export type CreateSubtaskInput = {
  taskId: string
  title: string
}

export type UpdateSubtaskInput = {
  id: string
  title?: string
  completed?: boolean
}

export type Project = {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type CreateTaskInput = {
  title: string
  dueAt?: string | null
  remindAt?: string | null
  recurrenceRule?: string | null
  projectId?: string | null
  priority?: number
}

export type UpdateTaskInput = {
  id: string
  title?: string
  notes?: string
  completed?: boolean
  dueAt?: string | null
  remindAt?: string | null
  recurrenceRule?: string | null
  projectId?: string | null
  priority?: number
  /** Replacement semantics: the full desired tag set. Omitted leaves the
   *  associations untouched; an empty array clears them. Unknown ids are
   *  dropped rather than rejected so a stale renderer cannot fail a save. */
  tagIds?: string[]
}

/** tasks:update 的返回形状：更新后的任务 + 完成重复任务时 DB 权威生成的
 *  下一次实例（完整 Task 行，含派生计数与标签）；未生成时为 null。
 *  渲染层据此乐观插入 spawned，不再靠「同标题+同规则」启发式猜任务。 */
export type UpdateTaskResult = {
  task: Task
  spawned: Task | null
}

export type CreateProjectInput = {
  name: string
  color: string
}

export type UpdateProjectInput = {
  id: string
  name?: string
  color?: string
}

/** Backup rows carry no derived counts or tags: both are recomputed from the
 *  subtasks and task_tags tables after an import, and an old backup has no
 *  such field at all. */
export type BackupTask = Omit<Task, 'subtaskTotal' | 'subtaskDone' | 'tags'>

/** schemaVersion 3 added the tags and taskTags arrays. Imports still accept
 *  versions 1 and 2, where those arrays are absent and mean "no tag data". */
export type BackupData = {
  schemaVersion: 3
  app: 'polaris'
  exportedAt: string
  projects: Project[]
  tasks: BackupTask[]
  tags: Tag[]
  taskTags: TaskTag[]
  subtasks: Subtask[]
}

/** One row of the task_tags join table. */
export type TaskTag = {
  taskId: string
  tagId: string
}

export type ExportResult = { saved: boolean; path?: string; error?: string }

export type ImportResult = {
  ok: boolean
  canceled?: boolean
  projectsImported?: number
  projectsSkipped?: number
  tasksImported?: number
  tasksSkipped?: number
  subtasksImported?: number
  subtasksSkipped?: number
  tagsImported?: number
  tagsSkipped?: number
  taskTagsImported?: number
  taskTagsSkipped?: number
  error?: string
}

/** 自动备份列表的一行：只有文件元数据，主进程不解析 JSON——
 *  打开设置页时列备份必须是廉价操作，几十份文件也不读盘内容。 */
export type AutoBackupItem = {
  name: string
  mtimeMs: number
  sizeBytes: number
}

/** backups:list 的返回形状：失败时 items 缺席，错误原文进 error。 */
export type AutoBackupListResult = {
  ok: boolean
  items?: AutoBackupItem[]
  error?: string
}

/** backups:open-data-dir / app:open-notices-dir 的返回形状：openPath 失败时
 *  带系统错误原文；harness 构建恒为 { opened: false }（编译期门控，
 *  绝不真开资源管理器）。 */
export type OpenDataDirResult = {
  opened: boolean
  error?: string
}

/** backups:delete 的返回形状：deleted 为 false 时 error 带失败原因原文。 */
export type AutoBackupDeleteResult = {
  deleted: boolean
  error?: string
}

export type AppView = 'today' | 'upcoming' | 'calendar' | 'all' | 'completed' | 'stats' | 'matrix' | 'trash'

import type { AppTheme } from './themes'
import type { Locale } from './i18n'

export type { AppTheme }

export type AutoStartState = {
  enabled: boolean
  supported: boolean
  error?: string
}

/** 全局热键的期望状态与实际注册状态分开：组合键被别的程序占用时，
 *  enabled 仍是用户的选择（开），registered 才是这次注册的结果。 */
export type GlobalHotkeyState = {
  enabled: boolean
  registered: boolean
  accelerator: string
  error?: string
}

/** 候选快捷键的实时可用性（设置对话框的推荐组合）。 */
export type HotkeyProbe = {
  accelerator: string
  /** false = 已被其他程序占用（当前组合恒为 true：改回自己是 no-op）。 */
  free: boolean
}

export type McpState = {
  enabled: boolean
  running: boolean
  endpoint: string
  error?: string
}

/** 数据存放位置状态。path 是本次会话 initDatabase 实际打开的目录；
 *  pendingRestart 表示已切换（指针已写/已删），重启后 path 才变成新值。 */
export type DataLocationState = {
  path: string
  /** 默认目录（userData），恢复默认的目标与「默认位置」文案的数据源。 */
  defaultPath: string
  isCustom: boolean
  pendingRestart: boolean
  /** 已选择待确认的目录：渲染层据此弹知情确认框（复制/采用），取消即清除。 */
  offered?: string
  /** offered 目录已含 polaris.db：采用（重装恢复）而非复制当前数据。 */
  offeredAdopt?: boolean
  /** 启动回退原因或上次操作失败文案。 */
  error?: string
}

/** 在线更新状态机。unsupported = 开发/未打包环境没有更新通道；
 *  available → downloading → downloaded 由 electron-updater 事件驱动，
 *  渲染层只消费快照，不自己推算进度。 */
export type UpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  /** 检查到的新版本号；没查到或还没查时为 null。 */
  latestVersion: string | null
  /** 下载进度 0-100，仅 downloading 期间有意义，其余为 null。 */
  percent: number | null
  /** 已下载字节数；electron-updater 的 download-progress 透传，其余状态为 null。 */
  transferred: number | null
  /** 本次下载的总字节数；未知时为 null，UI 降级为只显示 percent。 */
  total: number | null
  /** 主进程做过指数平滑的瞬时速度（字节/秒）；无有效样本时为 null。 */
  bytesPerSecond: number | null
  /** 更新说明（来自 GitHub Release 正文），无则 null。 */
  releaseNotes: string | null
  /** 用户点过「跳过此版本」的版本号；自动检查命中它时保持安静。 */
  skippedVersion: string | null
  /** 本次运行里点过「稍后」的版本号（主进程按会话记账，跨窗口一致；手动检查清空）。
   *  harness 的合成快照可以不带这个字段，渲染层按「没有跨窗口信息」处理。 */
  dismissedVersion?: string | null
  error: string | null
}

export type PolarisApi = {
  tasks: {
    list: () => Promise<Task[]>
    create: (input: CreateTaskInput) => Promise<Task>
    /** 返回更新后的任务与权威 spawned（完成重复任务时 DB 生成的下一次实例）。 */
    update: (input: UpdateTaskInput) => Promise<UpdateTaskResult>
    toggle: (id: string, completed: boolean) => Promise<Task>
    remove: (id: string) => Promise<void>
    restore: (id: string) => Promise<Task>
    listDeleted: () => Promise<Task[]>
    deleteForever: (id: string) => Promise<void>
    emptyTrash: () => Promise<void>
  }
  projects: {
    list: () => Promise<Project[]>
    create: (input: CreateProjectInput) => Promise<Project>
    update: (input: UpdateProjectInput) => Promise<Project>
    remove: (id: string) => Promise<void>
  }
  subtasks: {
    list: (taskId: string) => Promise<Subtask[]>
    create: (input: CreateSubtaskInput) => Promise<Subtask>
    update: (input: UpdateSubtaskInput) => Promise<Subtask>
    remove: (id: string) => Promise<void>
  }
  tags: {
    list: () => Promise<Tag[]>
    create: (input: CreateTagInput) => Promise<Tag>
    remove: (id: string) => Promise<void>
  }
  data: {
    /** 当前写修订号（迁移 7 触发器维护，单调递增）。focus 门控的廉价探针：
     *  与上次同步盖章不同才全量重拉，无变化时省掉整表 IPC。 */
    getRevision: () => Promise<number>
    export: () => Promise<ExportResult>
    import: () => Promise<ImportResult>
    exportCsv: () => Promise<ExportResult>
  }
  backups: {
    /** 列出 userData/backups 下的自动备份（新→旧），只读元数据不解析内容。 */
    list: () => Promise<AutoBackupListResult>
    /** 按文件名导入一份自动备份：与 data.import 完全同语义（按 ID 合并，
     *  已存在的行跳过，绝不覆盖当前数据）。非法文件名在主进程直接拒绝。 */
    import: (name: string) => Promise<ImportResult>
    /** 把一份自动备份另存到用户选择的位置；取消时 saved 为 false。 */
    saveAs: (name: string) => Promise<ExportResult>
    /** 用系统文件管理器打开 userData 目录；harness 构建下恒为未打开。 */
    openDataDir: () => Promise<OpenDataDirResult>
    /** 删除一份自动备份：只接受自动备份文件名（门禁同 list），手改/导出
     *  的其他文件不会被此通道碰到。 */
    delete: (name: string) => Promise<AutoBackupDeleteResult>
    /** 当前自动备份周期（小时；0 = 关闭自动备份）。 */
    getInterval: () => Promise<number>
    /** 设置自动备份周期（只接受预设档位），返回落库后的生效值。 */
    setInterval: (hours: number) => Promise<number>
  }
  dataLocation: {
    /** 只读快照：当前数据目录 / 默认目录 / 待确认 offer / 启动回退错误。 */
    getState: () => Promise<DataLocationState>
    /** 选择数据存放位置：原生目录对话框（参数不暴露，取消即保持原样）。
     *  返回的 offered 供渲染层确认，取消调 cancel 清空。 */
    set: () => Promise<DataLocationState>
    /** 应用已确认的位置：目标有库则采用、无库则复制当前数据过去，
     *  写指针后自动重启生效。无 offer 时原样返回。 */
    apply: () => Promise<DataLocationState>
    /** 恢复默认位置：当前数据复制回默认目录（旧默认库先备份让位），
     *  删指针后重启。已在默认位置时原样返回。 */
    reset: () => Promise<DataLocationState>
    /** 清空待确认 offer（确认框取消时调用），主进程不残留状态。 */
    cancel: () => Promise<DataLocationState>
  }
  app: {
    getVersion: () => Promise<string>
    setTheme: (theme: AppTheme) => Promise<void>
    /** 读取 meta 里的权威主题：重装后 localStorage 为空，渲染层据此回填。 */
    getTheme: () => Promise<AppTheme>
    getLocale: () => Promise<Locale>
    /** 只有主窗口与设置窗口的调用会生效（提醒窗口回传的同步值不回写）；
     *  返回主进程最终采用的语言。 */
    setLocale: (locale: Locale) => Promise<Locale>
    /** 打开设置窗口并定位到指定分类（缺省第一页）；已开着就唤到前台切页。 */
    openSettings: (section?: SettingsSection) => Promise<void>
    /** 关闭设置窗口（侧栏没有它，设置窗口自己的 Esc / harness 用）。 */
    closeSettings: () => Promise<void>
    getAutoStart: () => Promise<AutoStartState>
    setAutoStart: (enabled: boolean) => Promise<AutoStartState>
    getCloseToTray: () => Promise<boolean>
    setCloseToTray: (enabled: boolean) => Promise<boolean>
    getGlobalHotkey: () => Promise<GlobalHotkeyState>
    setGlobalHotkey: (enabled: boolean) => Promise<GlobalHotkeyState>
    /** 自定义全局快捷键（形状校验在主进程；开启态注册失败会回滚旧组合）。 */
    setGlobalHotkeyAccelerator: (accelerator: string) => Promise<GlobalHotkeyState>
    /** 探测一组候选组合当前是否空闲（供推荐组合；探完不留注册痕迹）。 */
    probeGlobalHotkeys: (candidates: string[]) => Promise<HotkeyProbe[]>
    /** 应用内快捷键自定义覆盖表（只含改过的 id→keys；缺省走注册表默认）。 */
    getShortcuts: () => Promise<Record<string, string>>
    /** 改一个应用内快捷键（形状校验 + 归一化在主进程；等于默认即清除覆盖）。 */
    setShortcut: (id: string, keys: string) => Promise<Record<string, string>>
    getMcp: () => Promise<McpState>
    setMcp: (enabled: boolean) => Promise<McpState>
    /** 读取 MCP bearer token（尚未生成时立即生成并持久化）。 */
    getMcpToken: () => Promise<string>
    /** 重新生成 MCP token：旧 token 立即作废，已配置客户端需更新。 */
    regenerateMcpToken: () => Promise<string>
    /** 用系统文件管理器打开安装目录的 resources/licenses/（第三方许可原文）。 */
    openNoticesDir: () => Promise<OpenDataDirResult>
  }
  update: {
    getState: () => Promise<UpdateState>
    /** 手动检查：忽略「跳过此版本」，用户主动问就要给答案。 */
    check: () => Promise<UpdateState>
    /** 跳过指定版本（渲染层正在展示的那个）；自动检查不再为它弹窗。 */
    skip: (version: string) => Promise<UpdateState>
    /** 「稍后」记到主进程的会话账上：设置窗口与主窗口的弹窗副本一起安静。 */
    dismiss: (version: string) => Promise<void>
    /** 退出并安装已下载好的更新（quitAndInstall）。 */
    install: () => Promise<void>
    /** 订阅主进程推送的状态快照，返回取消订阅函数。 */
    onState: (callback: (state: UpdateState) => void) => () => void
  }
  reminder: {
    dismiss: () => Promise<void>
  }
}