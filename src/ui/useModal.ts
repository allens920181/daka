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
/** 目前開著幾層模態。面板之上可以再疊確認對話框，所以不能用布林。 */
let openModals = 0

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

    // 背後的內容要退出無障礙樹與 Tab 順序。只做視覺遮罩不夠：
    // 螢幕閱讀器仍讀得到底下的按鈕，使用者會聽到一個他碰不到的「分享」。
    //
    // 唯一的例外是 Toast。它在 z 軸上高於模態層，可能是誤觸後唯一的復原
    // 機會（設計規範 §3.7）；而且 inert 會把它移出無障礙樹，連 aria-live
    // 的播報都會被吃掉。
    const inerted: HTMLElement[] = []
    const root = layer.current?.parentElement?.parentElement
    const overlay = layer.current?.parentElement
    if (root && overlay) {
      for (const child of Array.from(root.children)) {
        if (child === overlay || !(child instanceof HTMLElement)) continue
        if (child.classList.contains('toast-wrap')) continue
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

    // Toast 固定在畫面下緣 88px（讓開底部動作列），但面板是從下緣長上來的，
    // 於是 Toast 正好落在選單中間——實測它蓋住「結束這一輪」49px，而且
    // .toast 是 pointer-events: auto，那五秒內那一列按不下去。
    // 標記模態層開啟，讓 CSS 把 Toast 移到上緣的遮罩區。用計數器是因為面板
    // 之上還會疊確認對話框，關掉對話框時面板還開著。
    openModals += 1
    document.documentElement.dataset.modal = 'open'

    return () => {
      document.removeEventListener('keydown', onKey)
      openModals -= 1
      if (openModals <= 0) {
        openModals = 0
        delete document.documentElement.dataset.modal
      }
      document.body.style.overflow = prevOverflow
      for (const el of inerted) el.removeAttribute('inert')
      restoreTo?.focus?.()
    }
  }, [layer, onClose, initialFocus])
}
