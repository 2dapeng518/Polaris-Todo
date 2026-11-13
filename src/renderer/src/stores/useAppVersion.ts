import { useEffect } from 'react'
import { create } from 'zustand'

type VersionState = {
  version: string
  load: () => void
}

// 版本号在一次会话内不变，全应用只取一次：主界面页脚与设置面板共用这一份，
// 避免两处各持 state 时出现「一处有版本、另一处没有」的分歧。
// pending 兜住并发首拉（页脚挂载与面板打开可能同时发生）；失败后清空，下次调用重试。
let pending: Promise<void> | null = null

const useVersionStore = create<VersionState>((set, get) => ({
  version: '',

  load: () => {
    if (get().version || pending) return

    pending = window.polaris.app
      .getVersion()
      .then((version) => {
        set({ version })
      })
      .catch(() => {
        // 取不到就留空：调用方只显示品牌名，不显示假版本。
      })
      .finally(() => {
        pending = null
      })
  }
}))

/**
 * 应用版本号，来自主进程 app.getVersion()，渲染层不写死：发布时改 package.json 即可。
 * 未取到时返回空串。active 为 false 时不发起请求，供未打开的面板延后到打开时再取。
 */
export function useAppVersion(active = true): string {
  const version = useVersionStore((state) => state.version)
  const load = useVersionStore((state) => state.load)

  useEffect(() => {
    if (active) load()
  }, [active, load])

  return version
}