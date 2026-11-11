import { create } from 'zustand'
import type { AppView, Project, Task, UpdateTaskInput } from '@shared/types'

type TaskPatch = Omit<UpdateTaskInput, 'id'>

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
  load: () => Promise<void>
  setView: (view: AppView) => void
  setProjectFilter: (projectId: string | null) => void
  selectTask: (id: string | null) => void
  setPaletteOpen: (open: boolean) => void
  addTask: (title: string, dueAt: string | null, projectId: string | null) => Promise<void>
  updateTask: (id: string, patch: TaskPatch) => Promise<void>
  toggleTask: (id: string) => Promise<void>
  removeTask: (id: string) => Promise<void>
  undoDelete: () => Promise<void>
  clearPendingDeletion: () => void
  clearNotice: () => void
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
        selectedTaskId: tasks.some((task) => task.id === state.selectedTaskId)
          ? state.selectedTaskId
          : null
      }))
    } catch (error) {
      console.error('Failed to load Polaris data:', error)
      set({ loading: false })
    }
  },

  setView: (view) => set({ view, projectFilter: null }),

  setProjectFilter: (projectFilter) => set({ projectFilter, view: 'all' }),

  selectTask: (selectedTaskId) => set({ selectedTaskId }),

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  addTask: async (title, dueAt, projectId) => {
    const task = await window.polaris.tasks.create({ title, dueAt, projectId })
    set((state) => ({ tasks: [task, ...state.tasks] }))
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
        tasks: state.tasks.map((task) => (task.id === id ? updated : task))
      }))
    } catch (error) {
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? current : task))
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
    } catch (error) {
      console.error('Failed to delete task:', error)
      set((state) => ({
        tasks: [...state.tasks, current],
        pendingDeletion: null
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
        tasks: [restored, ...state.tasks.filter((task) => task.id !== restored.id)]
      }))
    } catch (error) {
      console.error('Failed to restore task:', error)
      set({ pendingDeletion: pending })
    }
  },

  clearPendingDeletion: () => set({ pendingDeletion: null }),

  clearNotice: () => set({ notice: null }),

  createProject: async (name, color) => {
    const project = await window.polaris.projects.create({ name, color })
    set((state) => ({ projects: [...state.projects, project] }))
    return project
  }
}))