import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ListTodo, Plus } from '../Icon'
import type { Task } from '@shared/types'
import { QUICK_ADD_TITLE_MAX, parseQuickAdd } from '@shared/quickAddParse'
import { useTaskStore } from '../../stores/useTaskStore'
import { useAnchoredPopover } from '../../lib/useAnchoredPopover'
import { useLocale, useT } from '../../stores/useLocaleStore'
import { formatDue, todayAt } from '../../lib/dates'
import { DuePopover } from '../detail/DuePopover'
import type { QuadrantId } from './matching'

type QuadrantQuickAddProps = {
  quadrantId: QuadrantId
}

// dueTouched=false 表示用户没动过日期行（用文本解析或象限默认值）；
// true 时 dueAt 就是最终值——包括显式清空（null 不再被默认值覆盖）。
// projectTouched 同理：手动选过清单后，标题里的 #项目 不再覆盖手动选择。
type AddDraft = {
  raw: string
  dueAt: string | null
  dueTouched: boolean
  projectId: string | null
  projectTouched: boolean
}

// 草稿按象限各存一份（模块级，同 QuickAdd 的 draftCache 思路）：卡片是四个
// 象限各挂一个实例，单例草稿会串卡。仅会话内存级，提交/ESC 清空。
const draftCache = new Map<QuadrantId, AddDraft>()

const EMPTY_DRAFT: AddDraft = {
  raw: '',
  dueAt: null,
  dueTouched: false,
  projectId: null,
  projectTouched: false
}

// 新建默认值按象限推导：优先级落进该象限的默认重要性档，do/quick 再补
// 「今天 23:59」补紧急性。任务带自然语言日期/优先级时以解析为准。
const QUADRANT_ADD_DEFAULTS: Record<QuadrantId, { priority: number; dueToday: boolean }> = {
  do: { priority: 3, dueToday: true },
  plan: { priority: 2, dueToday: false },
  quick: { priority: 1, dueToday: true },
  later: { priority: 0, dueToday: false }
}

const readNow = (): Date => {
  const injected = window.__polarisParseNow
  if (injected) {
    const injectedDate = new Date(injected)
    if (!Number.isNaN(injectedDate.getTime())) return injectedDate
  }
  return new Date()
}

// 象限内「+」快速添加卡片：标题（自然语言解析）+ 日期行（复用 DuePopover
// 纯受控面板，吃合成 Task）+ 清单行。回车创建；Esc 清草稿收卡（根节点
// stopPropagation，不让窗口级 Esc 顺手关掉别的浮层）。
export function QuadrantQuickAdd({ quadrantId }: QuadrantQuickAddProps) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(draftCache.get(quadrantId)?.raw ?? EMPTY_DRAFT.raw)
  const [dueAt, setDueAt] = useState(draftCache.get(quadrantId)?.dueAt ?? EMPTY_DRAFT.dueAt)
  const [dueTouched, setDueTouched] = useState(draftCache.get(quadrantId)?.dueTouched ?? EMPTY_DRAFT.dueTouched)
  const [projectId, setProjectId] = useState(draftCache.get(quadrantId)?.projectId ?? EMPTY_DRAFT.projectId)
  const [projectTouched, setProjectTouched] = useState(
    draftCache.get(quadrantId)?.projectTouched ?? EMPTY_DRAFT.projectTouched
  )
  const [showDue, setShowDue] = useState(false)
  const [showList, setShowList] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(0)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const latestRef = useRef<AddDraft>({ raw, dueAt, dueTouched, projectId, projectTouched })
  latestRef.current = { raw, dueAt, dueTouched, projectId, projectTouched }

  const addTask = useTaskStore((state) => state.addTask)
  const projects = useTaskStore((state) => state.projects)

  const now = useMemo(readNow, [nowTick])
  const defaults = QUADRANT_ADD_DEFAULTS[quadrantId]

  const { place, popoverRef } = useAnchoredPopover({
    active: open,
    anchorRef: triggerRef,
    width: 300,
    estimatedHeight: 190,
    outsideIgnoreSelector: `[data-matrix-add="${quadrantId}"]`,
    onDismiss: () => setOpen(false),
    resetKey: open ? 'open' : null
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    const tick = window.setInterval(() => setNowTick((value) => value + 1), 60_000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(tick)
    }
  }, [open])

  // 卸载（切视图）时草稿写回缓存；提交/ESC 是显式 clearDraft，直接删键。
  useEffect(
    () => () => {
      draftCache.set(quadrantId, latestRef.current)
    },
    [quadrantId]
  )

  const clearDraft = (): void => {
    setRaw('')
    setDueAt(null)
    setDueTouched(false)
    setProjectId(null)
    setProjectTouched(false)
    setShowDue(false)
    setShowList(false)
    draftCache.delete(quadrantId)
  }

  const closeCard = (keepDraft: boolean): void => {
    setOpen(false)
    setShowDue(false)
    setShowList(false)
    if (!keepDraft) clearDraft()
    triggerRef.current?.focus()
  }

  // 子面板（日期/清单）选完即收，焦点必须回到输入框：否则焦点掉到 body，
  // 卡片看着还开着，Enter 提交与 Esc 关闭都会失灵（事件到不了卡片根）。
  const focusInput = (): void => {
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const parsed = useMemo(
    () => parseQuickAdd(raw, { now, projects, dismissed: new Map(), locale }),
    [raw, now, projects, locale]
  )
  const effectiveDue = dueTouched ? dueAt : (parsed.dueAt ?? (defaults.dueToday ? todayAt(23, 59) : null))
  // 手动选过清单则手动优先；否则跟随标题里的 #项目，让清单行如实反映归属。
  const effectiveProjectId = projectTouched ? projectId : parsed.projectId

  const submit = async (): Promise<void> => {
    // DOM 为真源（QuickAdd 同款纪律）：绕开 React 批处理与冒烟的原生
    // setter 写入路径，回车瞬间刚敲的内容绝不被旧 state 吞掉。
    const submitted = inputRef.current?.value ?? raw
    const fresh = readNow()
    const reparsed = parseQuickAdd(submitted, { now: fresh, projects, dismissed: new Map(), locale })
    if (!reparsed.title.trim() || reparsed.tooLong) return
    // 失败要能回滚：先快照，再清草稿（IPC 往返期间敲的第二条不能被吞）。
    const snapshot = { raw: submitted, dueAt, dueTouched, projectId, projectTouched }
    clearDraft()
    const finalDue = dueTouched ? dueAt : (reparsed.dueAt ?? (defaults.dueToday ? todayAt(23, 59) : null))
    const finalProjectId = projectTouched ? projectId : reparsed.projectId
    // parseQuickAdd.priority 恒为 number（无 !标记时是 0），不能用 ?? 回退；
    // 看 chips 里有没有 priority 标记来判断用户是否显式指定。
    const explicitPriority = reparsed.chips.some((chip) => chip.id === 'priority')
    try {
      await addTask(
        reparsed.title,
        finalDue,
        finalProjectId,
        explicitPriority ? reparsed.priority : defaults.priority,
        {
          startAt: reparsed.startAt,
          endAt: reparsed.endAt
        }
      )
      // 等待期间用户若已开始敲下一条，卡片与输入必须原样保留。
      if ((inputRef.current?.value ?? '').trim()) return
      closeCard(false)
    } catch (error) {
      console.error('Failed to add task from matrix:', error)
      // 失败回滚整条草稿并给错误回执（主 QuickAdd 的同款纪律）。
      setRaw(snapshot.raw)
      setDueAt(snapshot.dueAt)
      setDueTouched(snapshot.dueTouched)
      setProjectId(snapshot.projectId)
      setProjectTouched(snapshot.projectTouched)
      setNote(t('quickAdd.addFailed'))
      focusInput()
    }
  }

  // DuePopover 是纯受控面板（props { task, onPatch, onClose }），不碰定位；
  // 这里喂一个合成 Task 让它能复用（recurrenceRule 恒 null，不会踩「重复
  // 规则必须配 dueAt」的 DB 约束）。
  const syntheticTask: Task = {
    id: '',
    title: raw,
    notes: '',
    completed: false,
    completedAt: null,
    dueAt: effectiveDue,
    startAt: null,
    endAt: null,
    allDay: false,
    remindAt: null,
    remindedAt: null,
    recurrenceRule: null,
    projectId,
    priority: defaults.priority,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    subtaskTotal: 0,
    subtaskDone: 0,
    tags: []
  }

  const targetProject = projects.find((project) => project.id === effectiveProjectId) ?? null
  const dueLabel = effectiveDue ? formatDue(effectiveDue, locale) : t('detail.notSet')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="matrix-quadrant-button"
        data-matrix-add={quadrantId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('matrix.menu.addAria')}
        title={t('matrix.menu.addAria')}
        onClick={() =>
          setOpen((value) => {
            // 打开瞬间刷新解析时钟：矩阵常驻，now 若冻结在挂载时刻，
            // 预览日期会与提交时的解析结果差一天（跨午夜更明显）。
            if (!value) setNowTick((tick) => tick + 1)
            return !value
          })
        }
      >
        <Plus size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="matrix-add-card"
          role="dialog"
          aria-label={t('matrix.menu.addAria')}
          tabIndex={-1}
          style={{ top: place.top, left: place.left }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            // Esc 分层：先收已展开的子面板，再关卡片（同 TaskDetail 的弹层路由）。
            if (showDue) {
              setShowDue(false)
              return
            }
            if (showList) {
              setShowList(false)
              return
            }
            closeCard(false)
          }}
        >
          <div className="matrix-add-inputrow">
            <input
              ref={inputRef}
              className="matrix-add-input"
              value={raw}
              name="matrix-new-task"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('matrix.add.placeholder')}
              aria-label={t('matrix.menu.addAria')}
              aria-invalid={parsed.tooLong || undefined}
              onChange={(event) => {
                setRaw(event.target.value)
                setNote(null)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            {parsed.tooLong && (
              <span className="matrix-add-hint">{t('quickAdd.tooLong', { max: QUICK_ADD_TITLE_MAX })}</span>
            )}
            {note && <span className="matrix-add-note">{note}</span>}
          </div>

          <button
            type="button"
            className="matrix-add-row"
            aria-expanded={showDue}
            onClick={() => {
              setShowDue((value) => !value)
              setShowList(false)
            }}
          >
            <span className="matrix-add-rowlabel">
              <Plus size={12} aria-hidden="true" style={{ visibility: 'hidden' }} />
              {t('matrix.add.dateReminder')}
            </span>
            <span className="matrix-add-rowvalue">{dueLabel}</span>
          </button>
          {showDue && (
            <div className="matrix-add-subpanel">
              <DuePopover
                task={syntheticTask}
                onPatch={(patch) => {
                  if ('dueAt' in patch) {
                    setDueAt(patch.dueAt ?? null)
                    setDueTouched(true)
                  }
                }}
                onClose={() => {
                  setShowDue(false)
                  focusInput()
                }}
              />
            </div>
          )}

          <button
            type="button"
            className="matrix-add-row"
            aria-expanded={showList}
            onClick={() => {
              setShowList((value) => !value)
              setShowDue(false)
            }}
          >
            <span className="matrix-add-rowlabel">
              <ListTodo size={12} aria-hidden="true" />
              {targetProject?.name ?? t('detail.noProject')}
            </span>
            {targetProject && (
              <span className="matrix-add-dot" style={{ background: targetProject.color }} aria-hidden="true" />
            )}
          </button>
          {showList && (
            <div className="matrix-add-subpanel" role="menu">
              <button
                type="button"
                className={`matrix-menu-row${effectiveProjectId === null ? ' is-active' : ''}`}
                role="menuitemradio"
                aria-checked={effectiveProjectId === null}
                onClick={() => {
                  setProjectId(null)
                  setProjectTouched(true)
                  setShowList(false)
                  focusInput()
                }}
              >
                <span className="matrix-menu-name">{t('detail.noProject')}</span>
                {effectiveProjectId === null && <Check size={12} aria-hidden="true" />}
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`matrix-menu-row${effectiveProjectId === project.id ? ' is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={effectiveProjectId === project.id}
                  onClick={() => {
                    setProjectId(project.id)
                    setProjectTouched(true)
                    setShowList(false)
                    focusInput()
                  }}
                >
                  <span className="matrix-menu-name">{project.name}</span>
                  {effectiveProjectId === project.id && <Check size={12} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
