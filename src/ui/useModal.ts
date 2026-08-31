import type { RefObject } from 'preact'
import { useEffect } from 'preact/hooks'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * 所有模態層（面板、確認對話框）共用的焦點與背景處理。
 *
 * 四件事缺一不可：
 * 1. 開啟時把焦點移進去，關閉時還給觸發的元素
 * 2. Tab 在層內循環，不會跑到背景
 * 3. Esc 關閉
 * 4. 背景加 inert —— 只做視覺遮罩不夠，螢幕閱讀器仍讀得到底下的按鈕
 */
export function useModal(
  layer: RefObject<HTMLElement>,
  onClose: () => void,
  options: { initialFocus?: 'first' | 'last' } = {},
): void {
  const { initialFocus = 'first' } = options

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    const items = () => [...(layer.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]

    const initial = items()
    if (initial.length > 0) {
      const target = initialFocus === 'last' ? initial[initial.length - 1] : initial[0]
      target?.focus()
    }

    const inerted: HTMLElement[] = []
    const root = layer.current?.parentElement?.parentElement
    const overlay = layer.current?.parentElement
    if (root && overlay) {
      for (const child of Array.from(root.children)) {
        if (child === overlay || !(child instanceof HTMLElement)) continue
        if (child.hasAttribute('inert')) continue
        child.setAttribute('inert', '')
        inerted.push(child)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const list = items()
      if (list.length === 0) return
      const first = list[0] as HTMLElement
      const last = list[list.length - 1] as HTMLElement
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      for (const el of inerted) el.removeAttribute('inert')
      restoreTo?.focus?.()
    }
  }, [layer, onClose, initialFocus])
}
