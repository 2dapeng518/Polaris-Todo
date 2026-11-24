import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppTheme,
  AutoBackupDeleteResult,
  AutoBackupListResult,
  AutoStartState,
  CreateProjectInput,
  CreateSubtaskInput,
  CreateTagInput,
  CreateTaskInput,
  DataLocationState,
  ExportResult,
  GlobalHotkeyState,
  McpState,
  ImportResult,
  OpenDataDirResult,
  PolarisApi,
  SettingsSection,
  UpdateProjectInput,
  UpdateState,
  UpdateSubtaskInput,
  UpdateTaskInput
} from '../shared/types'
import type { Locale } from '../shared/i18n'

const api: PolarisApi = {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    update: (input: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', input),
    toggle: (id: string, completed: boolean) => ipcRenderer.invoke('tasks:toggle', { id, completed }),
    remove: (id: string) => ipcRenderer.invoke('tasks:delete', { id }),
    restore: (id: string) => ipcRenderer.invoke('tasks:restore', { id }),
    listDeleted: () => ipcRenderer.invoke('tasks:list-deleted'),
    deleteForever: (id: string) => ipcRenderer.invoke('tasks:delete-forever', { id }),
    emptyTrash: () => ipcRenderer.invoke('tasks:empty-trash')
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
    update: (input: UpdateProjectInput) => ipcRenderer.invoke('projects:update', input),
    remove: (id: string) => ipcRenderer.invoke('projects:delete', { id })
  },
  subtasks: {
    list: (taskId: string) => ipcRenderer.invoke('subtasks:list', { taskId }),
    create: (input: CreateSubtaskInput) => ipcRenderer.invoke('subtasks:create', input),
    update: (input: UpdateSubtaskInput) => ipcRenderer.invoke('subtasks:update', input),
    remove: (id: string) => ipcRenderer.invoke('subtasks:remove', { id })
  },
  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    create: (input: CreateTagInput) => ipcRenderer.invoke('tags:create', input),
    remove: (id: string) => ipcRenderer.invoke('tags:remove', { id })
  },
  data: {
    getRevision: (): Promise<number> => ipcRenderer.invoke('data:revision'),
    export: (): Promise<ExportResult> => ipcRenderer.invoke('data:export'),
    import: (): Promise<ImportResult> => ipcRenderer.invoke('data:import'),
    exportCsv: (): Promise<ExportResult> => ipcRenderer.invoke('data:export-csv')
  },
  backups: {
    list: (): Promise<AutoBackupListResult> => ipcRenderer.invoke('backups:list'),
    import: (name: string): Promise<ImportResult> => ipcRenderer.invoke('backups:import', name),
    saveAs: (name: string): Promise<ExportResult> => ipcRenderer.invoke('backups:save-as', name),
    openDataDir: (): Promise<OpenDataDirResult> => ipcRenderer.invoke('backups:open-data-dir'),
    delete: (name: string): Promise<AutoBackupDeleteResult> => ipcRenderer.invoke('backups:delete', name),
    getInterval: (): Promise<number> => ipcRenderer.invoke('backups:get-interval'),
    setInterval: (hours: number): Promise<number> => ipcRenderer.invoke('backups:set-interval', hours)
  },
  dataLocation: {
    getState: (): Promise<DataLocationState> => ipcRenderer.invoke('data-location:get'),
    set: (): Promise<DataLocationState> => ipcRenderer.invoke('data-location:set'),
    apply: (): Promise<DataLocationState> => ipcRenderer.invoke('data-location:apply'),
    reset: (): Promise<DataLocationState> => ipcRenderer.invoke('data-location:reset'),
    cancel: (): Promise<DataLocationState> => ipcRenderer.invoke('data-location:cancel')
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    setTheme: (theme: AppTheme) => ipcRenderer.invoke('app:set-theme', theme),
    getTheme: (): Promise<AppTheme> => ipcRenderer.invoke('app:get-theme'),
    getLocale: (): Promise<Locale> => ipcRenderer.invoke('app:get-locale'),
    setLocale: (locale: Locale): Promise<Locale> => ipcRenderer.invoke('app:set-locale', locale),
    openSettings: (section?: SettingsSection): Promise<void> =>
      ipcRenderer.invoke('app:open-settings', section),
    closeSettings: (): Promise<void> => ipcRenderer.invoke('app:close-settings'),
    getAutoStart: (): Promise<AutoStartState> => ipcRenderer.invoke('app:get-autostart'),
    setAutoStart: (enabled: boolean): Promise<AutoStartState> =>
      ipcRenderer.invoke('app:set-autostart', enabled),
    getCloseToTray: (): Promise<boolean> => ipcRenderer.invoke('app:get-close-to-tray'),
    setCloseToTray: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke('app:set-close-to-tray', enabled),
    getGlobalHotkey: (): Promise<GlobalHotkeyState> =>
      ipcRenderer.invoke('app:get-global-hotkey'),
    setGlobalHotkey: (enabled: boolean): Promise<GlobalHotkeyState> =>
      ipcRenderer.invoke('app:set-global-hotkey', enabled),
    getMcp: (): Promise<McpState> => ipcRenderer.invoke('app:get-mcp'),
    setMcp: (enabled: boolean): Promise<McpState> => ipcRenderer.invoke('app:set-mcp', enabled),
    getMcpToken: (): Promise<string> => ipcRenderer.invoke('app:mcp-token-get'),
    regenerateMcpToken: (): Promise<string> => ipcRenderer.invoke('app:mcp-token-regenerate'),
    openNoticesDir: (): Promise<OpenDataDirResult> => ipcRenderer.invoke('app:open-notices-dir')
  },
  update: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('update:get-state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    skip: (version: string): Promise<UpdateState> => ipcRenderer.invoke('update:skip', version),
    dismiss: (version: string): Promise<void> => ipcRenderer.invoke('update:dismiss', version),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onState: (callback: (state: UpdateState) => void) => {
      // 只把状态快照交给渲染层，原始 IpcRendererEvent 不出 preload。
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
        callback(state)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  },
  reminder: {
    dismiss: () => ipcRenderer.invoke('reminder:dismiss')
  }
}

contextBridge.exposeInMainWorld('polaris', api)