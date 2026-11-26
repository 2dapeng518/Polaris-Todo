// 项目色工具：#RRGGBB → rgba() 字符串。项目 color 经 ipc zod 校验恒为
// 6 位十六进制；非法输入回落主题信号色（--accent-rgb），六主题对比度
// 守卫（verify:themes）因此不受影响。渲染层与组件共用。
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return `rgba(var(--accent-rgb), ${alpha})`
  const value = Number.parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}
