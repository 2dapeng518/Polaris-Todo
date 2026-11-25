import { parseKeys } from '@shared/shortcuts'

/** 键盘事件是否命中某个键串（'Ctrl+K' / 'N' / '1'）。修饰键精确比对，主键大小写
 *  不敏感。单键快捷键（N、1）因此要求无 Ctrl/Alt/Win/Shift——不会劫持 Ctrl+N 之类
 *  的系统 / 浏览器组合。输入态的拦截由各调用方自己负责（这里只判按键）。 */
export function eventMatchesKeys(event: KeyboardEvent, keys: string): boolean {
  const parts = parseKeys(keys)
  if (parts.length === 0) return false
  const main = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (event.ctrlKey !== mods.includes('Ctrl')) return false
  if (event.altKey !== mods.includes('Alt')) return false
  if (event.metaKey !== mods.includes('Super')) return false
  if (event.shiftKey !== mods.includes('Shift')) return false
  return event.key.toLowerCase() === main.toLowerCase()
}

/** e.code → 录制用键名：字母 KeyX、数字 DigitN、F1–F24；其余（标点 / 小键盘 /
 *  Enter / 修饰键自身）返回 null——保持「显示什么就注册什么」一套字符串。 */
export function keyNameFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return null
}
