import { useEffect, useState } from 'react'

/**
 * 分钟级重渲染信号：主列表与侧栏的「今天 / 即将到来 / 逾期」都按真实时钟
 * 现算，但派生 memo 只依赖 tasks 引用。应用常驻托盘跨过午夜后，没有写库就
 * 不会重新判断日界；这里每分钟加一，把 tick 放进 memo 依赖即可。
 *
 * 与 StatsView / MatrixView / CalendarView 各自的 60s tick 同义，只是抽出来
 * 给没有时钟依赖的视图复用。
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return tick
}