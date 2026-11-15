import { create } from 'zustand'
import type { AppView, Project, Task, UpdateTaskInput } from '@shared/types'

type TaskPatch = Omit<UpdateTaskInput, 'id'>

// 破坏性确认（彻底删除 / 清空）的状态放 store：TaskView 的 N 监听与
// UndoToast 的 Ctrl+Z 监听都要在弹窗开着时让位，单一来源避免同步漏。
export type TrashConfirm = { kind: 'purge'; task: Task } | { kind: 'empty' }

// 侧栏向用户承诺「自动保存」，所以任何一次落库失败都不能只进 console：
// catch 写入 storageError，下一次成功读写时清除，由 UndoToast 渲染成错误提示。
const WRITE_FAILED = '保存失败，改动未写入本地数据库'
const LOAD_FAILED = '读取本地数据失败'

// 错误槽是共享的，但 load 与 loadTrash 在 focus 时并发触发：一个读的成功
// 不能抹掉另一个读的失败证据，否则「读取失败可见」成了空话。所以 LOAD_FAILED
// 记归属集合：每个读只消掉自己的失败标记，集合清空才清错误——双失败态必须
// 两个读都成功 toast 才消失（单槽会被后失败者覆盖，先失败的证据就丢了）。
// 写失败不参与归属：任何成功都清（既有「下一次成功读写清除」语义），手动关闭也清。
const readFailures = new Set<'load' | 'trash'>()

const readFailed = (owner: 'load' | 'trash') => {
  readFailures.add(owner)
  return { storageError: LOAD_FAILED }
}

const readSucceeded = (owner: 'load' | 'trash', current: string | null) => {
  readFailures.delete(owner)
  if (readFailures.size > 0) return current
  return null
}

const writeFailed = () => {
  readFailures.clear()
  return { storageError: WRITE_FAILED }
}

const clearError = () => {
  readFailures.clear()
  return { storageError: null }
}

type TaskState = {
  tasks: Task[]
  // 回收站独立存放，绝不并入 tasks：否则软删行会泄漏进侧栏计数、进度环、
  // 面板搜索和详情栏。拉取也独立（loadTrash），绝不并入 load()——提醒窗口
  // 挂载共用 load()，而 list-deleted 带 purge 写操作。
  trashedTasks: Task[]
  projects: Project[]
  view: AppView
  projectFilter: string | null
  selectedTaskId: string | null
  paletteOpen: boolean
  loading: boolean
  pendingDeletion: Task | null
  trashConfirm: TrashConfirm | null
  notice: { dueAt: string } | null
  storageError: string | null
  load: () => Promise<void>
  loadTrash: () => Promise<void>
  setView: (view: AppView) => void
  setProjectFilter: (projectId: string | null) => void
  selectTask: (id: string | null) => void
  setPaletteOpen: (open: boolean) => void
  setTrashConfirm: (confirm: TrashConfirm | null) => void
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
  restoreFromTrash: (id: string) => Promise<void>
  deleteForever: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  clearPendingDeletion: () => void
  clearNotice: () => void
  clearStorageError: () => void
  createProject: (name: string, color: string) => Promise<Project>
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  trashedTasks: [],
  projects: [],
  view: 'today',
  projectFilter: null,
  selectedTaskId: null,
  paletteOpen: false,
  loading: true,
  pendingDeletion: null,
  trashConfirm: null,
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
        storageError: readSucceeded('load', state.storageError),
        selectedTaskId: tasks.some((task) => task.id === state.selectedTaskId)
          ? state.selectedTaskId
          : null
      }))
    } catch (error) {
      console.error('Failed to load Polaris data:', error)
      set({ loading: false, ...readFailed('load') })
    }
  },

  loadTrash: async () => {
    try {
      const trashedTasks = await window.polaris.tasks.listDeleted()
      set((state) => ({
        trashedTasks,
        storageError: readSucceeded('trash', state.storageError)
      }))
    } catch (error) {
      console.error('Failed to load trash:', error)
      set(readFailed('trash'))
    }
  },

  setView: (view) => {
    set((state) => ({
      view,
      projectFilter: null,
      // 进回收站关闭检查器：软删行没有详情，留着选中只会让第三列空转。
      selectedTaskId: view === 'trash' ? null : state.selectedTaskId,
      // 确认弹窗不随导航漂流：视图一变就关。
      trashConfirm: null
    }))
    if (view === 'trash') void get().loadTrash()
  },

  setProjectFilter: (projectFilter) => set({ projectFilter, view: 'all' }),

  selectTask: (selectedTaskId) => {
    // 选中活任务总是离开回收站（面板任务搜索是唯一入口）。
    if (selectedTaskId && get().view === 'trash') {
      set({ view: 'all', projectFilter: null, trashConfirm: null })
    }
    set({ selectedTaskId })
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  setTrashConfirm: (trashConfirm) => set({ trashConfirm }),

  addTask: async (title, dueAt, projectId, priority) => {
    const task = await window.polaris.tasks.create({ title, dueAt, projectId, priority })
    set((state) => ({ tasks: [task, ...state.tasks], ...clearError() }))
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
        ...clearError()
      }))
    } catch (error) {
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? current : task)),
        ...writeFailed()
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
      set(writeFailed())
    }
  },

  removeTask: async (id) => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return

    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
      // 双向同步：乐观软删的同时插进回收站，计数立刻涨；deletedAt 只是
      // 近似值，下一次 loadTrash 会用 DB 盖章的真实时间替换。
      trashedTasks: [
        { ...current, deletedAt: new Date().toISOString() },
        ...state.trashedTasks.filter((task) => task.id !== id)
      ],
      selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
      pendingDeletion: current
    }))

    try {
      await window.polaris.tasks.remove(id)
      set(clearError())
    } catch (error) {
      console.error('Failed to delete task:', error)
      set((state) => ({
        tasks: [...state.tasks, current],
        trashedTasks: state.trashedTasks.filter((task) => task.id !== id),
        pendingDeletion: null,
        ...writeFailed()
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
        // 双向同步：撤销成功即从回收站移除，否则同一行会同时出现在两处。
        trashedTasks: state.trashedTasks.filter((task) => task.id !== restored.id),
        ...clearError()
      }))
    } catch (error) {
      console.error('Failed to restore task:', error)
      set({ pendingDeletion: pending, ...writeFailed() })
    }
  },

  restoreFromTrash: async (id) => {
    const index = get().trashedTasks.findIndex((task) => task.id === id)
    if (index < 0) return
    const current = get().trashedTasks[index]

    set((state) => ({
      trashedTasks: state.trashedTasks.filter((task) => task.id !== id),
      // 回收站恢复不复用撤销槽，但要清掉指向该行的 pendingDeletion，
      // 否则 Ctrl+Z 会对一个已恢复的任务再 restore 一次。
      pendingDeletion: state.pendingDeletion?.id === id ? null : state.pendingDeletion
    }))

    try {
      const restored = await window.polaris.tasks.restore(id)
      // 成功静默：设计规范只给破坏性操作弹 toast。
      set((state) => ({
        tasks: [restored, ...state.tasks.filter((task) => task.id !== restored.id)],
        ...clearError()
      }))
    } catch (error) {
      console.error('Failed to restore task from trash:', error)
      set((state) => {
        const trashedTasks = [...state.trashedTasks]
        trashedTasks.splice(Math.min(index, trashedTasks.length), 0, current)
        return { trashedTasks, ...writeFailed() }
      })
    }
  },

  deleteForever: async (id) => {
    const index = get().trashedTasks.findIndex((task) => task.id === id)
    if (index < 0) return
    const current = get().trashedTasks[index]

    set((state) => ({
      trashedTasks: state.trashedTasks.filter((task) => task.id !== id),
      // 硬删必须清掉对应的撤销槽：否则「软删→清空→Ctrl+Z」会触发
      // 一个永远失败的撤销。
      pendingDeletion: state.pendingDeletion?.id === id ? null : state.pendingDeletion
    }))

    try {
      await window.polaris.tasks.deleteForever(id)
      set(clearError())
    } catch (error) {
      console.error('Failed to delete task forever:', error)
      set((state) => {
        const trashedTasks = [...state.trashedTasks]
        trashedTasks.splice(Math.min(index, trashedTasks.length), 0, current)
        return { trashedTasks, ...writeFailed() }
      })
    }
  },

  emptyTrash: async () => {
    const current = get().trashedTasks
    if (current.length === 0) return
    const pending = get().pendingDeletion

    // 无条件清撤销槽：清空之后任何 pendingDeletion 都指向已硬删的行。
    set({ trashedTasks: [], pendingDeletion: null })

    try {
      await window.polaris.tasks.emptyTrash()
      set(clearError())
    } catch (error) {
      console.error('Failed to empty trash:', error)
      // 完整回滚：撤销槽也还原，否则失败后用户丢失原本可用的撤销。
      set({ trashedTasks: current, pendingDeletion: pending, ...writeFailed() })
    }
  },

  clearPendingDeletion: () => set({ pendingDeletion: null }),

  clearNotice: () => set({ notice: null }),

  clearStorageError: () => set(clearError()),

  createProject: async (name, color) => {
    try {
      const project = await window.polaris.projects.create({ name, color })
      set((state) => ({ projects: [...state.projects, project], ...clearError() }))
      return project
    } catch (error) {
      set(writeFailed())
      throw error
    }
  }
}))