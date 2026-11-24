import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import DOMPurify from 'dompurify'
import { Check } from './Icon'
import { useTaskStore } from '../stores/useTaskStore'
import { useUpdateStore } from '../stores/useUpdateStore'
import { useT, useLocale } from '../stores/useLocaleStore'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useOverlayClose } from '../lib/useOverlayClose'
import { estimateEtaSeconds, formatBytes, formatEta, formatSpeed } from '@shared/update'

// 软件更新弹窗：发现新版本 → 下载进度 → 下载完成三态一体，
// 底部「跳过此版本 / 稍后 / 立即重启」。快照全部来自主进程推送，
// 这里只做展示与三个动作，不持有第二份进度。
export function UpdateDialog() {
  const t = useT()
  const locale = useLocale()
  const open = useUpdateStore((state) => state.dialogOpen)
  const update = useUpdateStore((state) => state.state)
  const dismissDialog = useUpdateStore((state) => state.dismissDialog)
  const skip = useUpdateStore((state) => state.skip)
  const install = useUpdateStore((state) => state.install)
  const paletteOpen = useTaskStore((state) => state.paletteOpen)
  const panelRef = useRef<HTMLDivElement>(null)
  const laterRef = useRef<HTMLButtonElement>(null)

  // 默认焦点落「稍后」：Enter 不会直接把应用重启掉。
  useFocusTrap(panelRef, open && !paletteOpen, laterRef)
  // 设置窗口的 Esc 兜底栈：焦点漏在弹窗外时，窗口级 Esc 只收起本弹窗（= 稍后）。
  useOverlayClose(open && !paletteOpen, dismissDialog)

  useEffect(() => {
    if (open && paletteOpen) dismissDialog()
  }, [open, paletteOpen, dismissDialog])

  const status = update?.status
  const downloaded = status === 'downloaded'
  const downloading = status === 'downloading' || status === 'available'
  const percent = update?.percent ?? 0
  // 字节行只在主进程给出 total 时出现；缺字段降级为百分比，
  // 绝不让 undefined 参与除法（ETA 会变 NaN/Infinity）。
  const transferred = update?.transferred ?? null
  const total = update?.total ?? null
  const bytesDone = formatBytes(transferred)
  const bytesTotal = formatBytes(total)
  const speed = formatSpeed(update?.bytesPerSecond ?? null)
  const eta = formatEta(estimateEtaSeconds(total, transferred, update?.bytesPerSecond ?? null), locale)
  // 下载满 100% 后主进程还要校验安装包 sha512（大包秒级）：这段间隙在占位槽里
  // 落「校验安装包」文案，不让界面停在 100% 无字装死。
  const verifying =
    status === 'downloading' &&
    (percent >= 100 || (transferred !== null && total !== null && transferred >= total))
  // 重启反馈必须先于进程退出被看见：点击先换文案，400ms 后才通知主进程 quit，
  // 否则点击瞬间窗口消失，用户以为没响应。守卫报错或状态离开 downloaded 即重置。
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    if (update?.error || status !== 'downloaded') setInstalling(false)
  }, [update?.error, status])
  const handleInstall = () => {
    setInstalling(true)
    setTimeout(() => void install(), 400)
  }

  return (
    <AnimatePresence>
      {open && update && update.latestVersion && (
        <motion.div
          className="confirm-overlay update-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={dismissDialog}
        >
          <motion.div
            className="confirm-panel update-panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('dialog.update')}
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              dismissDialog()
            }}
          >
            <div className="update-title">{t('dialog.update')}</div>
            <div className="update-subtitle">{t('dialog.updateAvailable')}</div>

            <div className="update-versions">
              <span className="update-version-old">{update.currentVersion}</span>
              <span className="update-version-arrow" aria-hidden="true">→</span>
              <span className="update-version-new">{update.latestVersion}</span>
            </div>

            {update.releaseNotes && (
              <div className="update-notes">
                <div className="update-notes-label">{t('dialog.notes')}</div>
                {/<[a-z][^>]*>/i.test(update.releaseNotes) ? (
                  // GitHub 渠道的说明来自 releases.atom 的 <content>，是渲染后的
                  // HTML（h2/ul/li…）。DOMPurify 消毒后按富文本展示，标签不再露出。
                  <div
                    className="update-notes-body rich"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(update.releaseNotes, {
                        USE_PROFILES: { html: true }
                      })
                    }}
                  />
                ) : (
                  <div className="update-notes-body plain">{update.releaseNotes}</div>
                )}
              </div>
            )}

            {downloading && (
              <div
                className="update-progress"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('dialog.progress')}
              >
                <div className="update-progress-head">
                  <span className="update-progress-label">{t('dialog.downloadingLabel')}</span>
                  <span className="update-progress-bytes">
                    {bytesDone && bytesTotal
                      ? t('dialog.bytes', { done: bytesDone, total: bytesTotal })
                      : `${percent}%`}
                  </span>
                </div>
                <div className="update-progress-track">
                  <div className="update-progress-fill" style={{ width: `${percent}%` }} />
                </div>
                {/* 速度/ETA 行常驻占位：速度 EMA 归零/恢复不再挂载卸载整行，
                    居中浮层高度恒定零抖动；空值落空串，槽高由 CSS 保住。 */}
                <div className="update-progress-meta">
                  {verifying ? (
                    <span className="update-progress-speed">{t('dialog.verifying')}</span>
                  ) : (
                    <>
                      <span className="update-progress-speed">{speed ?? ''}</span>
                      <span className="update-progress-eta">{eta ? t('dialog.eta', { time: eta }) : ''}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {downloaded && (
              <div className="update-ready" role="status">
                <Check size={15} strokeWidth={2} aria-hidden="true" />
                {installing ? t('dialog.installing') : t('dialog.ready')}
              </div>
            )}

            {update.error && (
              <div className="settings-error" role="alert">{update.error}</div>
            )}

            <div className="update-actions">
              <button className="update-skip" onClick={() => void skip()}>
                {t('dialog.skip')}
              </button>
              <span className="update-actions-spacer" />
              <button ref={laterRef} className="detail-popover-action" onClick={dismissDialog}>
                {t('dialog.later')}
              </button>
              <button
                className="detail-popover-action detail-action-primary update-install"
                onClick={handleInstall}
                disabled={!downloaded || installing}
              >
                {installing ? t('dialog.restarting') : t('dialog.restart')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}