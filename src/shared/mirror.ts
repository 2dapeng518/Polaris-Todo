// 真值表在 scripts/verify-pure.mjs 与
// src/main/harness/assertions.ts 双份维护，改一处必须同步另一处。
//
// 语义：开启 + 有活 + 文件夹非空 + 距上次尝试满最小间隔才写。
// 时钟回拨、非法间隔、非法时间戳一律放行——宁可多写一份镜像，
// 也不让一次系统改时间或坏参数把镜像永久冻住。
export type MirrorGateInput = {
  enabled: boolean
  /** 镜像目标文件夹；空串/纯空白视为未选择。 */
  folder: string | null
  /** 上次成功写入之后是否又有新的写修订变化。 */
  dirty: boolean
  /** 上次实际尝试写入的本地毫秒时刻；从未尝试为 null。 */
  lastAttemptAt: number | null
  /** 当前本地毫秒时刻。 */
  now: number
  /** 两次尝试之间的最小间隔（生产值 30s，测试注入小值）。 */
  minGapMs: number
}

export function shouldMirror(input: MirrorGateInput): boolean {
  const { enabled, folder, dirty, lastAttemptAt, now, minGapMs } = input

  if (!enabled || !dirty) return false
  if (!folder || folder.trim().length === 0) return false

  // 坏时间戳/坏参数不构成阻塞理由：放行一次写入，随后由成功路径自愈。
  if (lastAttemptAt !== null && !Number.isFinite(lastAttemptAt)) return true
  if (!Number.isFinite(now) || !Number.isFinite(minGapMs)) return true
  if (lastAttemptAt === null) return true

  // now < lastAttemptAt 是时钟回拨；差值为负永远不满足间隔，必须显式放行，
  // 否则一次系统改时间就会把镜像永久冻住（与 shouldAutoCheck 同一取舍）。
  if (now < lastAttemptAt) return true
  return now - lastAttemptAt >= minGapMs
}