import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppTheme,
  AutoStartState,
  CreateProjectInput,
  CreateSubtaskInput,
  CreateTagInput,
  CreateTaskInput,
  CsvImportResult,
  ExportResult,
  GlobalHotkeyState,
  McpState,
  ImportResult,
  PolarisApi,
  UpdateProjectInput,
  UpdateState,
  UpdateSubtaskInput,
  UpdateTaskInput
} from '../shared/types'

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
    export: (): Promise<ExportResult> => ipcRenderer.invoke('data:export'),
    import: (): Promise<ImportResult> => ipcRenderer.invoke('data:import'),
    importCsv: (): Promise<CsvImportResult> => ipcRenderer.invoke('data:import-csv')
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    setTheme: (theme: AppTheme) => ipcRenderer.invoke('app:set-theme', theme),
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
    setMcp: (enabled: boolean): Promise<McpState> => ipcRenderer.invoke('app:set-mcp', enabled)
  },
  update: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('update:get-state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    skip: (version: string): Promise<UpdateState> => ipcRenderer.invoke('update:skip', version),
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