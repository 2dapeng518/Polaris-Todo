import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppTheme,
  AutoStartState,
  CreateProjectInput,
  CreateTaskInput,
  ExportResult,
  ImportResult,
  PolarisApi,
  UpdateProjectInput,
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
  data: {
    export: (): Promise<ExportResult> => ipcRenderer.invoke('data:export'),
    import: (): Promise<ImportResult> => ipcRenderer.invoke('data:import')
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    setTheme: (theme: AppTheme) => ipcRenderer.invoke('app:set-theme', theme),
    getAutoStart: (): Promise<AutoStartState> => ipcRenderer.invoke('app:get-autostart'),
    setAutoStart: (enabled: boolean): Promise<AutoStartState> =>
      ipcRenderer.invoke('app:set-autostart', enabled)
  },
  reminder: {
    dismiss: () => ipcRenderer.invoke('reminder:dismiss')
  }
}

contextBridge.exposeInMainWorld('polaris', api)