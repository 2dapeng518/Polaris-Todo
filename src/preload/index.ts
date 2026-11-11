import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppTheme,
  AutoStartState,
  CreateProjectInput,
  CreateTaskInput,
  PolarisApi,
  UpdateTaskInput
} from '../shared/types'

const api: PolarisApi = {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    update: (input: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', input),
    toggle: (id: string, completed: boolean) => ipcRenderer.invoke('tasks:toggle', { id, completed }),
    remove: (id: string) => ipcRenderer.invoke('tasks:delete', { id }),
    restore: (id: string) => ipcRenderer.invoke('tasks:restore', { id })
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input)
  },
  app: {
    platform: process.platform,
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