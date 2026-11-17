import { create } from 'zustand'
import type {
  AppView,
  Project,
  Subtask,
  Tag,
  Task,
  UpdateSubtaskInput,
  UpdateTaskInput,
  UpdateTaskResult
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

// 字段级回滚用的类型安全摘取：只拷贝 keys 指定的字段（泛型 K 保证键值同型，
// 不用 as any 逐个断言）。供 runUpdate 从 pre-call 整行里摘出本次 patch 涉及
// 的字段快照。
function pickTaskFields<K extends keyof Task>(source: Task, keys: readonly K[]): Pick<Task, K> {
  const out = {} as Pick<Task, K>
  for (const key of keys) out[key] = source[key]
  return out
}

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
  // 最近一次成功全量 load 的写修订号盖章（迁移 7 触发器维护）。null = 从未
  // 同步过，focus 必拉。load() 用「读 list 之前」取的号盖章；自有写入成功落定
  // 后 fire-and-forget 刷新（见 stampRevision），失败路径不盖。
  lastSyncedRevision: number | null
  pendingDeletion: Task | null
  trashConfirm: TrashConfirm | null
  notice: { dueAt: string } | null
  storageError: MessageKey | null
  load: () => Promise<void>
  loadTrash: () => Promise<void>
  // focus 刷新门控：修订号与盖章相同则跳过全量重拉；不同（或取号失败）照旧
  // load()+loadTrash()。外部变更可见性不降级，只省「无变化时的空拉」。
  refreshOnFocus: () => Promise<void>
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
  // 成功返回更新后的权威任务行；目标任务不在本地列表时返回 null。失败照旧抛错。
  updateTask: (id: string, patch: TaskPatch) => Promise<Task | null>
  // 接口契约：成功 ok:true，spawned 原样透传 DB 返回（无生成则 null）；
  // 失败 ok:false spawned:null（回滚与错误提示已在内部完成）。
  toggleTask: (id: string) => Promise<{ ok: boolean; spawned: Task | null }>
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

export const useTaskStore = create<TaskState>((set, get) => {
  // 自有写入成功落定后的盖章刷新（fire-and-forget）：避免「自己刚写完 → 下次
  // focus 必然多拉一次」。失败路径不调用——盖章留在旧值，号不同必拉。漏盖
  // （取号失败/进程忙）最多多拉一次，正确性由门控的「号不同必拉」保证。
  // 固有边界（与 runUpdate 的同字段并发残余同类）：写提交与本次取号之间有
  // 毫秒级间隙，外部写入（MCP）恰好落在间隙里时，取回的号已包含它而 store
  // 尚未见到那一行——该外部变更会推迟到下一次任何变更后的 focus 才可见。
  // 彻底消除需要每个写通道回传落定修订号，本轮按选定方案接受此边界。
  const stampRevision = async (): Promise<void> => {
    try {
      const revision = await window.polaris.data.getRevision()
      set({ lastSyncedRevision: revision })
    } catch {
      // 取号失败不盖：旧盖章 + 新修订号 → 下次 focus 多拉一次，安全方向。
    }
  }

  // load 序号：mount 与 focus（或设置页导入后的刷新）可能并发触发 load，只允许
  // 最新一次落数据与盖章——晚到的旧快照若覆盖新数据还盖上新号，门控会漏拉。
  // 过期的成功/失败都直接丢弃，由最新一次给出权威结果。
  let loadSeq = 0

  // 共享更新管线：乐观替换 → IPC → 权威落定（含 spawned 插入）→ 失败字段级回滚。
  // updateTask 与 toggleTask 都走这里，错误归属集合机制（writeFailed/clearError）
  // 与原来完全一致。spawned 由 DB 权威返回，直接插入本地列表，不再全量 load()，
  // 也不再靠「同标题+同规则」启发式猜新生任务。
  const runUpdate = async (id: string, patch: TaskPatch): Promise<UpdateTaskResult | null> => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return null

    // tagIds 是替换式写入，不是 Task 字段：乐观行上的 tags 要从全局字典
    // 映射出来，否则 chip 要等 IPC 回来才变。省略时保持原关联不动。
    const { tagIds, ...rest } = patch

    // 字段级回滚快照（并发竞态防护）：A(乐观)→B(乐观,含 A 的改动)→B 成功落库
    // →A 失败——若整行恢复成 pre-A 快照，B 已落库的字段会在 UI 被抹掉
    //（DB 正确 UI 错，直到下一次 load() 才纠正）。所以失败时只还原本次调用
    // 实际尝试修改的字段：patch 的键（rest 与 Task 字段同名同型）、tagIds
    // 派生的 tags、以及乐观盖章的 updatedAt；其余字段保留 store 当前值，
    // 其中可能包含并发成功写入的权威数据。
    const preCall: Partial<Task> = {
      ...pickTaskFields(current, Object.keys(rest) as Array<keyof typeof rest>),
      ...(tagIds !== undefined ? { tags: current.tags } : {}),
      updatedAt: current.updatedAt
    }

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
      const result = await window.polaris.tasks.update({ id, ...patch })
      set((state) => ({
        tasks: [
          // 完成重复任务时 DB 生成的下一次实例：权威行直接插入（去重防重复插入）。
          ...(result.spawned ? [result.spawned] : []),
          ...state.tasks
            .map((task) => (task.id === id ? result.task : task))
            .filter((task) => task.id !== result.spawned?.id)
        ],
        ...clearError()
      }))
      // 自有写入已落定：刷新盖章，下次 focus 不为自己的写入多拉一次。
      void stampRevision()
      return result
    } catch (error) {
      // 只覆盖 preCall 快照里的字段（本次 patch 的键 + 派生 tags + 乐观
      // updatedAt），不整行替换——并发成功写入的其他字段原样保留。
      // spawned 不受影响：它只在成功分支插入，失败路径从未插入过生成行。
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...preCall } : task)),
        ...writeFailed()
      }))
      throw error
    }
  }

  return {
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
  lastSyncedRevision: null,
  pendingDeletion: null,
  trashConfirm: null,
  notice: null,
  storageError: null,

  load: async () => {
    const seq = ++loadSeq
    try {
      // 取号在读 list 之前（方向承重）：取号之后、list 落地之前的间隙写入会让
      // 「当前号 > 盖章」，下次 focus 多拉一次——宁可多拉不可漏拉。反过来
      // （先 list 后取号）会把含间隙写入的新号盖在不含它的旧快照上，门控从此
      // 漏拉。取号失败按 null（从未同步）处理，同样是「下次必拉」的安全方向。
      const revision = await window.polaris.data.getRevision().catch(() => null)
      const [tasks, projects, tags] = await Promise.all([
        window.polaris.tasks.list(),
        window.polaris.projects.list(),
        window.polaris.tags.list()
      ])
      // 过期读取：更晚发起的 load 已接管，旧快照不得覆盖数据与盖章。
      if (seq !== loadSeq) return
      set((state) => ({
        tasks,
        projects,
        tags,
        loading: false,
        lastSyncedRevision: revision,
        storageError: readSucceeded('load', state.storageError),
        selectedTaskId: tasks.some((task) => task.id === state.selectedTaskId)
          ? state.selectedTaskId
          : null
      }))
    } catch (error) {
      if (seq !== loadSeq) return
      console.error('Failed to load Polaris data:', error)
      set({ loading: false, ...readFailed('load') })
    }
  },

  refreshOnFocus: async () => {
    // focus 门控：修订号没变说明五张数据表没变（迁移 7 触发器覆盖所有写入
    // 路径），跳过全量重拉——tasks 数组引用不变，全部订阅者零重渲染。变了
    // （或从未同步/取号失败）照旧全量 load()+loadTrash()，外部变更（MCP/CSV
    // 导入/备份导入/retention 清理）可见性不降级。
    try {
      const revision = await window.polaris.data.getRevision()
      if (revision === get().lastSyncedRevision) return
    } catch {
      // 取号失败：宁可多拉不可漏拉，退回无条件全量刷新（旧语义）。
    }
    await Promise.all([get().load(), get().loadTrash()])
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
      void stampRevision()
    } catch (error) {
      console.error('Failed to add subtask:', error)
      // add 类回滚不需要字段级快照：回滚对象是「独立行的插入」，不是字段竞态。
      // draft 按 id 精确移除，并发 add 追加的其他行原样保留；total 减一只冲销
      // 本次插入的那一行，done 不动（新行未完成），计数口径与行集合一致。
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

    // 字段级回滚快照（与 runUpdate 的 pickTaskFields 模式同构）：只记本次 patch
    // 实际尝试修改的键。A(改名)乐观 → B(勾选)乐观含 A 改动 → B 成功落库 →
    // A 失败——整行恢复成 before 会把 B 已落库的 completed 在 UI 抹掉（DB 正确
    // UI 错，直到下一次读取才纠正）。已知固有边界（与 runUpdate 一致）：同字段
    // 并发时后失败者退回 pre-A 值，可能覆盖先成功者的值，由下一次读取纠正。
    const preCall: Partial<Subtask> = {
      ...(title !== undefined ? { title: before.title } : {}),
      ...(patch.completed !== undefined ? { completed: before.completed } : {})
    }

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
      set((state) => {
        const items = state.subtasksByTask[taskId] ?? []
        const currentRow = items.find((item) => item.id === id)
        // 落定记账按「store 当前行」算差：并发下当前行可能已被另一次成功写入
        // 替换，按它算差保持计数与行集合一致；单线程下当前行就是 optimistic，
        // 与旧 settledDelta 语义完全相同。行已被并发移除则不记账（移除方已冲销）。
        const settledDelta = currentRow
          ? Number(updated.completed) - Number(currentRow.completed)
          : 0
        return {
          subtasksByTask: {
            ...state.subtasksByTask,
            [taskId]: items.map((item) => (item.id === id ? updated : item))
          },
          tasks: withSubtaskCounts(state.tasks, taskId, 0, settledDelta),
          ...clearError()
        }
      })
      void stampRevision()
    } catch (error) {
      console.error('Failed to update subtask:', error)
      set((state) => {
        const items = state.subtasksByTask[taskId] ?? []
        const currentRow = items.find((item) => item.id === id)
        // 回滚只覆盖 preCall 的键，其余字段保留 store 当前值（可能含并发成功
        // 写入的权威数据）。done 计数回滚同样按当前行算差：单线程下当前行就是
        // optimistic，差值即旧语义的 -doneDelta；本次没碰 completed 则不记账。
        const rollbackDelta =
          currentRow && preCall.completed !== undefined
            ? Number(preCall.completed) - Number(currentRow.completed)
            : 0
        return {
          subtasksByTask: {
            ...state.subtasksByTask,
            [taskId]: items.map((item) => (item.id === id ? { ...item, ...preCall } : item))
          },
          tasks: withSubtaskCounts(state.tasks, taskId, 0, rollbackDelta),
          ...writeFailed()
        }
      })
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
      void stampRevision()
    } catch (error) {
      console.error('Failed to remove subtask:', error)
      // remove 类回滚不需要字段级快照：回滚对象是「独立行的存在性」。行缺席
      // store 期间，并发 updateSubtask 找不到 entry 直接返回，没有字段竞态窗口；
      // 原位回插保留 sortOrder，并发 add 的其他行不受影响。total/done 记账按
      // 回插行自身的 completed 冲销，与行集合一致。
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
    // 对外返回更新后的权威任务行（失败仍抛错，保持既有调用点兼容）；
    // spawned 的插入已在 runUpdate 里完成。
    const result = await runUpdate(id, patch)
    return result ? result.task : null
  },

  toggleTask: async (id) => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return { ok: false, spawned: null }

    const completing = !current.completed && Boolean(current.recurrenceRule && current.dueAt)
    try {
      const result = await runUpdate(id, { completed: !current.completed })
      if (!result) return { ok: false, spawned: null }

      // 重复提示只在「完成」方向弹出，dueAt 取 DB 权威 spawned，不再猜。
      if (completing && result.spawned?.dueAt) {
        set({ notice: { dueAt: result.spawned.dueAt } })
      }
      // 取消完成方向：核对过 db.ts——DB 不删除已生成的 spawned 行
      // （completed_at 清空、规则不恢复，下一次实例独立存在），
      // 所以本地也不移除任何行，无需全量 reload。
      return { ok: true, spawned: result.spawned }
    } catch (error) {
      console.error('Failed to toggle task:', error)
      // 回滚与 writeFailed 已在 runUpdate 内完成；这里不再吞成假成功，
      // 而是把失败如实报告给调用方（TaskDetail 等）。
      return { ok: false, spawned: null }
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
      void stampRevision()
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
      void stampRevision()
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
  }
})