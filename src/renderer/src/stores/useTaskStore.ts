import { create } from 'zustand'
import type { AppView, Project, Task, UpdateTaskInput } from '@shared/types'

type TaskPatch = Omit<UpdateTaskInput, 'id'>

// 侧栏向用户承诺「自动保存」，所以任何一次落库失败都不能只进 console：
// catch 写入 storageError，下一次成功读写时清除，由 UndoToast 渲染成错误提示。
const WRITE_FAILED = '保存失败，改动未写入本地数据库'
const LOAD_FAILED = '读取本地数据失败'

type TaskState = {
  tasks: Task[]
  projects: Project[]
  view: AppView
  projectFilter: string | null
  selectedTaskId: string | null
  paletteOpen: boolean
  loading: boolean
  pendingDeletion: Task | null
  notice: { dueAt: string } | null
  storageError: string | null
  load: () => Promise<void>
  setView: (view: AppView) => void
  setProjectFilter: (projectId: string | null) => void
  selectTask: (id: string | null) => void
  setPaletteOpen: (open: boolean) => void
  addTask: (
    title: string,
    dueAt: string | null,
    projectId: string | null,
    priority?: number
  ) => Promise<void>
  updateTask: (id: string, patch: TaskPatch) => Promise<void>
  toggleTask: (id: string) => Promise<void>
  removeTask: (id: string) => Promise<void>
  undoDelete: () => Promise<void>
  clearPendingDeletion: () => void
  clearNotice: () => void
  clearStorageError: () => void
  createProject: (name: string, color: string) => Promise<Project>
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  projects: [],
  view: 'today',
  projectFilter: null,
  selectedTaskId: null,
  paletteOpen: false,
  loading: true,
  pendingDeletion: null,
  notice: null,
  storageError: null,

  load: async () => {
    try {
      const [tasks, projects] = await Promise.all([
        window.polaris.tasks.list(),
        window.polaris.projects.list()
      ])
      set((state) => ({
        tasks,
        projects,
        loading: false,
        storageError: null,
        selectedTaskId: tasks.some((task) => task.id === state.selectedTaskId)
          ? state.selectedTaskId
          : null
      }))
    } catch (error) {
      console.error('Failed to load Polaris data:', error)
      set({ loading: false, storageError: LOAD_FAILED })
    }
  },

  setView: (view) => set({ view, projectFilter: null }),

  setProjectFilter: (projectFilter) => set({ projectFilter, view: 'all' }),

  selectTask: (selectedTaskId) => set({ selectedTaskId }),

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  addTask: async (title, dueAt, projectId, priority) => {
    const task = await window.polaris.tasks.create({ title, dueAt, projectId, priority })
    set((state) => ({ tasks: [task, ...state.tasks], storageError: null }))
  },

  updateTask: async (id, patch) => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return

    const optimistic: Task = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }

    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? optimistic : task))
    }))

    try {
      const updated = await window.polaris.tasks.update({ id, ...patch })
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? updated : task)),
        storageError: null
      }))
    } catch (error) {
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? current : task)),
        storageError: WRITE_FAILED
      }))
      throw error
    }
  },

  toggleTask: async (id) => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return

    try {
      const completing = !current.completed && Boolean(current.recurrenceRule && current.dueAt)
      await get().updateTask(id, { completed: !current.completed })

      if (current.recurrenceRule) {
        await get().load()

        if (completing) {
          const spawned = get()
            .tasks.filter(
              (task) =>
                task.id !== id &&
                !task.completed &&
                task.recurrenceRule === current.recurrenceRule &&
                task.title === current.title
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

          if (spawned?.dueAt) set({ notice: { dueAt: spawned.dueAt } })
        }
      }
    } catch (error) {
      console.error('Failed to toggle task:', error)
      set({ storageError: WRITE_FAILED })
    }
  },

  removeTask: async (id) => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return

    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
      selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
      pendingDeletion: current
    }))

    try {
      await window.polaris.tasks.remove(id)
      set({ storageError: null })
    } catch (error) {
      console.error('Failed to delete task:', error)
      set((state) => ({
        tasks: [...state.tasks, current],
        pendingDeletion: null,
        storageError: WRITE_FAILED
      }))
    }
  },

  undoDelete: async () => {
    const pending = get().pendingDeletion
    if (!pending) return

    set({ pendingDeletion: null })

    try {
      const restored = await window.polaris.tasks.restore(pending.id)
      set((state) => ({
        tasks: [restored, ...state.tasks.filter((task) => task.id !== restored.id)],
        storageError: null
      }))
    } catch (error) {
      console.error('Failed to restore task:', error)
      set({ pendingDeletion: pending, storageError: WRITE_FAILED })
    }
  },

  clearPendingDeletion: () => set({ pendingDeletion: null }),

  clearNotice: () => set({ notice: null }),

  clearStorageError: () => set({ storageError: null }),

  createProject: async (name, color) => {
    try {
      const project = await window.polaris.projects.create({ name, color })
      set((state) => ({ projects: [...state.projects, project], storageError: null }))
      return project
    } catch (error) {
      set({ storageError: WRITE_FAILED })
      throw error
    }
  }
}))