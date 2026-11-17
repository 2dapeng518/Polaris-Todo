import type { Locale } from './i18n'

/**
 * 在线更新的纯逻辑：不碰 Electron / 网络，主进程与校验脚本共用。
 * 版本大小比较交给 electron-updater（semver），这里只管三件小事：
 * 「跳过此版本」的安静规则、Release 正文的归一化，以及下载进度的
 * 字节/速度/剩余时间格式化（主进程与 harness 断言共用同一套期望值）。
 */

/** electron-updater 的 releaseNotes 可能是 string、{version,note}[] 或 null。
 *  统一成一段纯文本；空白视为没有说明。 */
export function normalizeReleaseNotes(notes: unknown): string | null {
  if (typeof notes === 'string') {
    const trimmed = notes.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(notes)) {
    const parts = notes
      .map((item) => {
        if (item && typeof item === 'object' && 'note' in item) {
          const note = (item as { note?: unknown }).note
          return typeof note === 'string' ? note.trim() : ''
        }
        return ''
      })
      .filter((part) => part.length > 0)
    return parts.length > 0 ? parts.join('\n\n') : null
  }
  return null
}

/** 自动检查发现新版本时是否该打扰用户：
 *  被跳过的版本保持安静；手动检查（manual）永远给答案。 */
export function shouldSurfaceUpdate(
  latestVersion: string,
  skippedVersion: string | null,
  manual: boolean
): boolean {
  if (manual) return true
  return latestVersion !== skippedVersion
}

/* ---------- 下载进度展示 ---------- */

const KB = 1024
const MB = KB * 1024

/** 指数滑动平均的默认权重：新样本占 30%，抑制 electron-updater
 *  逐事件抖动带来的 ETA 乱跳；换窗口/重启下载时把 previous 置 null。 */
export const SPEED_SMOOTHING_ALPHA = 0.3

/** 平滑瞬时速度。previous 为 null（新下载或首帧）时直接采纳有效样本；
 *  首个样本是 0 或非有限值则返回 null，宁可不显示也不报 0 速度。
 *  sample=0 在已有速度时是有效信号（网络卡住），按权重参与平滑。 */
export function smoothSpeed(
  previous: number | null,
  sample: number,
  alpha: number = SPEED_SMOOTHING_ALPHA
): number | null {
  if (!Number.isFinite(sample) || sample < 0) return previous
  if (previous === null || !Number.isFinite(previous)) return sample > 0 ? sample : null
  const next = previous + alpha * (sample - previous)
  return next > 0 ? next : previous
}

/** 字节数：≥1 MB 保留一位小数（「18.1 MB」），不足 1 MB 用整数 KB。
 *  非法值返回 null，调用方据此隐藏字节行。 */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  return `${Math.round(bytes / KB)} KB`
}

/** 速度：与字节数同口径，后缀 /s；非法值返回 null。 */
export function formatSpeed(bytesPerSecond: number | null): string | null {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return null
  if (bytesPerSecond >= MB) return `${(bytesPerSecond / MB).toFixed(1)} MB/s`
  return `${Math.round(bytesPerSecond / KB)} KB/s`
}

/** 剩余时间（秒）= 剩余字节 / 速度，四舍五入到秒。
 *  total 未知、速度 ≤ 0、字段缺失或非有限值一律返回 null——绝不产出
 *  Infinity / NaN 让 UI 去兜底。剩余 0 字节返回 0（已完成，不是未知）。 */
export function estimateEtaSeconds(
  total: number | null,
  transferred: number | null,
  bytesPerSecond: number | null
): number | null {
  if (total === null || transferred === null || bytesPerSecond === null) return null
  if (!Number.isFinite(total) || !Number.isFinite(transferred) || !Number.isFinite(bytesPerSecond)) {
    return null
  }
  if (total <= 0 || bytesPerSecond <= 0) return null
  const remaining = Math.max(0, total - transferred)
  return Math.round(remaining / bytesPerSecond)
}

/** ETA 文案：不足 60 秒说秒，之后按分钟/小时粗化（「约 2 分钟」/「~2 min」）。
 *  秒数先钳到 1，避免 0.4 秒显示成「0 秒」；非法值返回 null 表示不显示该段。 */
export function formatEta(seconds: number | null, locale: Locale = 'zh-CN'): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null
  const zh = locale === 'zh-CN'
  const whole = Math.max(1, Math.round(seconds))
  if (whole < 60) return zh ? `${whole} 秒` : `${whole}s`
  const minutes = Math.round(whole / 60)
  if (minutes < 60) return zh ? `约 ${minutes} 分钟` : `~${minutes} min`
  const hours = Math.round(minutes / 60)
  return zh ? `约 ${hours} 小时` : `~${hours} hr`
}
