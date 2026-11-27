import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { McpState } from '@shared/types'
import {
  MCP_CLIENT_TEMPLATES,
  maskMcpTokenForDisplay,
  type McpClientId,
  type McpClientTemplate
} from '@shared/mcpClients'
import { ConfirmDialog } from '../ConfirmDialog'
import { useT } from '../../stores/useLocaleStore'
import { SettingsRow, Switch } from './SettingsRow'

/** 自适应短掩码：前缀照露 + 头 k 位 hex + … + 尾 k 位 hex，k 随盒宽填满整盒
    （用户 16:2x「填充满」），clamp [4,32]——窄盒保底头 4 尾 4（用户 15:33）。
    无前缀旧 token 头尾各 k 位整串字符。中段永不上屏，复制/重置仍走整串明文 IPC。 */
function maskToken(token: string, k: number): string {
  const prefixLen = token.startsWith('sk-') ? 3 : 0
  return `${token.slice(0, prefixLen + k)}…${token.slice(-k)}`
}

// 配置块固定短掩码（用户 2026-11-27 拍板）：sk- + 头 4 + 5 个星号 + 尾 4。
// 屏幕不露完整令牌，复制路径另行使用完整 mcpToken。令牌盒仍走自适应长掩码
// （此前「填满盒子」的要求）——盒子用于识别，配置块用于粘贴前预览，两者
// 用途不同，不强行统一。
function configForDisplay(client: McpClientTemplate, endpoint: string, token: string): string {
  return client.build(endpoint, maskMcpTokenForDisplay(token))
}

// 「本地 MCP 服务」：开关 + 访问令牌。令牌仅启用时展示（自适应短掩码），
// 复制/重新生成走主进程 IPC，渲染层不落任何持久化。
export function McpSection() {
  const t = useT()
  const [mcp, setMcp] = useState<McpState>({
    enabled: false,
    running: false,
    endpoint: 'http://127.0.0.1:3737/mcp'
  })
  const tokenBoxRef = useRef<HTMLElement>(null)
  // 掩码头尾 hex 位数：随盒宽自适应填满整盒，保底 4（头 4 尾 4）。
  const [maskK, setMaskK] = useState(4)
  // 露出位数的上限。旧面板的盒子只有约 210px，自适应到这里就到头（k≈12，
  // 64 位里藏 40 位）；设置窗口是整页宽，不封顶会一路涨到 k=32——头尾各露
  // 32 位，中间只剩 3 位没上屏，掩码等于没有。盒宽因此也按 k=12 的内容收窄。
  const MASK_K_MAX = 12
  const [mcpToken, setMcpToken] = useState<string | null>(null)
  const [mcpTokenNotice, setMcpTokenNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [mcpTokenBusy, setMcpTokenBusy] = useState(false)
  const [mcpRegenConfirm, setMcpRegenConfirm] = useState(false)
  const mcpNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 客户端配置卡：默认 Claude Code；复制反馈与令牌行分开计时，互不打断。
  const [mcpClient, setMcpClient] = useState<McpClientId>(MCP_CLIENT_TEMPLATES[0].id)
  const [mcpConfigNotice, setMcpConfigNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const mcpConfigNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeClient =
    MCP_CLIENT_TEMPLATES.find((client) => client.id === mcpClient) ?? MCP_CLIENT_TEMPLATES[0]

  useLayoutEffect(() => {
    let cancelled = false

    window.polaris.app
      .getMcp()
      .then(async (value) => {
        if (cancelled) return
        setMcp(value)
        if (value.enabled) {
          const token = await window.polaris.app.getMcpToken()
          if (!cancelled) setMcpToken(token)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMcp((current) => ({ ...current, error: String(error) }))
        }
      })

    return () => {
      cancelled = true
      // 离开本页时收起提示并清定时器：下次进来是干净态。
      if (mcpNoticeTimer.current) {
        clearTimeout(mcpNoticeTimer.current)
        mcpNoticeTimer.current = null
      }
      if (mcpConfigNoticeTimer.current) {
        clearTimeout(mcpConfigNoticeTimer.current)
        mcpConfigNoticeTimer.current = null
      }
    }
  }, [])

  // 掩码头尾长度随盒宽自适应：等宽 advance = 0.6em，头尾各 k hex + 省略号
  // 填满整盒（≥80% 内宽）；k clamp [4,32]。
  useLayoutEffect(() => {
    if (!mcp.enabled || !mcpToken) return
    const box = tokenBoxRef.current
    if (!box) return
    const measure = () => {
      const style = getComputedStyle(box)
      const inner =
        box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const charWidth = parseFloat(style.fontSize) * 0.6
      const k = Math.max(4, Math.min(MASK_K_MAX, Math.floor((inner / charWidth - 4) / 2)))
      setMaskK(k)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [mcp.enabled, mcpToken])

  const toggleMcp = async () => {
    const next = !mcp.enabled
    setMcp((current) => ({ ...current, enabled: next, error: undefined }))
    try {
      setMcp(await window.polaris.app.setMcp(next))
      if (next) {
        // 首次启用主进程已生成 token，这里直接取回展示。
        setMcpToken(await window.polaris.app.getMcpToken())
      } else {
        setMcpToken(null)
        setMcpTokenNotice(null)
        setMcpConfigNotice(null)
      }
    } catch {
      setMcp((current) => ({ ...current, enabled: !next }))
    }
  }

  // 复制/重新生成的短暂反馈：沿用备份区 settings-hint 的静默状态行模式。
  const flashMcpNotice = (text: string, error = false) => {
    if (mcpNoticeTimer.current) clearTimeout(mcpNoticeTimer.current)
    setMcpTokenNotice({ text, error })
    mcpNoticeTimer.current = setTimeout(() => setMcpTokenNotice(null), 2600)
  }

  const copyMcpToken = async () => {
    if (!mcpToken) return
    try {
      await navigator.clipboard.writeText(mcpToken)
      flashMcpNotice(t('settings.mcpTokenCopied'))
    } catch {
      flashMcpNotice(t('settings.mcpTokenCopyFailed'), true)
    }
  }

  // 客户端配置卡自己的反馈槽：复用令牌行的静默状态行模式，但独立计时。
  const flashMcpConfigNotice = (text: string, error = false) => {
    if (mcpConfigNoticeTimer.current) clearTimeout(mcpConfigNoticeTimer.current)
    setMcpConfigNotice({ text, error })
    mcpConfigNoticeTimer.current = setTimeout(() => setMcpConfigNotice(null), 2600)
  }

  // 复制的是完整令牌：屏幕上的掩码只用于展示，剪贴板永远落明文。
  const copyMcpConfig = async () => {
    if (!mcpToken) return
    try {
      await navigator.clipboard.writeText(activeClient.build(mcp.endpoint, mcpToken))
      flashMcpConfigNotice(t('settings.mcpConfigCopied'))
    } catch {
      flashMcpConfigNotice(t('settings.mcpTokenCopyFailed'), true)
    }
  }

  const regenerateMcpToken = async () => {
    setMcpRegenConfirm(false)
    setMcpTokenBusy(true)
    try {
      setMcpToken(await window.polaris.app.regenerateMcpToken())
      flashMcpNotice(t('settings.mcpTokenRegenerated'))
    } catch (error) {
      flashMcpNotice(String(error), true)
    } finally {
      setMcpTokenBusy(false)
    }
  }

  // 描述：启动失败替换端点落同一行（alert 换色 + title 全文），条件错误行零增高。
  const mcpFailed = mcp.enabled && Boolean(mcp.error)
  const mcpDesc = mcpFailed
    ? t('settings.mcpError', { error: mcp.error ?? '' })
    : mcp.enabled
      ? mcp.endpoint
      : t('settings.mcpOff')

  // 掩码串同时供令牌盒与配置块展示；复制路径另行使用完整的 mcpToken。
  const maskedToken = mcpToken ? maskToken(mcpToken, maskK) : ''
  const displayConfig = mcpToken
    ? configForDisplay(activeClient, mcp.endpoint, mcpToken)
    : ''

  return (
    <>
      <section className="settings-card">
        {/* 先讲清楚这服务能做什么、边界在哪：下面才有「启不启用」这个决定。 */}
        <p className="mcp-intro">{t('settings.mcpIntro')}</p>
        <SettingsRow title={t('settings.mcpEnable')} desc={mcpDesc} alert={mcpFailed}>
          <Switch checked={mcp.enabled} label={t('settings.mcp')} onToggle={() => void toggleMcp()} />
        </SettingsRow>

        {/* 令牌块（仅启用时渲染）：一行三段——按内容收窄的掩码盒 / 常驻反馈槽
            （默认落用法说明，提示来了替换 2.6s 再还原，吃掉中间余宽）/
            右对齐的复制与重置。整行两端对齐，中间没有死白。 */}
        {mcp.enabled && mcpToken && (
          <div className="mcp-token">
            <div className="mcp-token-row">
              <code
                className="mcp-token-box"
                ref={tokenBoxRef}
                aria-label={t('settings.mcpToken')}
                title={t('settings.mcpTokenDescFull')}
              >
                {maskedToken}
              </code>
              <div
                className={`mcp-token-slot ${mcpTokenNotice?.error ? 'settings-error' : 'settings-hint'}`}
                role={mcpTokenNotice?.error ? 'alert' : 'status'}
                title={mcpTokenNotice?.text ?? t('settings.mcpTokenDesc')}
              >
                {mcpTokenNotice?.text ?? t('settings.mcpTokenDesc')}
              </div>
              <div className="mcp-token-actions">
                <button className="backup-btn" onClick={() => void copyMcpToken()}>
                  {t('settings.mcpTokenCopy')}
                </button>
                <button
                  className="backup-btn backup-btn--danger"
                  onClick={() => setMcpRegenConfirm(true)}
                  disabled={mcpTokenBusy}
                >
                  {t('settings.mcpTokenRegenerate')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 客户端配置卡：只在服务启用且令牌已取回时出现。一段配置 + 一键复制，
          把「知道 MCP 配置格式」这道门槛从用户身上拿走；令牌屏幕上仍是掩码，
          复制时才写完整值（与令牌盒同一契约）。 */}
      {mcp.enabled && mcpToken && (
        <section className="settings-card mcp-config-card">
          <div className="mcp-config-head">
            <div className="mcp-config-head-text">
              <div className="settings-row-title">{t('settings.mcpClients')}</div>
              <div className="settings-row-desc">{t('settings.mcpClientsDesc')}</div>
            </div>
            <button
              className="backup-btn backup-btn--small mcp-config-copy"
              onClick={() => void copyMcpConfig()}
            >
              {t('settings.mcpConfigCopy')}
            </button>
          </div>
          <div className="mcp-client-tabs" role="tablist" aria-label={t('settings.mcpClients')}>
            {MCP_CLIENT_TEMPLATES.map((client) => {
              const active = client.id === activeClient.id
              return (
                <button
                  key={client.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`mcp-client-tab ${active ? 'is-active' : ''}`}
                  onClick={() => setMcpClient(client.id)}
                >
                  {t(client.labelKey)}
                </button>
              )
            })}
          </div>
          <div className="mcp-config-path">{t(activeClient.pathKey)}</div>
          <pre className="mcp-config-code">{displayConfig}</pre>
          <div
            className={mcpConfigNotice?.error ? 'settings-error' : 'settings-hint'}
            role={mcpConfigNotice?.error ? 'alert' : 'status'}
          >
            {mcpConfigNotice?.text ?? t('settings.mcpConfigMasked')}
          </div>
        </section>
      )}

      {/* 重新生成令牌的二次确认：旧客户端配置立即失效，属破坏性动作。 */}
      <AnimatePresence>
        {mcpRegenConfirm && (
          <ConfirmDialog
            message={t('settings.mcpTokenRegenConfirm')}
            confirmLabel={t('settings.mcpTokenRegenerate')}
            onConfirm={() => void regenerateMcpToken()}
            onClose={() => setMcpRegenConfirm(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
