import { useEffect, type RefObject } from 'react'

// Only the most recently opened overlay should handle Tab. Without this,
// overlapping traps (command palette over a dialog) both redirect focus.
const trapStack: symbol[] = []

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!active) return

    const container = containerRef.current
    if (!container) return

    const token = Symbol('focus-trap')
    trapStack.push(token)

    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const timer = window.setTimeout(() => {
      const initial = initialFocusRef?.current
      const first = container.querySelector<HTMLElement>(FOCUSABLE)
      ;(initial ?? first ?? container).focus()
    }, 30)

    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) =>
          !element.hasAttribute('disabled') &&
          element.getAttribute('aria-hidden') !== 'true' &&
          element.getClientRects().length > 0
      )

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      if (trapStack[trapStack.length - 1] !== token) return

      const focusable = getFocusable()
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement

      if (current === container) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }

      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      const index = trapStack.indexOf(token)
      if (index >= 0) trapStack.splice(index, 1)
      if (previous?.isConnected) previous.focus()
    }
  }, [active, containerRef, initialFocusRef])
}