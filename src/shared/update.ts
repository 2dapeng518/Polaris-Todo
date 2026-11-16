/**
 * 在线更新的纯逻辑：不碰 Electron / 网络，主进程与校验脚本共用。
 * 版本大小比较交给 electron-updater（semver），这里只管两件小事：
 * 「跳过此版本」的安静规则，和 Release 正文的归一化。
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