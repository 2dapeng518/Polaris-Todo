import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ArrowUpDown, Check, ChevronRight, Layers, ListOrdered, MoreHorizontal, Pencil } from '../Icon'
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

type SubKind = 'group' | 'sort' | 'dir'

// 象限头「…」菜单：主面板只留 4 行（编辑 + 分组/排序/顺序，各显示当前值），
// 点值行在右侧弹出二级选项面板——比把 13 个选项平铺更紧凑，也贴合参考设计。
// 二级面板用 fixed 定位按行矩形展开，空间不足时翻到左侧；Esc 分层：先收
// 二级面板，再收主面板。
export function QuadrantMenu({ quadrantId, onEdit, onManualSort }: QuadrantMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<{ kind: SubKind; top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const groupRef = useRef<HTMLButtonElement>(null)
  const sortRef = useRef<HTMLButtonElement>(null)
  const dirRef = useRef<HTMLButtonElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const prefs = useMatrixStore((state) => state.prefs[quadrantId])
  const setGroup = useMatrixStore((state) => state.setGroup)
  const setSort = useMatrixStore((state) => state.setSort)
  const setDir = useMatrixStore((state) => state.setDir)

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 208,
    estimatedHeight: 200,
    outsideIgnoreSelector: `[data-matrix-menu="${quadrantId}"]`,
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  useEffect(() => {
    if (!open) {
      setSubmenu(null)
      return
    }
    const timer = window.setTimeout(() => popoverRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, popoverRef])

  // 二级面板打开后把焦点送进选项（优先当前选中项），键盘可直接继续。
  useEffect(() => {
    if (!submenu) return
    const timer = window.setTimeout(() => {
      const panel = submenuRef.current
      if (!panel) return
      const checked = panel.querySelector<HTMLButtonElement>('[data-checked="true"]')
      const first = panel.querySelector<HTMLButtonElement>('.matrix-menu-row')
      ;(checked ?? first)?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [submenu])

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

  const groupLabel = groupOptions.find((option) => option.value === prefs.group)?.label ?? ''
  const sortLabel = sortOptions.find((option) => option.value === prefs.sort)?.label ?? ''
  const dirLabel = dirOptions.find((option) => option.value === prefs.dir)?.label ?? ''

  const navRefOf = (kind: SubKind) =>
    kind === 'group' ? groupRef : kind === 'sort' ? sortRef : dirRef

  const closeSubmenu = (): void => {
    const kind = submenu?.kind
    setSubmenu(null)
    if (kind) window.setTimeout(() => navRefOf(kind).current?.focus(), 0)
  }

  const openSubmenu = (kind: SubKind) => (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (submenu?.kind === kind) {
      setSubmenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 176
    const gap = 6
    let left = rect.right + gap
    if (left + width > window.innerWidth - 12) left = Math.max(12, rect.left - width - gap)
    const estimated = kind === 'sort' ? 248 : 132
    const top = Math.max(56, Math.min(rect.top - 6, window.innerHeight - 12 - estimated))
    setSubmenu({ kind, left, top })
  }

  const pickAndClose = (apply: () => void): void => {
    apply()
    setSubmenu(null)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const submenuOptions = (): Array<{ value: string; label: string; checked: boolean; pick: () => void }> => {
    if (!submenu) return []
    if (submenu.kind === 'group') {
      return groupOptions.map((option) => ({
        value: option.value,
        label: option.label,
        checked: prefs.group === option.value,
        pick: () => pickAndClose(() => setGroup(quadrantId, option.value))
      }))
    }
    if (submenu.kind === 'sort') {
      return sortOptions.map((option) => ({
        value: option.value,
        label: option.label,
        checked: prefs.sort === option.value,
        pick: () =>
          pickAndClose(() => {
            if (option.value === 'manual') onManualSort()
            setSort(quadrantId, option.value)
          })
      }))
    }
    return dirOptions.map((option) => ({
      value: option.value,
      label: option.label,
      checked: prefs.dir === option.value,
      pick: () => pickAndClose(() => setDir(quadrantId, option.value))
    }))
  }

  const titleOf = (kind: SubKind): string =>
    kind === 'group' ? t('matrix.menu.group') : kind === 'sort' ? t('matrix.menu.sort') : t('matrix.menu.order')

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
          className="matrix-menu matrix-quadrant-menu"
          role="dialog"
          aria-label={t('matrix.menu.menuAria')}
          tabIndex={-1}
          style={{ top: place.top, left: place.left }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            if (submenu) {
              closeSubmenu()
              return
            }
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          <button
            type="button"
            className="matrix-menu-row matrix-menu-action"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setSubmenu(null)
              triggerRef.current?.focus()
              onEdit()
            }}
          >
            <Pencil size={13} aria-hidden="true" />
            <span className="matrix-menu-name">{t('matrix.menu.edit')}</span>
          </button>

          <div className="matrix-menu-divider" role="separator" />

          <button
            ref={groupRef}
            type="button"
            className={`matrix-menu-row matrix-menu-nav${submenu?.kind === 'group' ? ' is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={submenu?.kind === 'group'}
            onClick={openSubmenu('group')}
          >
            <Layers size={13} aria-hidden="true" />
            <span className="matrix-menu-name">{t('matrix.menu.group')}</span>
            <span className="matrix-menu-value">{groupLabel}</span>
            <ChevronRight size={12} aria-hidden="true" />
          </button>

          <button
            ref={sortRef}
            type="button"
            className={`matrix-menu-row matrix-menu-nav${submenu?.kind === 'sort' ? ' is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={submenu?.kind === 'sort'}
            onClick={openSubmenu('sort')}
          >
            <ArrowUpDown size={13} aria-hidden="true" />
            <span className="matrix-menu-name">{t('matrix.menu.sort')}</span>
            <span className="matrix-menu-value">{sortLabel}</span>
            <ChevronRight size={12} aria-hidden="true" />
          </button>

          <button
            ref={dirRef}
            type="button"
            className={`matrix-menu-row matrix-menu-nav${submenu?.kind === 'dir' ? ' is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={submenu?.kind === 'dir'}
            onClick={openSubmenu('dir')}
          >
            <ListOrdered size={13} aria-hidden="true" />
            <span className="matrix-menu-name">{t('matrix.menu.order')}</span>
            <span className="matrix-menu-value">{dirLabel}</span>
            <ChevronRight size={12} aria-hidden="true" />
          </button>

          {submenu && (
            <div
              ref={submenuRef}
              className="matrix-menu matrix-submenu"
              role="menu"
              aria-label={titleOf(submenu.kind)}
              style={{ top: submenu.top, left: submenu.left }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
                event.preventDefault()
                event.stopPropagation()
                closeSubmenu()
              }}
            >
              <div className="matrix-submenu-title">{titleOf(submenu.kind)}</div>
              {submenuOptions().map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`matrix-menu-row${option.checked ? ' is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={option.checked}
                  data-checked={option.checked}
                  onClick={option.pick}
                >
                  <span className="matrix-menu-name">{option.label}</span>
                  {option.checked && <Check size={12} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}