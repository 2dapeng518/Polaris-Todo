import { create } from 'zustand'
import { DEFAULT_SETTINGS_SECTION, SETTINGS_SECTION_EVENT, isSettingsSection, type SettingsSection } from '@shared/settings'

// 设置窗口的当前分类。渲染入口 hash（#/settings/<分类>）定初始页；主进程在窗口
// 已开着时经 executeJavaScript 派发 SETTINGS_SECTION_EVENT 切页（主窗口侧栏点
// 「关于」而设置窗口停在别的页时走这条路）。

type SectionState = {
  section: SettingsSection
  setSection: (next: SettingsSection) => void
}

function initialSection(): SettingsSection {
  const match = window.location.hash.match(/^#\/?settings(?:\/([a-z]+))?$/)
  if (!match) return DEFAULT_SETTINGS_SECTION
  return isSettingsSection(match[1]) ? match[1] : DEFAULT_SETTINGS_SECTION
}

export const useSettingsSectionStore = create<SectionState>((set) => ({
  section: initialSection(),

  setSection: (next) => {
    // 地址栏 hash 跟着当前页走：replaceState 不产生导航、不触发 hashchange，
    // 开发时刷新设置窗口还停在原来那一页。
    const hash = `#/settings/${next}`
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
    set({ section: next })
  }
}))

// 主进程的切页事件。监听器在模块求值期注册（main.tsx 静态导入本模块）：
// 早于文档 load 事件，主进程在 did-finish-load 之后派发时这里一定有人接——
// 挂在 useEffect 里会晚于 did-finish-load（React 的提交与副作用是后续宏任务）。
window.addEventListener(SETTINGS_SECTION_EVENT, (event) => {
  const detail = (event as CustomEvent<unknown>).detail
  if (isSettingsSection(detail)) useSettingsSectionStore.getState().setSection(detail)
})
