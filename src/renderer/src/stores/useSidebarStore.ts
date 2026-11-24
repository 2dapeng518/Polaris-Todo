import { create } from 'zustand'

// 主窗口侧栏的展开/收起状态。收起后侧栏只剩图标（视图图标、项目彩点、标签首字），
// 横向空间全让给任务区。纯视图偏好：住 localStorage，不进 meta 表，也不走 IPC。
// 默认展开——所有既有布局与冒烟断言都量展开态。

const STORAGE_KEY = 'polaris-sidebar-collapsed'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

type SidebarState = {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: readStored(),

  setCollapsed: (collapsed) => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // 存储不可用时仅本次会话生效。
    }
    set({ collapsed })
  },

  toggleCollapsed: () => get().setCollapsed(!get().collapsed)
}))
