import { create } from 'zustand'
import type { UpdateState } from '@shared/types'
import { shouldSurfaceUpdate } from '@shared/update'

// 在线更新的渲染层快照。主进程是唯一事实源：这里只收 update:state 推送，
// 不自己推算进度。「稍后」记 dismissedVersion（本会话不再为同一版本自动弹），
// 「跳过此版本」走主进程 meta（跨会话安静），两层互不越权。

type UpdateStore = {
  state: UpdateState | null
  dialogOpen: boolean
  /** 「稍后」点过的版本：本次运行内不再自动弹，手动检查/新版本会重置。 */
  dismissedVersion: string | null
  /** 收到快照（推送或查询回执）。manual=true 表示用户主动检查，忽略跳过与稍后。 */
  applyState: (next: UpdateState, manual?: boolean) => void
  openDialog: () => void
  /** 「稍后」：关弹窗，记住这个版本别再自动弹。 */
  dismissDialog: () => void
  check: () => Promise<UpdateState>
  skip: () => Promise<void>
  install: () => Promise<void>
}

const HAS_UPDATE = new Set(['available', 'downloading', 'downloaded'])

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  dialogOpen: false,
  dismissedVersion: null,

  applyState: (next, manual = false) => {
    const { dismissedVersion, dialogOpen } = get()
    const hasUpdate = next.latestVersion !== null && HAS_UPDATE.has(next.status)
    const dismissed = !manual && next.latestVersion !== null && next.latestVersion === dismissedVersion
    const surface =
      hasUpdate &&
      next.latestVersion !== null &&
      shouldSurfaceUpdate(next.latestVersion, next.skippedVersion, manual) &&
      !dismissed
    set({
      state: next,
      dialogOpen: surface ? true : dialogOpen,
      // 手动检查重新给机会；出现了别的版本也重新给机会。
      dismissedVersion:
        manual || (next.latestVersion !== null && next.latestVersion !== dismissedVersion)
          ? null
          : dismissedVersion
    })
  },

  openDialog: () => set({ dialogOpen: true }),

  dismissDialog: () =>
    set((current) => ({
      dialogOpen: false,
      dismissedVersion: current.state?.latestVersion ?? null
    })),

  check: async () => {
    const next = await window.polaris.update.check()
    get().applyState(next, true)
    return next
  },

  skip: async () => {
    const version = get().state?.latestVersion
    if (!version) return
    const next = await window.polaris.update.skip(version)
    set({ state: next, dialogOpen: false, dismissedVersion: null })
  },

  install: async () => {
    // 成功则应用直接退出重启；失败（未就绪）主进程会推 error 快照回来。
    await window.polaris.update.install()
  }
}))

/** App 挂载时订阅一次；返回清理函数供 effect 卸载。 */
export function subscribeUpdateStore(): () => void {
  const unsubscribe = window.polaris.update.onState((state) => {
    useUpdateStore.getState().applyState(state)
  })
  void window.polaris.update
    .getState()
    .then((state) => useUpdateStore.getState().applyState(state))
    .catch(() => {
      // 主进程尚未就绪时拿不到快照也无妨：后续推送会补上。
    })
  return unsubscribe
}