import { useEffect, useRef, useState } from 'react'
import { Check } from '../Icon'
import type { Project, Tag } from '@shared/types'
import { useT } from '../../stores/useLocaleStore'
import { useAnchoredPopover } from '../../lib/useAnchoredPopover'

// 日历内筛选弹层（日历套件 P3.5）：按项目或标签过滤（互斥，语义同主列表），
// 「全部」清除。作用于全部日历子视图的同一份任务源。
type CalendarFilterMenuProps = {
  projects: Project[]
  tags: Tag[]
  projectFilter: string | null
  tagFilter: string | null
  onProject: (id: string | null) => void
  onTag: (id: string | null) => void
}

export function CalendarFilterMenu({
  projects,
  tags,
  projectFilter,
  tagFilter,
  onProject,
  onTag
}: CalendarFilterMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const active = Boolean(projectFilter || tagFilter)

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 224,
    estimatedHeight: 220,
    outsideIgnoreSelector: '[data-calendar-filter]',
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => popoverRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, popoverRef])

  const pick = (kind: 'project' | 'tag' | 'all', id: string | null): void => {
    if (kind === 'project') onProject(id)
    else if (kind === 'tag') onTag(id)
    else {
      onProject(null)
      onTag(null)
    }
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`calendar-tool-button ${active || open ? 'is-active' : ''}`}
        data-calendar-filter
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('calendar.filter.title')}
        title={t('calendar.filter.title')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="calendar-tool-dot" aria-hidden="true" data-filter-active={active ? 'true' : undefined} />
        {t('calendar.filter.title')}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="calendar-filter"
          style={{ top: place.top, left: place.left }}
          role="dialog"
          aria-label={t('calendar.filter.title')}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          <button
            type="button"
            className={`calendar-filter-row ${!active ? 'is-active' : ''}`}
            role="menuitemradio"
            aria-checked={!active}
            onClick={() => pick('all', null)}
          >
            {t('calendar.filter.clear')}
            {!active && <Check size={12} strokeWidth={2} aria-hidden="true" />}
          </button>
          {projects.length > 0 && (
            <>
              <div className="calendar-filter-group">{t('detail.project')}</div>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`calendar-filter-row ${projectFilter === project.id ? 'is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={projectFilter === project.id}
                  onClick={() => pick('project', projectFilter === project.id ? null : project.id)}
                >
                  <span className="board-dot" style={{ background: project.color }} aria-hidden="true" />
                  <span className="calendar-filter-name">{project.name}</span>
                  {projectFilter === project.id && <Check size={12} strokeWidth={2} aria-hidden="true" />}
                </button>
              ))}
            </>
          )}
          {tags.length > 0 && (
            <>
              <div className="calendar-filter-group">{t('nav.tags')}</div>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={`calendar-filter-row ${tagFilter === tag.id ? 'is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={tagFilter === tag.id}
                  onClick={() => pick('tag', tagFilter === tag.id ? null : tag.id)}
                >
                  <span className="calendar-filter-name"># {tag.name}</span>
                  {tagFilter === tag.id && <Check size={12} strokeWidth={2} aria-hidden="true" />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}
