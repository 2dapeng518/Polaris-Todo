import { useEffect, useRef, useState } from 'react'
import type { Subtask } from '@shared/types'
import { Check, Plus, X } from './Icon'
import { useTaskStore } from '../stores/useTaskStore'

type SubtaskListProps = {
  taskId: string
  total: number
  done: number
}

// 轻量检查清单：只有标题与完成态，没有日期/提醒/重复/项目/优先级。
// 父任务的完成与子任务互不联动（方案第 5 条），所以这里不读 task.completed。
export function SubtaskList({ taskId, total, done }: SubtaskListProps) {
  const subtasks = useTaskStore((state) => state.subtasksByTask[taskId])
  const loadSubtasks = useTaskStore((state) => state.loadSubtasks)
  const addSubtask = useTaskStore((state) => state.addSubtask)
  const updateSubtask = useTaskStore((state) => state.updateSubtask)
  const removeSubtask = useTaskStore((state) => state.removeSubtask)
  const [draft, setDraft] = useState('')
  const addRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void loadSubtasks(taskId)
  }, [loadSubtasks, taskId])

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    void addSubtask(taskId, title).catch(() => {
      // 失败时把文字还给用户，但不覆盖这期间新输入的内容。
      setDraft((current) => (current ? current : title))
      addRef.current?.focus()
    })
  }

  return (
    <div className="detail-checklist" data-subtask-list>
      <div className="detail-checklist-head">
        <span className="detail-group-label">检查清单</span>
        {total > 0 && (
          <span className="checklist-progress" data-subtask-progress>
            {done}/{total}
          </span>
        )}
      </div>

      {subtasks && subtasks.length > 0 && (
        <ul className="checklist" aria-label="检查清单">
          {subtasks.map((item) => (
            <SubtaskRow
              key={item.id}
              item={item}
              onToggle={(id, completed) => {
                void updateSubtask(id, { completed })
              }}
              onRename={(id, title) => {
                void updateSubtask(id, { title })
              }}
              onRemove={(id) => {
                void removeSubtask(id)
              }}
            />
          ))}
        </ul>
      )}

      <div className="checklist-add-row">
        <input
          ref={addRef}
          className="checklist-add"
          data-subtask-add
          value={draft}
          placeholder="添加子任务…"
          aria-label="添加子任务"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className="checklist-add-submit"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="添加子任务"
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

type SubtaskRowProps = {
  item: Subtask
  onToggle: (id: string, completed: boolean) => void
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
}

function SubtaskRow({ item, onToggle, onRename, onRemove }: SubtaskRowProps) {
  const [draft, setDraft] = useState(item.title)
  const composing = useRef(false)

  useEffect(() => {
    setDraft(item.title)
  }, [item.title])

  const commit = () => {
    const title = draft.trim()
    if (!title) {
      setDraft(item.title)
      return
    }
    if (title !== item.title) onRename(item.id, title)
  }

  return (
    <li className={`checklist-row ${item.completed ? 'is-done' : ''}`} data-subtask-id={item.id}>
      <button
        type="button"
        className={`checklist-check ${item.completed ? 'is-done' : ''}`}
        aria-pressed={item.completed}
        aria-label={
          item.completed ? `取消完成「${item.title}」` : `完成「${item.title}」`
        }
        onClick={() => onToggle(item.id, !item.completed)}
      >
        {item.completed && <Check size={11} strokeWidth={2.6} aria-hidden="true" />}
      </button>

      <input
        className="checklist-title"
        value={draft}
        aria-label={`子任务「${item.title}」`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composing.current) return
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
            return
          }
          if (event.key === 'Escape') {
            // 不拦截、不 stopPropagation：先把本次编辑落库，再让详情面板的
            // window 监听执行既有的「保存并收起」。拦截会破坏 Esc 语义。
            commit()
            event.currentTarget.blur()
          }
        }}
      />

      <button
        type="button"
        className="checklist-remove"
        onClick={() => onRemove(item.id)}
        aria-label={`删除子任务「${item.title}」`}
      >
        <X size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </li>
  )
}