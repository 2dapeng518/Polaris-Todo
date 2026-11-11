import { useState, type RefObject } from 'react'
import { CornerDownLeft, Plus } from 'lucide-react'
import { useTaskStore } from '../stores/useTaskStore'
import { todayAt, tomorrowAt } from '../lib/dates'

type QuickAddProps = {
  inputRef: RefObject<HTMLInputElement | null>
}

export function QuickAdd({ inputRef }: QuickAddProps) {
  const [title, setTitle] = useState('')
  const addTask = useTaskStore((state) => state.addTask)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)

  const submit = async () => {
    const value = title.trim()
    if (!value) return

    const dueAt =
      view === 'today' ? todayAt(23, 59) : view === 'upcoming' ? tomorrowAt(9, 0) : null

    setTitle('')
    try {
      await addTask(value, dueAt, projectFilter)
      inputRef.current?.focus()
    } catch (error) {
      console.error('Failed to add task:', error)
      setTitle(value)
    }
  }

  return (
    <div className="quick-add">
      <span className="quick-add-icon">
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
      </span>
      <input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
          if (event.key === 'Escape') {
            setTitle('')
            inputRef.current?.blur()
          }
        }}
        name="new-task"
        autoComplete="off"
        spellCheck={false}
        placeholder="添加任务…"
        aria-label="添加任务"
      />
      <span className="quick-add-hint">
        <CornerDownLeft size={12} aria-hidden="true" /> Enter
      </span>
    </div>
  )
}