import { useState } from 'react'
import type { UpdateState } from '@shared/types'
import { useUpdateStore } from '../../stores/useUpdateStore'
import { useAppVersion } from '../../stores/useAppVersion'
import { useT, type Translate } from '../../stores/useLocaleStore'
import { SettingsRow } from './SettingsRow'

// 四芒星品牌标：与 build/icon.svg 同一几何与釉面渐变（teal→sky→violet）。
// 渐变按设计系统只属于星标的品牌时刻，关于页是合法落点。viewBox 直接
// 框住 1024 空间里星形的包围盒（136..888），路径坐标与 make:icon 逐字一致。
function StarMark() {
  return (
    <svg
      className="about-brand-star"
      width={28}
      height={28}
      viewBox="136 136 752 752"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="about-star-enamel" x1="136" y1="512" x2="888" y2="512" gradientUnits="userSpaceOnUse">
          <stop stopColor="#40CFB8" />
          <stop offset="0.5" stopColor="#68C1E6" />
          <stop offset="1" stopColor="#9F84E6" />
        </linearGradient>
      </defs>
      <path
        fill="url(#about-star-enamel)"
        d="M 500.7177125041066 167.13911348866577 Q 512 136 523.2822874958933 167.13911348866577 L 610.0865685714642 406.71892925724137 Q 612 412 617.2810707427586 413.9134314285357 L 856.8608865113342 500.7177125041066 Q 888 512 856.8608865113342 523.2822874958933 L 617.2810707427586 610.0865685714642 Q 612 612 610.0865685714642 617.2810707427586 L 523.2822874958933 856.8608865113342 Q 512 888 500.7177125041066 856.8608865113342 L 413.9134314285357 617.2810707427586 Q 412 612 406.71892925724137 610.0865685714642 L 167.13911348866577 523.2822874958933 Q 136 512 167.13911348866577 500.7177125041066 L 406.71892925724137 413.9134314285357 Q 412 412 413.9134314285357 406.71892925724137 L 500.7177125041066 167.13911348866577 Z"
      />
    </svg>
  )
}

/** 更新状态一行说清；错误细节另有 settings-error，这里不堆长文。 */
function updateStatusText(state: UpdateState | null, t: Translate): string {
  if (!state) return t('settings.update.idle')
  switch (state.status) {
    case 'unsupported':
      return t('settings.update.unsupported')
    case 'checking':
      return t('settings.update.checking')
    case 'available':
      return t('settings.update.available', { version: state.latestVersion ?? '' })
    case 'downloading':
      return t('settings.update.downloading', {
        version: state.latestVersion ?? '',
        percent: state.percent ?? 0
      })
    case 'downloaded':
      return t('settings.update.downloaded', { version: state.latestVersion ?? '' })
    case 'up-to-date':
      return t('settings.update.upToDate')
    case 'error':
      return t('settings.update.error')
    default:
      return t('settings.update.idle')
  }
}

// 设置窗口的「关于」页（设置窗口化之前是页脚开关拉起的模态对话框）：品牌与
// 版本、检查更新、许可与致谢、打开声明目录。纯只读 + 两个动作；「检查更新」
// 与更新弹窗的逻辑和设置还是浮层时一致（手动检查永远给答案；发现/下载/就绪
// 由 UpdateDialog 展示，它挂在 SettingsWindow 上）。
export function AboutSection() {
  const t = useT()
  // 进页面才取；与主界面页脚共用同一份版本号缓存，失败下次进页面重试。
  const version = useAppVersion()
  const update = useUpdateStore((state) => state.state)
  const checkUpdate = useUpdateStore((state) => state.check)
  const openUpdateDialog = useUpdateStore((state) => state.openDialog)
  const [updateChecking, setUpdateChecking] = useState(false)
  // 手动点过检查才展示状态文案：dev 的 unsupported 默认不落字（占位槽仍在）。
  const [updateAsked, setUpdateAsked] = useState(false)
  const [noticesError, setNoticesError] = useState<string | null>(null)

  // 状态槽常驻占位一行：检查结果落槽不撑高页面。
  const updateErrorDetail = update?.status === 'error' && update.error ? update.error : null
  const updateStatusVisible =
    !!update &&
    (updateAsked ||
      ['checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error'].includes(update.status))
  const updateStatusTextValue = updateErrorDetail ?? (updateStatusVisible && update ? updateStatusText(update, t) : '')

  const handleCheckUpdate = async () => {
    setUpdateChecking(true)
    setUpdateAsked(true)
    try {
      // 手动检查忽略「跳过此版本」；发现新版时 store 会顺手拉起更新弹窗。
      await checkUpdate()
    } catch {
      // 主进程会把 error 快照推回来，这里不另造一份错误文案。
    } finally {
      setUpdateChecking(false)
    }
  }

  const openNoticesDir = async () => {
    setNoticesError(null)
    try {
      const result = await window.polaris.app.openNoticesDir()
      if (!result.opened && result.error) {
        setNoticesError(t('settings.openNoticesFailed', { error: result.error }))
      }
    } catch (error) {
      setNoticesError(t('settings.openNoticesFailed', { error: String(error) }))
    }
  }

  return (
    <>
      {/* 品牌卡：星标 + 名字 + 版本。版本取不到就只显示品牌名。 */}
      <section className="settings-card about-brand-card">
        <div className="about-brand">
          <StarMark />
          <span className="about-brand-name">Polaris</span>
          {version && (
            <>
              <span className="about-brand-sep" aria-hidden="true">·</span>
              <span className="about-brand-version">{version}</span>
            </>
          )}
        </div>
        <div className="settings-row-desc">{t('settings.licenseLine')}</div>
      </section>

      {/* 更新：检查入口 + 常驻状态槽。已下载时按钮换成「查看更新」重开弹窗。 */}
      <section className="settings-card">
        <SettingsRow title={t('settings.updateGroup')} desc={
          <span className={`settings-update-status${updateErrorDetail ? ' is-error' : ''}`} title={updateStatusTextValue}>
            {updateStatusTextValue}
          </span>
        }>
          {update?.status === 'downloaded' ? (
            <button className="update-action ready" onClick={openUpdateDialog}>
              {t('settings.viewUpdate')}
            </button>
          ) : (
            <button
              className="update-action"
              onClick={() => void handleCheckUpdate()}
              disabled={
                updateChecking ||
                update?.status === 'checking' ||
                update?.status === 'downloading'
              }
            >
              {t('settings.checkUpdate')}
            </button>
          )}
        </SettingsRow>
      </section>

      {/* 致谢与声明：字体 / 图标随安装包的许可见声明目录（harness 门控在主进程）。 */}
      <section className="settings-card">
        <div className="about-credits">
          <div className="about-credit-row">
            <span className="about-credit-label">{t('settings.fonts')}</span>
            <span className="about-credit-value">{t('settings.fontsValue')}</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-label">{t('settings.icons')}</span>
            <span className="about-credit-value">{t('settings.iconsValue')}</span>
          </div>
          <div className="about-credit-note">
            {t('settings.creditsNote')}
            {/* 声明路径语言中立（同字体名先例），mono 呈现不再逐语言进词典。 */}
            <span className="about-credit-paths">resources/NOTICE · resources/licenses/</span>
          </div>
        </div>
        <div className="settings-card-actions">
          <button className="backup-btn backup-btn--small" onClick={() => void openNoticesDir()}>
            {t('settings.aboutOpenNotices')}
          </button>
        </div>
        {noticesError && (
          <div className="settings-error" role="alert">{noticesError}</div>
        )}
      </section>
    </>
  )
}
