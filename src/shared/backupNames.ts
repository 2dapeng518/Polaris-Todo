// 自动备份文件名：前缀 + ISO 时间戳（冒号/点换成连字符，Windows 合法）+ .json。
// 主进程写备份、设置页列备份、按名导入/另存共用同一份判定——文件名就是这里的
// 唯一入口校验：正则整体锚定，任何路径分隔符或 `..` 都不可能通过，join 之前
// 就已拒绝，渲染层拿不到 userData/backups 之外的文件。
export const AUTO_BACKUP_PREFIX = 'polaris-auto-'

// 合法名：前缀 + ISO 时间戳（冒号与毫秒点替换为连字符）+ .json。
const AUTO_BACKUP_NAME_PATTERN =
  /^polaris-auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/

export function isAutoBackupFileName(name: string): boolean {
  // 正则已排除分隔符与 `..`；显式再挡一道，读代码的人不必推正则。
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return AUTO_BACKUP_NAME_PATTERN.test(name)
}