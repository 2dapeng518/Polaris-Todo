import { useEffect, useRef } from 'react'

// 浮层的窗口级 Esc 兜底栈。对话框（ConfirmDialog / BackupListDialog / UpdateDialog）
// 都在 React 根停掉 Esc 只关自己；焦点万一漏在对话框之外（harness 的程序化聚焦、
// 或尚未落焦的那 30ms），keydown 到不了 React 根——设置窗口的 window 监听据此
// 只关最上层对话框，绝不把整扇设置窗口连对话框一起关掉。主窗口不调用
// closeTopOverlay（它有自己的 Esc 路由），注册在那里是无副作用的。

const stack: Array<() => void> = []

/** 挂在浮层组件里：active 期间把自己登记为「最上层」，卸载/关闭时注销。 */
export function useOverlayClose(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) return
    const entry = () => onCloseRef.current()
    stack.push(entry)
    return () => {
      const index = stack.lastIndexOf(entry)
      if (index >= 0) stack.splice(index, 1)
    }
  }, [active])
}

/** 有浮层就关最上层那一个并返回 true；没有浮层返回 false，由调用方决定下一层动作。 */
export function closeTopOverlay(): boolean {
  const close = stack.pop()
  if (!close) return false
  close()
  return true
}

/** 当前是否有模态浮层（ConfirmDialog / UpdateDialog 等）挂着。全局快捷键
 *  处理器在事件发生时读这个值，把 N / Ctrl+Z / 视图导航 / 全局热键让给模态——
 *  它们不一定在任务 store 的 trashConfirm 里（项目删除确认就是组件局部状态）。 */
export function hasOpenOverlay(): boolean {
  return stack.length > 0
}
