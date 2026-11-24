import { create } from 'zustand'
import type { UpdateState } from '@shared/types'
import { shouldSurfaceUpdate } from '@shared/update'

// 在线更新的渲染层快照。主进程是唯一事实源：这里只收 update:state 推送，
// 不自己推算进度。「稍后」记 dismissedVersion（本会话不再为同一版本自动弹），
// 「跳过此版本」走主进程 meta（跨会话安静），两层互不越权。
// 设置是独立窗口后，更新弹窗的副本在每个窗口各有一份（各窗口各一份本 store）：
// 「稍后」同时记到主进程的会话账上并随快照带回（UpdateState.dismissedVersion），
// 两扇窗口对同一个版本的判断因此一致。

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
    const { dismissedVersion, dialogOpen, state } = get()
    const latest = next.latestVersion
    const hasUpdate = latest !== null && HAS_UPDATE.has(next.status)
    // 别的窗口（设置窗口）点过「稍后」：主进程随快照带回同一版本的记账，
    // 本窗口同样不再自动弹。harness 的合成快照不带这个字段，按本窗口记的算。
    const dismissedByMain = latest !== null && next.dismissedVersion === latest
    const dismissed = !manual && ((latest !== null && latest === dismissedVersion) || dismissedByMain)
    const surface =
      hasUpdate &&
      latest !== null &&
      shouldSurfaceUpdate(latest, next.skippedVersion, manual) &&
      !dismissed
    // 跨窗口收口：记账相对上一张快照是新出现的，说明用户刚在另一扇窗口点了
    // 「稍后」——本窗口里被盖住的那份弹窗副本一并收起。之后经「查看更新」重新
    // 打开的弹窗不受后续快照影响（同一版本的记账不再变化，revoked 为 false）。
    const newlyDismissed = dismissedByMain && next.dismissedVersion !== state?.dismissedVersion
    const revoked = dialogOpen && hasUpdate && !manual && newlyDismissed
    set({
      state: next,
      dialogOpen: surface ? true : revoked ? false : dialogOpen,
      // 手动检查重新给机会；出现了别的版本也重新给机会。
      dismissedVersion:
        revoked && latest !== null
          ? latest
          : manual || (latest !== null && latest !== dismissedVersion)
            ? null
            : dismissedVersion
    })
  },

  openDialog: () => set({ dialogOpen: true }),

  // 「稍后」：关弹窗，本窗口记住这个版本别再自动弹；同时报到主进程的会话账上，
  // 另一扇窗口（开着设置窗口时是被盖住的主窗口）那份副本据此一起安静。
  dismissDialog: () => {
    const version = get().state?.latestVersion ?? null
    set({ dialogOpen: false, dismissedVersion: version })
    if (version) void window.polaris.update.dismiss(version).catch(() => {})
  },

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