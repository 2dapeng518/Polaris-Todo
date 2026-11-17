import { useCallback, useState } from 'react'
import type { Task } from '@shared/types'
import { Plus, Tag, X } from '../Icon'
import { useTaskStore } from '../../stores/useTaskStore'
import { useT } from '../../stores/useLocaleStore'
import type { TaskPatch } from './types'

type TagEditorProps = {
  task: Task
  persist: (patch: TaskPatch) => Promise<boolean>
}

// 标签编辑区：已贴 chip + 新建输入框 + 建议 chip。草稿状态随详情面板
// （按 task.id 作 key）重挂载而重建，与拆分前同生命周期。
export function TagEditor({ task, persist }: TagEditorProps) {
  const t = useT()
  const allTags = useTaskStore((state) => state.tags)
  const createTag = useTaskStore((state) => state.createTag)
  const [tagDraft, setTagDraft] = useState('')

  // 标签的每次编辑都提交完整集合（替换式）。从 store 现读任务，避免连续操作
  // 时用上一帧的 task.tags 把刚移除的标签又写回去。
  const applyTagIds = useCallback(
    (mutate: (ids: string[]) => string[]) => {
      const latest = useTaskStore.getState().tasks.find((item) => item.id === task.id)
      const ids = (latest?.tags ?? task.tags).map((tag) => tag.id)
      void persist({ tagIds: mutate(ids) })
    },
    [persist, task.id, task.tags]
  )

  const commitTagDraft = useCallback(async () => {
    const name = tagDraft.trim()
    if (!name) return
    setTagDraft('')
    try {
      const tag = await createTag(name)
      const latest = useTaskStore.getState().tasks.find((item) => item.id === task.id)
      const ids = (latest?.tags ?? task.tags).map((item) => item.id)
      if (!ids.includes(tag.id)) void persist({ tagIds: [...ids, tag.id] })
    } catch (error) {
      // store 已写 storageError toast；把文字还回输入框，方便重试。
      console.error('Failed to create tag:', error)
      setTagDraft(name)
    }
  }, [createTag, persist, tagDraft, task.id, task.tags])

  // 已有但还没贴到本任务上的标签；点一下即贴，输入框负责新建。
  const tagSuggestions = allTags.filter(
    (tag) => !task.tags.some((attached) => attached.id === tag.id)
  )

  return (
    <div className="detail-tags">
      <div className="detail-group-label">{t('detail.tags')}</div>
      {task.tags.length > 0 && (
        <div className="detail-chips" role="group" aria-label={t('detail.tagsAdded')}>
          {task.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="detail-chip detail-tag-chip"
              data-detail-tag={tag.name}
              aria-label={t('detail.removeTag', { name: tag.name })}
              onClick={() => applyTagIds((ids) => ids.filter((id) => id !== tag.id))}
            >
              <Tag size={11} strokeWidth={1.8} aria-hidden="true" />
              {tag.name}
              <X size={10} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <input
        className="detail-tag-input"
        value={tagDraft}
        maxLength={40}
        placeholder={t('detail.tagPlaceholder')}
        aria-label={t('detail.tagLabel')}
        onChange={(event) => setTagDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            void commitTagDraft()
          } else if (event.key === 'Escape' && tagDraft) {
            // 只有草稿非空时才拦 Esc；空草稿的 Esc 仍是「保存并收起」。
            event.stopPropagation()
            setTagDraft('')
          }
        }}
      />
      {tagSuggestions.length > 0 && (
        <div
          className="detail-chips detail-tag-suggestions"
          role="group"
          aria-label={t('detail.tagSuggestions')}
        >
          {tagSuggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="detail-chip"
              aria-label={t('detail.addTagNamed', { name: tag.name })}
              onClick={() => applyTagIds((ids) => [...ids, tag.id])}
            >
              <Plus size={10} strokeWidth={2} aria-hidden="true" />
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}