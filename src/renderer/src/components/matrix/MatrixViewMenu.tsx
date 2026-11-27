import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from '../Icon'
import { useAnchoredPopover } from '../../lib/useAnchoredPopover'
import { useMatrixStore } from '../../stores/useMatrixStore'
import { useT } from '../../stores/useLocaleStore'

// 视图级「…」菜单（矩阵标题行右侧）：目前只有「全部恢复默认」——把四个
// 象限的筛选/分组/排序/顺序一键还原为复刻旧派生规则的默认配置。
export function MatrixViewMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const resetAll = useMatrixStore((state) => state.resetAll)

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 200,
    estimatedHeight: 70,
    outsideIgnoreSelector: '[data-matrix-viewmenu]',
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => popoverRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, popoverRef])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="matrix-view-menu-trigger"
        data-matrix-viewmenu
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('matrix.viewMenu.open')}
        title={t('matrix.viewMenu.open')}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="matrix-menu"
          role="dialog"
          aria-label={t('matrix.viewMenu.open')}
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
              resetAll()
              setOpen(false)
              triggerRef.current?.focus()
            }}
          >
            <span className="matrix-menu-name">{t('matrix.menu.resetAll')}</span>
          </button>
        </div>
      )}
    </>
  )
}
