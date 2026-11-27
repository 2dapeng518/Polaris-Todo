import { useEffect, useRef, useState } from 'react'
import { Check, MoreHorizontal } from '../Icon'
import { useAnchoredPopover } from '../../lib/useAnchoredPopover'
import { useMatrixStore } from '../../stores/useMatrixStore'
import { useT } from '../../stores/useLocaleStore'
import type { MatrixGroupMode, MatrixSortDir, MatrixSortMode, QuadrantId } from './matching'

type QuadrantMenuProps = {
  quadrantId: QuadrantId
  /** 菜单里的「编辑」行：打开该象限的编辑弹窗（弹窗由 MatrixView 统一挂载）。 */
  onEdit: () => void
  /** 切到「手动」排序前快照当前可见顺序（MatrixView 提供）。 */
  onManualSort: () => void
}

// 象限头「…」菜单：编辑行 + 分组 / 排序 / 顺序三段单选。仓库没有 flyout
// 先例，照 CalendarFilterMenu 的「分组头 + menuitemradio 行」单面板分区；
// 选中即生效并收起（日历两菜单的同款纪律）。
export function QuadrantMenu({ quadrantId, onEdit, onManualSort }: QuadrantMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const prefs = useMatrixStore((state) => state.prefs[quadrantId])
  const setGroup = useMatrixStore((state) => state.setGroup)
  const setSort = useMatrixStore((state) => state.setSort)
  const setDir = useMatrixStore((state) => state.setDir)

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 208,
    estimatedHeight: 260,
    outsideIgnoreSelector: `[data-matrix-menu="${quadrantId}"]`,
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  // 同 CalendarFilterMenu：30ms 定时器等浮层真正挂载后聚焦，面板 tabIndex=-1。
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => popoverRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, popoverRef])

  const groupOptions: Array<{ value: MatrixGroupMode; label: string }> = [
    { value: 'none', label: t('matrix.group.none') },
    { value: 'time', label: t('matrix.group.time') }
  ]
  const sortOptions: Array<{ value: MatrixSortMode; label: string }> = [
    { value: 'time', label: t('matrix.sort.time') },
    { value: 'priority', label: t('matrix.sort.priority') },
    { value: 'title', label: t('matrix.sort.title') },
    { value: 'created', label: t('matrix.sort.created') },
    { value: 'manual', label: t('matrix.sort.manual') }
  ]
  const dirOptions: Array<{ value: MatrixSortDir; label: string }> = [
    { value: 'asc', label: t('matrix.order.asc') },
    { value: 'desc', label: t('matrix.order.desc') }
  ]

  const pickAndClose = (apply: () => void): void => {
    apply()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="matrix-quadrant-button"
        data-matrix-menu={quadrantId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('matrix.menu.menuAria')}
        title={t('matrix.menu.menuAria')}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="matrix-menu"
          role="dialog"
          aria-label={t('matrix.menu.menuAria')}
          tabIndex={-1}
          style={{ top: place.top, left: place.left }}
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
            className="matrix-menu-row"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              triggerRef.current?.focus()
              onEdit()
            }}
          >
            <span className="matrix-menu-name">{t('matrix.menu.edit')}</span>
          </button>
          <div className="matrix-menu-group">{t('matrix.menu.group')}</div>
          {groupOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`matrix-menu-row${prefs.group === option.value ? ' is-active' : ''}`}
              role="menuitemradio"
              aria-checked={prefs.group === option.value}
              onClick={() => pickAndClose(() => setGroup(quadrantId, option.value))}
            >
              <span className="matrix-menu-name">{option.label}</span>
              {prefs.group === option.value && <Check size={12} aria-hidden="true" />}
            </button>
          ))}
          <div className="matrix-menu-group">{t('matrix.menu.sort')}</div>
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`matrix-menu-row${prefs.sort === option.value ? ' is-active' : ''}`}
              role="menuitemradio"
              aria-checked={prefs.sort === option.value}
              onClick={() =>
                pickAndClose(() => {
                  // 切手动前先按当前可见顺序打底，避免跳回 DB 顺序。
                  if (option.value === 'manual') onManualSort()
                  setSort(quadrantId, option.value)
                })
              }
            >
              <span className="matrix-menu-name">{option.label}</span>
              {prefs.sort === option.value && <Check size={12} aria-hidden="true" />}
            </button>
          ))}
          <div className="matrix-menu-group">{t('matrix.menu.order')}</div>
          {dirOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`matrix-menu-row${prefs.dir === option.value ? ' is-active' : ''}`}
              role="menuitemradio"
              aria-checked={prefs.dir === option.value}
              onClick={() => pickAndClose(() => setDir(quadrantId, option.value))}
            >
              <span className="matrix-menu-name">{option.label}</span>
              {prefs.dir === option.value && <Check size={12} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
