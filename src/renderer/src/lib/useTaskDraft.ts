import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 任务详情面板的标题/备注草稿。
 *
 * 为什么需要 dirty 标记：详情面板开着时，外部写入（MCP、备份导入、窗口 focus
 * 全量重载）会更新 store 里的权威值。如果防抖保存只判「草稿 ≠ store 值」，
 * 旧草稿会在 500ms 后把外部修改静默覆盖回去（草稿回声）。所以：
 * - 只有用户 onChange 才置 dirty；
 * - 外部变化且对应字段未 dirty 时，草稿跟随权威值（同 SubtaskList 的同步模式）；
 * - 用户正在编辑（dirty）时外部变化不抢草稿——用户输入优先；
 * - 防抖与 flush 只在 dirty 时写回；保存成功且草稿没有再前进才清 dirty。
 *
 * 消费方必须按 task.id 作 key 重挂载（TaskDetailBody 已如此），
 * 换任务时草稿状态随之重建，本 hook 不处理 taskId 切换。
 */
type DraftPatch = { title?: string; notes?: string }

type UseTaskDraftOptions = {
  /** store 里的权威标题 */
  title: string
  /** store 里的权威备注 */
  notes: string
  /** 落库入口（TaskDetail 的排队 persist），返回是否写入成功 */
  persist: (patch: DraftPatch) => Promise<boolean>
}

export function useTaskDraft({ title: taskTitle, notes: taskNotes, persist }: UseTaskDraftOptions) {
  const [title, setTitle] = useState(taskTitle)
  const [notes, setNotes] = useState(taskNotes)
  // IME 组合期间不得覆盖草稿、也不得触发防抖保存；用 state 而非 ref，
  // 这样 compositionEnd 能重新触发下面的同步/防抖 effect。
  const [titleComposing, setTitleComposing] = useState(false)
  const [notesComposing, setNotesComposing] = useState(false)

  // dirty 用 ref：它只影响「要不要写回」，不需要驱动渲染；
  // latest ref 让异步保存回调能读到用户最新输入，判断保存期间草稿是否又前进了。
  const titleDirty = useRef(false)
  const notesDirty = useRef(false)
  const titleLatest = useRef(taskTitle)
  const notesLatest = useRef(taskNotes)

  const changeTitle = useCallback((value: string) => {
    titleDirty.current = true
    titleLatest.current = value
    setTitle(value)
  }, [])

  const changeNotes = useCallback((value: string) => {
    notesDirty.current = true
    notesLatest.current = value
    setNotes(value)
  }, [])

  // 外部同步：权威值变化且用户没有未保存的编辑时，草稿跟随。
  // dirty 时跳过——用户输入优先，等用户自己保存或放弃编辑。
  useEffect(() => {
    if (titleDirty.current || titleComposing) return
    titleLatest.current = taskTitle
    setTitle(taskTitle)
  }, [taskTitle, titleComposing])

  useEffect(() => {
    if (notesDirty.current || notesComposing) return
    notesLatest.current = taskNotes
    setNotes(taskNotes)
  }, [taskNotes, notesComposing])

  const saveTitle = useCallback(async (): Promise<boolean> => {
    const value = titleLatest.current.replace(/\r?\n/g, ' ').trim()
    if (!value) {
      // 空标题不落库：回退到权威值（保持旧 flushAll 的行为）。
      titleLatest.current = taskTitle
      setTitle(taskTitle)
      titleDirty.current = false
      return true
    }
    if (value === taskTitle) {
      // 用户改回原值：没有待写内容，清 dirty 让外部同步恢复工作。
      titleDirty.current = false
      return true
    }
    const ok = await persist({ title: value })
    // 保存期间用户可能继续输入：只有草稿仍等于本次提交值才清 dirty，
    // 否则保持 dirty，交给防抖把更新的内容再存一次。
    if (ok && titleLatest.current.replace(/\r?\n/g, ' ').trim() === value) {
      titleDirty.current = false
    }
    return ok
  }, [persist, taskTitle])

  const saveNotes = useCallback(async (): Promise<boolean> => {
    const value = notesLatest.current
    if (value === taskNotes) {
      notesDirty.current = false
      return true
    }
    const ok = await persist({ notes: value })
    if (ok && notesLatest.current === value) {
      notesDirty.current = false
    }
    return ok
  }, [persist, taskNotes])

  // 500ms 防抖（冒烟断言依赖这个时序）。只在 dirty 时武装定时器，
  // 外部修改引起的草稿同步不会触发写回。
  useEffect(() => {
    if (!titleDirty.current || titleComposing) return
    const value = title.replace(/\r?\n/g, ' ').trim()
    if (!value) return
    if (value === taskTitle) {
      titleDirty.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void saveTitle()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [title, taskTitle, titleComposing, saveTitle])

  useEffect(() => {
    if (!notesDirty.current || notesComposing) return
    if (notes === taskNotes) {
      notesDirty.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void saveNotes()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [notes, taskNotes, notesComposing, saveNotes])

  /** 立即写回所有 dirty 字段（blur / Esc / 卸载 / 重试按钮共用）。 */
  const flushAll = useCallback(async (): Promise<boolean> => {
    const jobs: Array<Promise<boolean>> = []
    if (titleDirty.current) jobs.push(saveTitle())
    if (notesDirty.current) jobs.push(saveNotes())
    if (jobs.length === 0) return true
    const results = await Promise.all(jobs)
    return results.every(Boolean)
  }, [saveTitle, saveNotes])

  return {
    title,
    notes,
    changeTitle,
    changeNotes,
    titleComposing,
    notesComposing,
    setTitleComposing,
    setNotesComposing,
    flushAll
  }
}