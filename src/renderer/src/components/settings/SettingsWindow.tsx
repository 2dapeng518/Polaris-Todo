import { Fragment, useEffect, type ComponentType } from 'react'
import type { MessageKey } from '@shared/i18n'
import { SETTINGS_SECTIONS, type SettingsSection } from '@shared/settings'
import { Cable, Database, Info, Palette, SlidersHorizontal } from '../Icon'
import { ThemeSync } from '../ThemeSync'
import { LocaleSync } from '../LocaleSync'
import { UpdateDialog } from '../UpdateDialog'
import { subscribeUpdateStore } from '../../stores/useUpdateStore'
import { useT } from '../../stores/useLocaleStore'
import { closeTopOverlay } from '../../lib/useOverlayClose'
import { useSettingsSectionStore } from './sectionStore'
import { AppearanceSection } from './AppearanceSection'
import { GeneralSection } from './GeneralSection'
import { DataSection } from './DataSection'
import { McpSection } from './McpSection'
import { AboutSection } from './AboutSection'

// 设置窗口（独立 BrowserWindow，主窗口的子窗口）：左侧分类导航 + 右侧当前分类。
// 分类顺序与路由跟 shared/settings.ts 的注册表；「关于」固定在导航末尾。
// 这不是主窗口里的浮层——没有遮罩、没有焦点陷阱、不做「一屏放得下」的行数
// 预算，每页只放一个分类。对话框（备份管理/确认框/更新弹窗）仍复用主窗口
// 那套 confirm-overlay 浮层词汇，挂在窗口根上。
const SECTION_META: Record<SettingsSection, { label: MessageKey; icon: typeof Info }> = {
  appearance: { label: 'settings.section.appearance', icon: Palette },
  general: { label: 'settings.section.general', icon: SlidersHorizontal },
  data: { label: 'settings.section.data', icon: Database },
  mcp: { label: 'settings.section.mcp', icon: Cable },
  about: { label: 'settings.section.about', icon: Info }
}

const SECTION_PAGE: Record<SettingsSection, ComponentType> = {
  appearance: AppearanceSection,
  general: GeneralSection,
  data: DataSection,
  mcp: McpSection,
  about: AboutSection
}

export function SettingsWindow() {
  const t = useT()
  const section = useSettingsSectionStore((state) => state.section)
  const setSection = useSettingsSectionStore((state) => state.setSection)
  const Page = SECTION_PAGE[section]

  // 窗口标题给任务栏 / Alt-Tab 看：随界面语言走。
  useEffect(() => {
    document.title = `${t('settings.title')} · Polaris`
  }, [t])

  // 订阅更新快照：关于页的状态行与「查看更新」入口、更新弹窗都住这扇窗口，
  // 不订阅就永远拿不到主进程的推送（App.tsx 那份订阅只属于主窗口）。
  useEffect(() => subscribeUpdateStore(), [])

  // Esc 关窗。有浮层（备份管理 / 确认框 / 更新弹窗）时只关最上层那一个：
  // 浮层自己已在 React 根停掉 Esc，这里是焦点漏在浮层之外的兜底。输入法
  // 合成中的 Esc 不算（isComposing / 229，同快速添加的守卫）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
      if (closeTopOverlay()) return
      void window.polaris.app.closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="settings-window">
      <ThemeSync />
      <LocaleSync />
      {/* 顶部拖拽条：横跨整窗、透明；右上角归系统窗口按钮（titleBarOverlay）。 */}
      <div className="settings-titlebar" aria-hidden="true" />
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <div className="settings-nav-title">{t('settings.title')}</div>
        {SETTINGS_SECTIONS.map((id) => {
          const { label, icon: Icon } = SECTION_META[id]
          const active = section === id
          return (
            <Fragment key={id}>
              {/* 「关于」隔开一段落在导航末尾：上面的分类再多，它也不跟着挤。 */}
              {id === 'about' && <div className="settings-nav-spacer" />}
              <button
                type="button"
                className={`nav-item settings-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                data-settings-section={id}
                onClick={() => setSection(id)}
              >
                <Icon size={16} strokeWidth={1.8} className="nav-icon" aria-hidden="true" />
                <span className="nav-text">{t(label)}</span>
              </button>
            </Fragment>
          )
        })}
      </nav>
      <main className="settings-content">
        {/* key = 分类：切页即重挂载，各页自己的状态与副作用从干净态开始。 */}
        <div className="settings-page" data-settings-page={section} key={section}>
          <h1 className="settings-page-title">{t(SECTION_META[section].label)}</h1>
          <Page />
        </div>
      </main>
      <UpdateDialog />
    </div>
  )
}
