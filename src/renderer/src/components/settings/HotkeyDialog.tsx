import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { motion } from 'motion/react'
import type { GlobalHotkeyState, HotkeyProbe } from '@shared/types'
import { useFocusTrap } from '../../lib/useFocusTrap'
import { useOverlayClose } from '../../lib/useOverlayClose'
import { useT } from '../../stores/useLocaleStore'

// 候选组合池（推荐组合）：固定一组常用组合，打开对话框时经主进程实时探测
// 空闲状态——空闲的可点选用，已占用的置灰标注。当前组合也在池里带「当前」
// 标记，一眼看得到自己正用着哪个。
const CANDIDATES = ['Ctrl+Alt+P', 'Ctrl+Alt+T', 'Ctrl+Alt+N', 'Ctrl+Shift+P', 'Alt+Shift+P']

/** e.code → 录制用键名：字母 KeyX、数字 DigitN、F1–F24；其余（标点 / 小键盘 /
 *  Enter 等）不收——保持「显示什么就注册什么」一套字符串，不录出对不上的组合。 */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return null
}

type HotkeyDialogProps = {
  /** 打开对话框时的当前组合（用于「当前」标记与 no-op 判断）。 */
  accelerator: string
  /** 应用结果回传（成功与失败都带最新状态，常规页行描述跟着刷新）。 */
  onApplied: (next: GlobalHotkeyState) => void
  onClose: () => void
}

// 快捷键自定义对话框（常规页「修改快捷键…」）。复用 confirm-overlay/panel
// 浮层语言（备份管理同范式）：自带焦点陷阱、Esc 在 React 根停传播只关自己、
// 点遮罩关闭、窗口级 Esc 走 useOverlayClose 兜底栈。录入靠面板上的 keydown
// 冒泡（焦点陷阱保证焦点在面板内）；保存经主进程换绑——开启态注册失败会
// 回滚旧组合，错误落反馈行，对话框保持打开让用户换一个再试。
export function HotkeyDialog({ accelerator, onApplied, onClose }: HotkeyDialogProps) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const recordRef = useRef<HTMLDivElement>(null)
  const [recording, setRecording] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [probes, setProbes] = useState<HotkeyProbe[] | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 默认焦点落录制框：按键直接开始录入。
  useFocusTrap(panelRef, true, recordRef)
  // 设置窗口的 Esc 兜底栈：焦点漏在对话框外时，窗口级 Esc 只关掉本对话框。
  useOverlayClose(true, onClose)

  // 打开即探测候选组合的实时占用（主进程试注册即注销，不留痕迹）；失败静默
  // （推荐区缺席不影响录入路径）。
  useEffect(() => {
    let cancelled = false
    window.polaris.app
      .probeGlobalHotkeys(CANDIDATES)
      .then((result) => {
        if (!cancelled) setProbes(result)
      })
      .catch(() => {
        if (!cancelled) setProbes([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    // 纯 Esc：关闭对话框（停传播，不再触发设置窗口的 Esc 兜底）。
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    const key = keyFromCode(event.code)
    // 纯修饰键（还没按主键）与其他不收的键：继续等主键。
    if (!key) return
    event.preventDefault()
    event.stopPropagation()
    // 纯 Shift+键是打字组合，不做全局热键；缺强修饰键给一行提示。
    if (!event.ctrlKey && !event.altKey && !event.metaKey) {
      setRecording(null)
      setRecordError(t('settings.hotkeyNeedModifier'))
      return
    }
    const modifiers: string[] = []
    if (event.ctrlKey) modifiers.push('Ctrl')
    if (event.altKey) modifiers.push('Alt')
    if (event.shiftKey) modifiers.push('Shift')
    if (event.metaKey) modifiers.push('Super')
    setRecording([...modifiers, key].join('+'))
    setRecordError(null)
  }

  const save = async () => {
    if (!recording || busy) return
    setBusy(true)
    setApplyError(null)
    try {
      const next = await window.polaris.app.setGlobalHotkeyAccelerator(recording)
      onApplied(next)
      if (next.error) {
        // 换绑失败（新组合也被占）：主进程已回滚，状态同步给页面，错误留反馈行。
        setApplyError(t('settings.hotkeyApplyFailed', { error: next.error }))
        return
      }
      onClose()
    } catch (error) {
      setApplyError(t('settings.hotkeyApplyFailed', { error: String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      className="confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={onClose}
    >
      <motion.div
        className="confirm-panel hotkey-dialog-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.hotkeyDialogTitle')}
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        <div className="hotkey-dialog-title">{t('settings.hotkeyDialogTitle')}</div>

        {/* 录制框：mono 大字显示已录组合；未录制 / 无效时落提示文案。 */}
        <div
          ref={recordRef}
          className={`hotkey-record${recording ? '' : ' is-hint'}${recordError ? ' is-error' : ''}`}
          tabIndex={0}
          aria-label={t('settings.hotkeyRecordHint')}
          title={t('settings.hotkeyRecordHint')}
        >
          {recording ?? recordError ?? t('settings.hotkeyRecordHint')}
        </div>

        {/* 推荐组合：实时探测；空闲可点选用，已占用置灰划线。 */}
        <div className="hotkey-recommend">
          <div className="hotkey-recommend-label">{t('settings.hotkeyRecommend')}</div>
          <div className="hotkey-chips" role="group" aria-label={t('settings.hotkeyRecommend')}>
            {(probes ?? []).map((probe) => {
              const current = probe.accelerator === accelerator
              return (
                <button
                  key={probe.accelerator}
                  type="button"
                  className={`hotkey-chip${probe.free ? '' : ' is-occupied'}${current ? ' is-current' : ''}`}
                  data-hotkey-candidate={probe.accelerator}
                  disabled={!probe.free}
                  title={probe.free ? undefined : t('settings.hotkeyOccupied')}
                  onClick={() => {
                    setRecording(probe.accelerator)
                    setRecordError(null)
                  }}
                >
                  <span className="hotkey-chip-key">{probe.accelerator}</span>
                  {current && <span className="hotkey-chip-tag">{t('settings.hotkeyCurrent')}</span>}
                  {!probe.free && <span className="hotkey-chip-tag">{t('settings.hotkeyOccupied')}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {applyError && <div className="settings-error" role="alert">{applyError}</div>}

        <div className="confirm-actions">
          <button className="detail-popover-action" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="detail-popover-action detail-action-primary"
            onClick={() => void save()}
            disabled={!recording || busy}
          >
            {t('common.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
