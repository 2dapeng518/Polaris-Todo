import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * 锚定浮层的公共定位 / 外点 / 滚动 / resize 收起逻辑。
 * 从 TaskDetail 的 openPopover + 重定位 effect 与 ThemeMenu 的同源实现抽出，
 * 两处数学逐行等价：
 * - 左对齐锚点，夹在视口左右各 12px 内；
 * - 首帧按预估高度决定朝上/朝下（无预估时先贴下方），layoutEffect 里再用
 *   offsetHeight（而非 rect —— pop-in 的 scale 会污染 rect）实测校正；
 * - ResizeObserver 跟随浮层自身高度变化（如确认清除面板展开）持续校正；
 * - 锚点矩形在每次打开时捕获一次，之后固定 —— 与旧 TaskDetail 把
 *   anchorTop/anchorBottom 存进 state 的语义一致；
 * - 外点 pointerdown / 窗口 resize / 捕获阶段 scroll 收起（不还原焦点），
 *   浮层内部与 outsideIgnoreSelector 命中的触发区不算外点；scroll 只在锚点
 *   真实位移时才收起——零位移滚动事件（滚动锚定重算、content-visibility
 *   状态切换等浏览器内部动作）不移动锚点，不该秒杀刚打开的浮层。
 *
 * Esc 刻意不在这里：两处的路由语义根本不同 —— TaskDetail 在 window 上监听
 * 并路由（先收弹层、再收详情栏，还要看 paletteOpen），ThemeMenu 在自身
 * onKeyDown 里 stopPropagation（否则一次 Esc 收两层）。合并会改变事件时序，
 * 所以 Esc 留在调用方。初始聚焦同理：TaskDetail 用 30ms 定时器（防重定位
 * 重新武装抢焦点），ThemeMenu 用同步 effect，各自保留。
 */

export type AnchoredPlace = { top: number; left: number }

type UseAnchoredPopoverOptions = {
  /** 浮层是否展开。ThemeMenu 挂载即展开，恒 true；TaskDetail 跟着弹层状态走。 */
  active: boolean
  /** 锚点元素（触发按钮）。每次打开时读取一次矩形。 */
  anchorRef: RefObject<HTMLElement | null>
  /** 浮层宽度，用于视口水平夹取（detail-popover 280 / theme-menu 240）。 */
  width: number
  /** 顶部下界：TaskDetail 56（避开标题栏），ThemeMenu 12。默认 12。 */
  minTop?: number
  /** 首帧预估高度，实测前的朝上/朝下判断用。默认 0（先贴锚点下方）。 */
  estimatedHeight?: number
  /** 外点白名单选择器：命中触发区（[data-detail-row] / .theme-switch）不算外点。 */
  outsideIgnoreSelector?: string
  /** 外点 / resize / scroll 收起回调（不还原焦点；还原焦点的关闭走调用方）。 */
  onDismiss: () => void
  /** 变化即视为重新打开（TaskDetail 传弹层 kind）。默认 null。 */
  resetKey?: string | number | null
}

const GAP = 6
const MARGIN = 12

export function useAnchoredPopover({
  active,
  anchorRef,
  width,
  minTop = MARGIN,
  estimatedHeight = 0,
  outsideIgnoreSelector,
  onDismiss,
  resetKey = null
}: UseAnchoredPopoverOptions): {
  place: AnchoredPlace
  popoverRef: RefObject<HTMLDivElement | null>
} {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  // 打开瞬间的锚点位置：scroll 收起前用它核对锚点是否真的动了。
  const anchorRectRef = useRef<{ top: number; left: number } | null>(null)
  // 首帧就给出位置，绝不用 visibility:hidden 占位：隐藏的节点不可聚焦，而
  // useLayoutEffect 里 setState 会让 React 先 flush 上一轮的 passive effect，
  // 初始聚焦会打在还隐藏着的节点上静默失败（ThemeMenu 的老规矩）。
  const [place, setPlace] = useState<AnchoredPlace>(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return { top: 0, left: 0 }
    return {
      top: rect.bottom + GAP,
      left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN))
    }
  })

  useLayoutEffect(() => {
    if (!active) return
    const anchor = anchorRef.current
    const element = popoverRef.current
    if (!anchor || !element) return

    const rect = anchor.getBoundingClientRect()
    anchorRectRef.current = { top: rect.top, left: rect.left }
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN))
    // 首帧预估：与旧 openPopover 相同的判断（严格 >），让首绘就落在正确一侧。
    const estimatedBelow = rect.bottom + GAP
    const initialTop =
      estimatedBelow + estimatedHeight > window.innerHeight - MARGIN
        ? Math.max(minTop, rect.top - estimatedHeight - GAP)
        : estimatedBelow
    setPlace({ top: initialTop, left })

    const placeNow = (): void => {
      const height = element.offsetHeight
      const below = rect.bottom + GAP
      const above = rect.top - height - GAP
      const preferred = below + height <= window.innerHeight - MARGIN ? below : above
      const top = Math.max(minTop, Math.min(preferred, window.innerHeight - MARGIN - height))
      // 0.5px 阈值：亚像素抖动不值得触发一次重渲染。
      setPlace((prev) =>
        Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5 ? prev : { top, left }
      )
    }
    placeNow()
    const observer = new ResizeObserver(placeNow)
    observer.observe(element)
    return () => observer.disconnect()
    // resetKey 变化 = 重新打开；width/minTop/estimatedHeight 随调用点常量或
    // 随 resetKey 一起变，不会单独漂移。
  }, [active, resetKey, anchorRef, width, minTop, estimatedHeight])

  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (popoverRef.current?.contains(target)) return
      if (outsideIgnoreSelector && target?.closest(outsideIgnoreSelector)) return
      onDismiss()
    }
    const onResize = () => onDismiss()
    const onScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return
      // 锚点没动就不收：浏览器会在浮层插入后发出零位移 scroll（滚动锚定
      // 重算等），旧逻辑在这里把刚打开的浮层同帧秒杀。锚点已卸载则照收。
      const anchor = anchorRef.current
      const saved = anchorRectRef.current
      if (anchor && saved) {
        const rect = anchor.getBoundingClientRect()
        if (Math.abs(rect.top - saved.top) < 0.5 && Math.abs(rect.left - saved.left) < 0.5) return
      }
      onDismiss()
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [active, onDismiss, outsideIgnoreSelector])

  return { place, popoverRef }
}