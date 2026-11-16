import { create } from 'zustand'
import type {
  AppView,
  Project,
  Subtask,
  Tag,
  Task,
  UpdateSubtaskInput,
  UpdateTaskInput
} from '@shared/types'
import type { MessageKey } from '@shared/i18n'

type TaskPatch = Omit<UpdateTaskInput, 'id'>
type SubtaskPatch = Pick<UpdateSubtaskInput, 'title' | 'completed'>

// 破坏性确认（彻底删除 / 清空）的状态放 store：TaskView 的 N 监听与
// UndoToast 的 Ctrl+Z 监听都要在弹窗开着时让位，单一来源避免同步漏。
export type TrashConfirm = { kind: 'purge'; task: Task } | { kind: 'empty' }

// 侧栏向用户承诺「自动保存」，所以任何一次落库失败都不能只进 console：
// catch 写入 storageError，下一次成功读写时清除，由 UndoToast 渲染成错误提示。
// 这里存的是词典键，不是成品文案——渲染层才有当前语言。
const WRITE_FAILED: MessageKey = 'errors.save'
const LOAD_FAILED: MessageKey = 'errors.load'

// 错误槽是共享的，但 load 与 loadTrash 在 focus 时并发触发：一个读的成功
// 不能抹掉另一个读的失败证据，否则「读取失败可见」成了空话。所以 LOAD_FAILED
// 记归属集合：每个读只消掉自己的失败标记，集合清空才清错误——双失败态必须
// 两个读都成功 toast 才消失（单槽会被后失败者覆盖，先失败的证据就丢了）。
// 写失败不参与归属：任何成功都清（既有「下一次成功读写清除」语义），手动关闭也清。
// 检查清单是第三类读：它失败时不能被主列表的 load 成功抹掉，成功也只消自己的标记。
type ReadOwner = 'load' | 'trash' | 'checklist'
const readFailures = new Set<ReadOwner>()

const readFailed = (owner: ReadOwner) => {
  readFailures.add(owner)
  return { storageError: LOAD_FAILED }
}

const readSucceeded = (owner: ReadOwner, current: MessageKey | null) => {
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

// 任务行上的 2/5 是 DB 派生值。子任务增删勾选后本地同步维护它，
// 这样不必为了一个计数重拉整张任务表；下一次 load() 会以 DB 为准覆盖。
const withSubtaskCounts = (
  tasks: Task[],
  taskId: string,
  totalDelta: number,
  doneDelta: number
): Task[] =>
  tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          subtaskTotal: Math.max(0, task.subtaskTotal + totalDelta),
          subtaskDone: Math.max(0, task.subtaskDone + doneDelta)
        }
      : task
  )

type TaskState = {
  tasks: Task[]
  // 回收站独立存放，绝不并入 tasks：否则软删行会泄漏进侧栏计数、进度环、
  // 面板搜索和详情栏。拉取也独立（loadTrash），绝不并入 load()——提醒窗口
  // 挂载共用 load()，而 list-deleted 带 purge 写操作。
  trashedTasks: Task[]
  // 检查清单按父任务缓存。只由详情面板读写；任务行进度来自 Task 上的派生计数，
  // 不依赖这份缓存，所以未打开过的任务不需要预取。
  subtasksByTask: Record<string, Subtask[]>
  projects: Project[]
  // 标签是全局字典，侧栏、详情建议、任务行 chip 共用这一份；顺序由 DB 按
  // 名称排序给出，新建/删除时本地同步维护。
  tags: Tag[]
  view: AppView
  projectFilter: string | null
  // 标签与项目筛选互斥：两者都是「某个维度下的一组任务」，叠加会让标题、
  // 空态和计数都无法用一句话说清。选中任一筛选即切到「全部任务」。
  tagFilter: string | null
  selectedTaskId: string | null
  paletteOpen: boolean
  loading: boolean
  pendingDeletion: Task | null
  trashConfirm: TrashConfirm | null
  notice: { dueAt: string } | null
  storageError: MessageKey | null
  load: () => Promise<void>
  loadTrash: () => Promise<void>
  loadSubtasks: (taskId: string) => Promise<void>
  addSubtask: (taskId: string, title: string) => Promise<void>
  updateSubtask: (id: string, patch: SubtaskPatch) => Promise<void>
  removeSubtask: (id: string) => Promise<void>
  setView: (view: AppView) => void
  setProjectFilter: (projectId: string | null) => void
  setTagFilter: (tagId: string | null) => void
  createTag: (name: string) => Promise<Tag>
  removeTag: (id: string) => Promise<void>
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
  updateProject: (id: string, patch: { name?: string; color?: string }) => Promise<void>
  deleteProject: (id: string) => Promise<void>
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  trashedTasks: [],
  subtasksByTask: {},
  projects: [],
  tags: [],
  view: 'today',
  projectFilter: null,
  tagFilter: null,
  selectedTaskId: null,
  paletteOpen: false,
  loading: true,
  pendingDeletion: null,
  trashConfirm: null,
  notice: null,
  storageError: null,

  load: async () => {
    try {
      const [tasks, projects, tags] = await Promise.all([
        window.polaris.tasks.list(),
        window.polaris.projects.list(),
        window.polaris.tags.list()
      ])
      set((state) => ({
        tasks,
        projects,
        tags,
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

  loadSubtasks: async (taskId) => {
    try {
      const subtasks = await window.polaris.subtasks.list(taskId)
      set((state) => ({
        subtasksByTask: { ...state.subtasksByTask, [taskId]: subtasks },
        storageError: readSucceeded('checklist', state.storageError)
      }))
    } catch (error) {
      console.error('Failed to load subtasks:', error)
      set(readFailed('checklist'))
    }
  },

  addSubtask: async (taskId, title) => {
    const cleanTitle = title.trim()
    if (!cleanTitle) return

    const list = get().subtasksByTask[taskId] ?? []
    const draft: Subtask = {
      id: `pending-${crypto.randomUUID()}`,
      taskId,
      title: cleanTitle,
      completed: false,
      sortOrder: list.length > 0 ? list[list.length - 1].sortOrder + 1 : 0,
      createdAt: new Date().toISOString()
    }

    set((state) => ({
      subtasksByTask: {
        ...state.subtasksByTask,
        [taskId]: [...(state.subtasksByTask[taskId] ?? []), draft]
      },
      tasks: withSubtaskCounts(state.tasks, taskId, 1, 0)
    }))

    try {
      const created = await window.polaris.subtasks.create({ taskId, title: cleanTitle })
      set((state) => ({
        subtasksByTask: {
          ...state.subtasksByTask,
          [taskId]: (state.subtasksByTask[taskId] ?? []).map((item) =>
            item.id === draft.id ? created : item
          )
        },
        ...clearError()
      }))
    } catch (error) {
      console.error('Failed to add subtask:', error)
      set((state) => ({
        subtasksByTask: {
          ...state.subtasksByTask,
          [taskId]: (state.subtasksByTask[taskId] ?? []).filter((item) => item.id !== draft.id)
        },
        tasks: withSubtaskCounts(state.tasks, taskId, -1, 0),
        ...writeFailed()
      }))
      // 调用方需要知道失败，才能把用户刚输入的文字还回输入框。
      throw error
    }
  },

  updateSubtask: async (id, patch) => {
    const entry = Object.entries(get().subtasksByTask).find(([, items]) =>
      items.some((item) => item.id === id)
    )
    if (!entry) return

    const [taskId, items] = entry
    const before = items.find((item) => item.id === id)
    if (!before) return

    const title = patch.title?.trim()
    if (patch.title !== undefined && !title) return

    const optimistic: Subtask = {
      ...before,
      title: title ?? before.title,
      completed: patch.completed ?? before.completed
    }
    const doneDelta = Number(optimistic.completed) - Number(before.completed)

    set((state) => ({
      subtasksByTask: {
        ...state.subtasksByTask,
        [taskId]: (state.subtasksByTask[taskId] ?? []).map((item) =>
          item.id === id ? optimistic : item
        )
      },
      tasks: withSubtaskCounts(state.tasks, taskId, 0, doneDelta)
    }))

    try {
      const updated = await window.polaris.subtasks.update({
        id,
        ...(title !== undefined ? { title } : {}),
        ...(patch.completed !== undefined ? { completed: patch.completed } : {})
      })
      const settledDelta = Number(updated.completed) - Number(optimistic.completed)
      set((state) => ({
        subtasksByTask: {
          ...state.subtasksByTask,
          [taskId]: (state.subtasksByTask[taskId] ?? []).map((item) =>
            item.id === id ? updated : item
          )
        },
        tasks: withSubtaskCounts(state.tasks, taskId, 0, settledDelta),
        ...clearError()
      }))
    } catch (error) {
      console.error('Failed to update subtask:', error)
      set((state) => ({
        subtasksByTask: {
          ...state.subtasksByTask,
          [taskId]: (state.subtasksByTask[taskId] ?? []).map((item) =>
            item.id === id ? before : item
          )
        },
        tasks: withSubtaskCounts(state.tasks, taskId, 0, -doneDelta),
        ...writeFailed()
      }))
    }
  },

  removeSubtask: async (id) => {
    const entry = Object.entries(get().subtasksByTask).find(([, items]) =>
      items.some((item) => item.id === id)
    )
    if (!entry) return

    const [taskId, items] = entry
    const index = items.findIndex((item) => item.id === id)
    const before = items[index]
    if (!before) return
    const doneDelta = before.completed ? 1 : 0

    set((state) => ({
      subtasksByTask: {
        ...state.subtasksByTask,
        [taskId]: (state.subtasksByTask[taskId] ?? []).filter((item) => item.id !== id)
      },
      tasks: withSubtaskCounts(state.tasks, taskId, -1, -doneDelta)
    }))

    try {
      await window.polaris.subtasks.remove(id)
      set(clearError())
    } catch (error) {
      console.error('Failed to remove subtask:', error)
      set((state) => {
        const restored = [...(state.subtasksByTask[taskId] ?? [])]
        restored.splice(Math.min(index, restored.length), 0, before)
        return {
          subtasksByTask: { ...state.subtasksByTask, [taskId]: restored },
          tasks: withSubtaskCounts(state.tasks, taskId, 1, doneDelta),
          ...writeFailed()
        }
      })
    }
  },

  setView: (view) => {
    set((state) => ({
      view,
      projectFilter: null,
      tagFilter: null,
      // 进回收站关闭检查器：软删行没有详情，留着选中只会让第三列空转。
      // 统计页是整幅图表，检查器没有并排的空间。
      selectedTaskId: view === 'trash' || view === 'stats' || view === 'matrix' || view === 'calendar' ? null : state.selectedTaskId,
      // 确认弹窗不随导航漂流：视图一变就关。
      trashConfirm: null
    }))
    if (view === 'trash') void get().loadTrash()
  },

  setProjectFilter: (projectFilter) =>
    set({ projectFilter, tagFilter: null, view: 'all' }),

  setTagFilter: (tagFilter) => set({ tagFilter, projectFilter: null, view: 'all' }),

  createTag: async (name) => {
    try {
      const tag = await window.polaris.tags.create({ name })
      set((state) => {
        // 重名时 DB 复用已有标签，返回的 id 已在列表里，不能重复插入。
        if (state.tags.some((item) => item.id === tag.id)) return clearError()
        return {
          tags: [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
          ...clearError()
        }
      })
      return tag
    } catch (error) {
      set(writeFailed())
      throw error
    }
  },

  removeTag: async (id) => {
    const index = get().tags.findIndex((tag) => tag.id === id)
    if (index < 0) return
    const current = get().tags[index]
    const prevFilter = get().tagFilter
    // 级联在渲染层的镜像：删标签后所有任务行上的 chip 立刻消失。回滚需要
    // 知道哪些任务原本带着它，按任务 id 记录即可（tag 对象本身保留着）。
    const affected = new Set(
      [...get().tasks, ...get().trashedTasks]
        .filter((task) => task.tags.some((tag) => tag.id === id))
        .map((task) => task.id)
    )

    set((state) => ({
      tags: state.tags.filter((tag) => tag.id !== id),
      tagFilter: state.tagFilter === id ? null : state.tagFilter,
      tasks: state.tasks.map((task) => ({
        ...task,
        tags: task.tags.filter((tag) => tag.id !== id)
      })),
      trashedTasks: state.trashedTasks.map((task) => ({
        ...task,
        tags: task.tags.filter((tag) => tag.id !== id)
      }))
    }))

    try {
      await window.polaris.tags.remove(id)
      set(clearError())
    } catch (error) {
      set((state) => {
        const tags = [...state.tags]
        tags.splice(Math.min(index, tags.length), 0, current)
        const restore = (task: Task): Task =>
          affected.has(task.id) && !task.tags.some((tag) => tag.id === id)
            ? {
                ...task,
                tags: [...task.tags, current].sort((a, b) =>
                  a.name.localeCompare(b.name, 'zh-CN')
                )
              }
            : task
        return {
          tags,
          tagFilter: prevFilter,
          tasks: state.tasks.map(restore),
          trashedTasks: state.trashedTasks.map(restore),
          ...writeFailed()
        }
      })
    }
  },

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

    // tagIds 是替换式写入，不是 Task 字段：乐观行上的 tags 要从全局字典
    // 映射出来，否则 chip 要等 IPC 回来才变。省略时保持原关联不动。
    const { tagIds, ...rest } = patch
    const optimistic: Task = {
      ...current,
      ...rest,
      ...(tagIds !== undefined
        ? { tags: tagIds.flatMap((tagId) => get().tags.find((tag) => tag.id === tagId) ?? []) }
        : {}),
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
      set((state) => {
        // 硬删后子任务已被 ON DELETE CASCADE 清掉，缓存不能留活口。
        const subtasksByTask = { ...state.subtasksByTask }
        delete subtasksByTask[id]
        return { subtasksByTask, ...clearError() }
      })
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
      set((state) => {
        const subtasksByTask = { ...state.subtasksByTask }
        for (const task of current) delete subtasksByTask[task.id]
        return { subtasksByTask, ...clearError() }
      })
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
  },

  updateProject: async (id, patch) => {
    const current = get().projects.find((project) => project.id === id)
    if (!current) return
    const optimistic: Project = {
      ...current,
      name: patch.name ?? current.name,
      color: patch.color ?? current.color,
      updatedAt: new Date().toISOString()
    }
    set((state) => ({ projects: state.projects.map((p) => (p.id === id ? optimistic : p)) }))
    try {
      const project = await window.polaris.projects.update({ id, ...patch })
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? project : p)),
        ...clearError()
      }))
    } catch (error) {
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? current : p)),
        ...writeFailed()
      }))
      throw error
    }
  },

  deleteProject: async (id) => {
    const current = get().projects.find((project) => project.id === id)
    if (!current) return
    const prevFilter = get().projectFilter
    const affectedTaskIds = get().tasks.filter((t) => t.projectId === id).map((t) => t.id)
    // 乐观：移除项目、若正在筛选它则退出筛选、任务归「无项目」（与 DB 外键 SET NULL 一致）。
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      projectFilter: state.projectFilter === id ? null : state.projectFilter,
      tasks: state.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t))
    }))
    try {
      await window.polaris.projects.remove(id)
      set(clearError())
    } catch (error) {
      set((state) => ({
        projects: [...state.projects, current].sort((a, b) => a.sortOrder - b.sortOrder),
        projectFilter: prevFilter,
        tasks: state.tasks.map((t) =>
          affectedTaskIds.includes(t.id) ? { ...t, projectId: id } : t
        ),
        ...writeFailed()
      }))
      throw error
    }
  }
}))