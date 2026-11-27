import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check } from '../Icon'
import type { MessageKey } from '@shared/i18n'
import { useTaskStore } from '../../stores/useTaskStore'
import { useMatrixStore } from '../../stores/useMatrixStore'
import { useFocusTrap } from '../../lib/useFocusTrap'
import { useOverlayClose } from '../../lib/useOverlayClose'
import { useT } from '../../stores/useLocaleStore'
import {
  QUADRANT_NUMERALS,
  defaultQuadrantPrefs,
  type MatrixDateScope,
  type MatrixFilter,
  type MatrixKindScope,
  type QuadrantId
} from './matching'

type QuadrantEditDialogProps = {
  quadrantId: QuadrantId
  onClose: () => void
}

// 自绘下拉（设置页语言行的路数）：原生 <select> 的弹出层由系统绘制，深色
// 主题下不搭；菜单绝对定位在行内，随弹窗滚动，不需要视口重定位数学。
type SelectOption = { value: string; label: string; color?: string }

function OptionSelect({
  value,
  options,
  ariaLabel,
  onChange
}: {
  value: string
  options: SelectOption[]
  ariaLabel: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const current = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (wrapRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={wrapRef} className="matrix-select">
      <button
        ref={triggerRef}
        type="button"
        className="matrix-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((openValue) => !openValue)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // 菜单没开时不拦 Esc：让事件冒泡到弹窗根，正常关闭弹窗。
          if (!open) return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }}
      >
        <span className="matrix-select-value">{current?.label ?? ''}</span>
        {current?.color && (
          <span className="matrix-select-dot" style={{ background: current.color }} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          className="matrix-select-menu"
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            // 焦点在选项上时 Esc 只收菜单，不能冒泡去关整个编辑弹窗。
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`matrix-select-option${selected ? ' selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <span className="matrix-select-name">{option.label}</span>
                {option.color && (
                  <span className="matrix-select-dot" style={{ background: option.color }} aria-hidden="true" />
                )}
                {selected && <Check size={12} strokeWidth={2} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const PRIORITY_LEVELS: Array<{ level: number; labelKey: MessageKey }> = [
  { level: 3, labelKey: 'detail.priorityOption.3' },
  { level: 2, labelKey: 'detail.priorityOption.2' },
  { level: 1, labelKey: 'detail.priorityOption.1' },
  { level: 0, labelKey: 'detail.priorityOption.0' }
]

const DATE_OPTIONS: Array<{ value: MatrixDateScope; labelKey: MessageKey }> = [
  { value: 'all', labelKey: 'matrix.date.all' },
  { value: 'today', labelKey: 'matrix.date.today' },
  { value: 'tomorrow', labelKey: 'matrix.date.tomorrow' },
  { value: 'week', labelKey: 'matrix.date.week' },
  { value: 'overdue', labelKey: 'matrix.date.overdue' },
  { value: 'todayOrOverdue', labelKey: 'matrix.date.todayOrOverdue' },
  { value: 'noDate', labelKey: 'matrix.date.noDate' }
]

const KIND_OPTIONS: Array<{ value: MatrixKindScope; labelKey: MessageKey }> = [
  { value: 'all', labelKey: 'matrix.edit.all' },
  { value: 'task', labelKey: 'matrix.edit.kindTask' },
  { value: 'note', labelKey: 'matrix.edit.kindNote' }
]

const QUADRANT_LABEL_KEYS: Record<QuadrantId, MessageKey> = {
  do: 'matrix.do',
  plan: 'matrix.plan',
  quick: 'matrix.quick',
  later: 'matrix.later'
}

// 「编辑象限」弹窗：单象限筛选配置（清单/日期/优先级/任务类型）。草稿是
// 组件本地状态——「保存」落库、「取消」/遮罩/Esc 丢弃、「恢复默认」只重置
// 草稿。挂 confirm-overlay 档（z-80），ConfirmDialog 同款的键盘与让位纪律。
export function QuadrantEditDialog({ quadrantId, onClose }: QuadrantEditDialogProps) {
  const t = useT()
  const projects = useTaskStore((state) => state.projects)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const storedFilter = useMatrixStore((state) => state.prefs[quadrantId].filter)
  const setFilter = useMatrixStore((state) => state.setFilter)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 草稿只在挂载时读一次现值：弹窗开着时外部改配置属于不存在场景。
  // 清单若已被删除（偏好在 localStorage 里仍是旧 id），这里清洗为「所有」，
  // 避免下拉显示空白、保存又把失效 id 写回。
  const [projectId, setProjectId] = useState<string | null>(() => {
    const stored = storedFilter.projectId
    return stored && projects.some((project) => project.id === stored) ? stored : null
  })
  const [date, setDate] = useState<MatrixDateScope>(storedFilter.date)
  const [priorities, setPriorities] = useState<'all' | number[]>(storedFilter.priorities)
  const [kind, setKind] = useState<MatrixKindScope>(storedFilter.kind)

  useFocusTrap(panelRef, !paletteOpen, cancelRef)
  useOverlayClose(!paletteOpen, onClose)

  useEffect(() => {
    if (paletteOpen) onClose()
  }, [paletteOpen, onClose])

  const save = (): void => {
    const filter: MatrixFilter = { projectId, date, priorities, kind }
    setFilter(quadrantId, filter)
    onClose()
  }

  const resetDraft = (): void => {
    const fallback = defaultQuadrantPrefs()[quadrantId].filter
    setProjectId(fallback.projectId)
    setDate(fallback.date)
    setPriorities(fallback.priorities)
    setKind(fallback.kind)
  }

  const allPriorities = priorities === 'all'
  const toggleLevel = (level: number): void => {
    const current = priorities === 'all' ? [3, 2, 1, 0] : priorities
    setPriorities(
      current.includes(level)
        ? current.filter((item) => item !== level)
        : [...current, level].sort((a, b) => b - a)
    )
  }

  const listOptions: SelectOption[] = [
    { value: '', label: t('matrix.edit.all') },
    ...projects.map((project) => ({ value: project.id, label: project.name, color: project.color }))
  ]

  return (
    <motion.div
      className="confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={onClose}
    >
      <motion.div
        className="confirm-panel matrix-edit-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('matrix.edit.title')}
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <div className="matrix-edit-head">
          <span className="matrix-edit-title">{t('matrix.edit.title')}</span>
          <span className="matrix-edit-quadrant">
            <span className="matrix-quadrant-num" aria-hidden="true">
              {QUADRANT_NUMERALS[quadrantId]}
            </span>
            {t(QUADRANT_LABEL_KEYS[quadrantId])}
          </span>
        </div>

        <div className="matrix-edit-form">
          <span className="matrix-edit-label">{t('matrix.edit.list')}</span>
          <div className="matrix-edit-control">
            <OptionSelect
              value={projectId ?? ''}
              options={listOptions}
              ariaLabel={t('matrix.edit.list')}
              onChange={(value) => setProjectId(value === '' ? null : value)}
            />
          </div>

          <span className="matrix-edit-label">{t('matrix.edit.date')}</span>
          <div className="matrix-edit-control">
            <OptionSelect
              value={date}
              options={DATE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              ariaLabel={t('matrix.edit.date')}
              onChange={(value) => setDate(value as MatrixDateScope)}
            />
          </div>

          <span className="matrix-edit-label">{t('matrix.edit.priority')}</span>
          <div className="matrix-edit-control matrix-check-row" role="group" aria-label={t('matrix.edit.priority')}>
            <button
              type="button"
              className="matrix-check"
              aria-pressed={allPriorities}
              onClick={() => setPriorities('all')}
            >
              <span className={`matrix-check-box${allPriorities ? ' checked' : ''}`} aria-hidden="true">
                {allPriorities && <Check size={10} strokeWidth={2.4} />}
              </span>
              {t('matrix.edit.all')}
            </button>
            {PRIORITY_LEVELS.map(({ level, labelKey }) => {
              const checked = priorities !== 'all' && priorities.includes(level)
              return (
                <button key={level} type="button" className="matrix-check" aria-pressed={checked} onClick={() => toggleLevel(level)}>
                  <span className={`matrix-check-box${checked ? ' checked' : ''}`} aria-hidden="true">
                    {checked && <Check size={10} strokeWidth={2.4} />}
                  </span>
                  {t(labelKey)}
                </button>
              )
            })}
          </div>

          <span className="matrix-edit-label">{t('matrix.edit.kind')}</span>
          <div className="matrix-edit-control matrix-radio-row" role="radiogroup" aria-label={t('matrix.edit.kind')}>
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="matrix-radio"
                role="radio"
                aria-checked={kind === option.value}
                onClick={() => setKind(option.value)}
              >
                <span className={`matrix-radio-dot${kind === option.value ? ' checked' : ''}`} aria-hidden="true" />
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="matrix-edit-actions">
          <button type="button" className="matrix-edit-reset" onClick={resetDraft}>
            {t('matrix.edit.reset')}
          </button>
          <button ref={cancelRef} type="button" className="detail-popover-action" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="detail-popover-action matrix-edit-save" onClick={save}>
            {t('common.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
