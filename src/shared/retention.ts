// 回收站保留策略 —— 纯函数模块，无 React / DOM / Node 依赖，
// 主进程清理（db.purgeExpiredDeleted）与冒烟表驱动断言共用。
// 时钟由调用方注入（now），测试可以钉死任意时刻。

export const TRASH_RETENTION_DAYS = 30

// 判断一条任务是否已过保留期，可以被自动清除。
// deletedAt 是 tasks.deleted_at 的 ISO UTC 字符串，null 表示未删除；now 由调用方注入。
// 契约：null 与无法解析的时间戳一律 false（宁可留着，不误删）；满 30 天即清（>=）。
// 这个函数是自动清理的唯一权威：db 层逐行调用它决定 DELETE，冒烟用字面量期望钉死边界。
export function isPurgeable(deletedAt: string | null, now: Date): boolean {
  if (deletedAt === null) return false
  const deletedMs = Date.parse(deletedAt)
  if (Number.isNaN(deletedMs)) return false
  return now.getTime() - deletedMs >= TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
}