import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, CornerDownLeft, Plus, X } from 'lucide-react'
import {
  QUICK_ADD_TITLE_MAX,
  dismissKeys,
  formatParsedDue,
  parseQuickAdd,
  pruneDismissed,
  type ParseChip
} from '@shared/quickAddParse'
import { useTaskStore } from '../stores/useTaskStore'
import { isTodayOrOverdue, isUpcoming, todayAt, tomorrowAt } from '../lib/dates'

type QuickAddProps = {
  inputRef: RefObject<HTMLInputElement | null>
}

type Note = { text: string; kind: 'ok' | 'error' }

// TaskView unmounts QuickAdd in the completed view. The draft must survive that.
let draftCache: { raw: string; dismissed: ReadonlyMap<string, number> } = {
  raw: '',
  dismissed: new Map()
}

// One clock source for the preview and the submit. Reading it in two places
// with two rules is how a chip ends up promising a date the task never gets.
const readNow = (): Date => {
  const injected = window.__polarisParseNow
  if (injected) {
    const injectedDate = new Date(injected)
    if (!Number.isNaN(injectedDate.getTime())) return injectedDate
  }
  return new Date()
}

const STRIP_MOTION = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }
}

export function QuickAdd({ inputRef }: QuickAddProps) {
  const [raw, setRaw] = useState(draftCache.raw)
  const [parseText, setParseText] = useState(draftCache.raw)
  const [dismissed, setDismissed] = useState<ReadonlyMap<string, number>>(draftCache.dismissed)
  const [nowTick, setNowTick] = useState(0)
  const [note, setNote] = useState<Note | null>(null)
  const [animating, setAnimating] = useState(false)
  const [status, setStatus] = useState('')

  const composingRef = useRef(false)
  const compositionEndAtRef = useRef(0)
  const chipsRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const signatureRef = useRef<string | null>(null)
  const forcedAtRef = useRef(0)
  const latestRef = useRef({ raw, dismissed })
  latestRef.current = { raw, dismissed }
  const restoreTextRef = useRef<string | null>(null)

  const addTask = useTaskStore((state) => state.addTask)
  const view = useTaskStore((state) => state.view)
  const projectFilter = useTaskStore((state) => state.projectFilter)
  const projects = useTaskStore((state) => state.projects)

  const now = useMemo(readNow, [nowTick])

  const parse = useMemo(
    () => parseQuickAdd(parseText, { now, projects, dismissed }),
    [parseText, now, projects, dismissed]
  )

  const parseRef = useRef(parse)
  parseRef.current = parse

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((tick) => tick + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    draftCache = latestRef.current
  }, [])

  // A new draft always wins over the previous receipt — except when the text
  // came back from a failed submit, which must keep its error visible.
  useEffect(() => {
    if (restoreTextRef.current === parseText) {
      restoreTextRef.current = null
      return
    }
    setNote(null)
  }, [parseText])

  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), 4000)
    return () => window.clearTimeout(timer)
  }, [note])

  // Belt and braces: if the animation callback never fires (reduced motion,
  // interrupted exit) the strip must still become focusable.
  useEffect(() => {
    if (!animating) return
    const timer = window.setTimeout(() => setAnimating(false), 260)
    return () => window.clearTimeout(timer)
  }, [animating])

  // Announce only semantic changes, debounced, and never mid-composition. The
  // title is deliberately absent: repeating an unchanged date on every keystroke
  // would drown a screen-reader user.
  useEffect(() => {
    if (composingRef.current) return
    let timer = 0
    const attempt = (): void => {
      if (composingRef.current) return
      if (signatureRef.current === parse.signature) return
      // A blocked Enter or a submit receipt holds the floor. Retry when the
      // hold expires rather than dropping the announcement outright.
      const held = 1200 - (performance.now() - forcedAtRef.current)
      if (held > 0) {
        timer = window.setTimeout(attempt, held)
        return
      }
      signatureRef.current = parse.signature
      setStatus(parse.announcement)
    }
    timer = window.setTimeout(attempt, 500)
    return () => window.clearTimeout(timer)
  }, [parse.signature, parse.announcement])

  // Clearing first guarantees the live region actually changes even when the
  // same message repeats — a blocked Enter must always be audible.
  const announce = (text: string): void => {
    forcedAtRef.current = performance.now()
    setStatus('')
    window.setTimeout(() => setStatus(text), 30)
  }

  const imeActive = (event: KeyboardEvent): boolean =>
    event.nativeEvent.isComposing ||
    event.keyCode === 229 ||
    composingRef.current ||
    performance.now() - compositionEndAtRef.current < 30

  const clearDraft = (): void => {
    setRaw('')
    setParseText('')
    setDismissed(new Map())
    setNote(null)
    draftCache = { raw: '', dismissed: new Map() }
  }

  const defaultDue = (): string | null =>
    view === 'today' ? todayAt(23, 59) : view === 'upcoming' ? tomorrowAt(9, 0) : null

  const submit = async (): Promise<void> => {
    // The DOM is the source of truth: this sidesteps React batching and the
    // native-setter path the smoke test uses.
    const submitted = inputRef.current?.value ?? raw
    if (!submitted.trim()) return

    const freshNow = readNow()
    // Keep the dismissals the user made: a chip they cancelled must stay
    // cancelled in the task that gets written.
    const activeDismissed = dismissed
    const parsed = parseQuickAdd(submitted, { now: freshNow, projects, dismissed: activeDismissed })

    if (parsed.emptyTitle || parsed.tooLong) {
      announce(
        parsed.emptyTitle ? '未添加：还差一个任务名' : `未添加：任务名太长（最多 ${QUICK_ADD_TITLE_MAX} 字）`
      )
      return
    }

    // Clear before awaiting, so a second task typed during the IPC round trip
    // is never swallowed.
    clearDraft()
    setNowTick((tick) => tick + 1)

    const dueAt = parsed.dueAt ?? defaultDue()
    const projectId = parsed.projectId ?? projectFilter

    try {
      await addTask(parsed.title, dueAt, projectId, parsed.priority)
      inputRef.current?.focus()

      // View-default hours are invented too, so they are never shown.
      const showTime = parsed.dueAt ? parsed.timeExplicit : false
      let text = '已添加' + (dueAt ? ` · ${formatParsedDue(dueAt, showTime, freshNow)}` : '')
      const inView =
        view === 'today' ? isTodayOrOverdue(dueAt) : view === 'upcoming' ? isUpcoming(dueAt) : true
      const inProject = projectFilter === null || projectId === projectFilter
      if (!inProject) {
        const name = projects.find((project) => project.id === projectId)?.name ?? '其他项目'
        text += ` · 在「${name}」`
      } else if (!inView) {
        const where = isTodayOrOverdue(dueAt) ? '今天' : isUpcoming(dueAt) ? '即将到来' : '全部任务'
        text += ` · 在「${where}」`
      }
      setNote({ kind: 'ok', text })
      announce(text)
    } catch (error) {
      console.error('Failed to add task:', error)
      // Roll back to the original text, not the parsed title, and keep both the
      // dismissals and the error receipt.
      restoreTextRef.current = submitted
      setRaw(submitted)
      setParseText(submitted)
      setDismissed(activeDismissed)
      setNote({ kind: 'error', text: '添加失败，请重试' })
      announce('添加失败，请重试')
    }
  }

  const focusAfterDismiss = (index: number): void => {
    window.setTimeout(() => {
      // AnimatePresence keeps the exiting strip's buttons in the DOM, so a
      // query would find a node that is about to unmount and strand focus on
      // <body>. Trust the live parse instead.
      if (parseRef.current.chips.length === 0) {
        toggleRef.current?.focus()
        return
      }
      const buttons = chipsRef.current?.querySelectorAll<HTMLButtonElement>('.qa-chip')
      if (buttons && buttons.length) buttons[Math.min(index, buttons.length - 1)].focus()
      else toggleRef.current?.focus()
    }, 0)
  }

  const dismissChip = (chip: ParseChip, index: number, keyboard: boolean): void => {
    if (composingRef.current) return
    // A click landing on the exiting snapshot must not act on a stale chip.
    if (!parseRef.current.chips.some((live) => live.id === chip.id)) return
    const next = dismissKeys(chip.tokenKeys, dismissed, parse.candidateCounts)
    const after = parseQuickAdd(parseText, { now, projects, dismissed: next })
    setDismissed(next)
    announce(`已保留为文字，标题将为「${after.title}」`)
    if (keyboard) {
      // Never bounce focus back to the input: Tab → Enter would then submit the
      // exact opposite of what the chip said.
      focusAfterDismiss(index)
    } else {
      inputRef.current?.focus()
      const caret = chip.spans[0]?.start ?? 0
      inputRef.current?.setSelectionRange(caret, caret)
    }
  }

  const onChipClick = (chip: ParseChip, index: number) => (event: MouseEvent<HTMLButtonElement>) => {
    dismissChip(chip, index, event.detail === 0)
  }

  const onChipKeyDown = (chip: ParseChip, index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return
    event.preventDefault()
    dismissChip(chip, index, true)
  }

  const keepAsText = (): void => {
    const keys = parse.chips.flatMap((chip) => chip.tokenKeys)
    const next = dismissKeys(keys, dismissed, parse.candidateCounts)
    const after = parseQuickAdd(parseText, { now, projects, dismissed: next })
    setDismissed(next)
    announce(`已保留为文字，标题将为「${after.title}」`)
    inputRef.current?.focus()
  }

  const restoreParse = (): void => {
    setDismissed(new Map())
    inputRef.current?.focus()
  }

  const onShellKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (imeActive(event)) return
    if (event.key !== 'Escape') return
    // TaskDetail listens on window and preventDefaults; without this, Esc on a
    // chip would close the inspector instead of clearing the draft.
    event.preventDefault()
    event.stopPropagation()
    clearDraft()
    inputRef.current?.blur()
  }

  const blocked = parse.emptyTitle || parse.tooLong
  const showStrip = !note && (parse.chips.length + parse.notices.length > 0 || blocked)
  const lead = parse.chips.length > 0 ? '已识别' : '未识别'
  const projectColor = (id: string | null): string =>
    projects.find((project) => project.id === id)?.color ?? 'var(--text-tertiary)'

  const titleHint = parse.emptyTitle
    ? '还差一个任务名'
    : parse.tooLong
      ? `任务名太长（最多 ${QUICK_ADD_TITLE_MAX} 字）`
      : null

  return (
    <div className="quick-add-shell" onKeyDown={onShellKeyDown}>
      <div className="quick-add">
        <span className="quick-add-icon">
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <input
          ref={inputRef}
          value={raw}
          onChange={(event) => {
            const value = event.target.value
            setRaw(value)
            if (composingRef.current) return
            setParseText(value)
            setDismissed((prev) => pruneDismissed(value, prev))
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            compositionEndAtRef.current = performance.now()
            const value = event.currentTarget.value
            setParseText(value)
            setDismissed((prev) => pruneDismissed(value, prev))
          }}
          onKeyDown={(event) => {
            if (imeActive(event)) return
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
          onFocus={() => setNowTick((tick) => tick + 1)}
          onBlur={() => {
            // A compositionend lost to Alt+Tab must not wedge Enter forever.
            composingRef.current = false
          }}
          name="new-task"
          autoComplete="off"
          spellCheck={false}
          placeholder="添加任务…"
          aria-label="添加任务"
          aria-describedby="qa-hint"
          aria-invalid={blocked || undefined}
          aria-errormessage={blocked ? 'qa-error' : undefined}
        />
        {blocked ? (
          <span className="quick-add-hint">{parse.emptyTitle ? '需要任务名' : '任务名太长'}</span>
        ) : parse.chips.length > 0 ? (
          <button ref={toggleRef} type="button" className="qa-toggle" onClick={keepAsText}>
            保留为文字
          </button>
        ) : dismissed.size > 0 ? (
          <button ref={toggleRef} type="button" className="qa-toggle" onClick={restoreParse}>
            恢复识别
          </button>
        ) : (
          <span className="quick-add-hint">
            <CornerDownLeft size={12} aria-hidden="true" /> Enter
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {showStrip && (
          <motion.div
            key="strip"
            className="quick-add-parse"
            {...STRIP_MOTION}
            style={{ overflow: 'clip', overflowClipMargin: '4px' }}
            inert={animating}
            onAnimationStart={() => setAnimating(true)}
            onAnimationComplete={() => setAnimating(false)}
          >
            <span className="qa-lead">{lead}</span>
            {titleHint ? (
              <span className="qa-empty">{titleHint}</span>
            ) : (
              <span className="qa-title">{parse.title}</span>
            )}
            <span className="qa-divider" aria-hidden="true" />
            <div className="qa-chips" role="group" aria-label="识别结果" ref={chipsRef}>
              {parse.chips.map((chip, index) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`qa-chip${chip.past ? ' past' : ''}`}
                  title={`${chip.source}${chip.assumed ? ' · 时间为推断' : ''}`}
                  aria-label={chip.ariaLabel}
                  onClick={onChipClick(chip, index)}
                  onKeyDown={onChipKeyDown(chip, index)}
                >
                  {chip.id === 'due' && <CalendarDays size={12} aria-hidden="true" />}
                  {chip.id === 'project' && (
                    <span
                      className="meta-dot"
                      style={{ background: projectColor(parse.projectId) }}
                      aria-hidden="true"
                    />
                  )}
                  {chip.label}
                  <X size={11} aria-hidden="true" />
                </button>
              ))}
            </div>
            {parse.notices.map((notice) => (
              <span
                key={`${notice.kind}-${notice.name}`}
                className="qa-notice"
                title={notice.kind === 'miss' ? '可在侧栏新建同名项目' : undefined}
              >
                {notice.text}
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {note && (
          <motion.div
            key="note"
            className={`quick-add-note${note.kind === 'error' ? ' error' : ''}`}
            {...STRIP_MOTION}
            style={{ overflow: 'clip', overflowClipMargin: '4px' }}
          >
            {note.text}
          </motion.div>
        )}
      </AnimatePresence>

      <p id="qa-hint" className="sr-only">
        按 Tab 查看识别结果，Esc 清空
      </p>
      {/* Always mounted: aria-errormessage must resolve even while the strip is
          animating in, inert, or replaced by a receipt. */}
      <p id="qa-error" className="sr-only">
        {titleHint ?? ''}
      </p>
      <p id="qa-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </div>
  )
}