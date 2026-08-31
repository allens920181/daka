import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { IconClose } from './icons'
import { useT } from './t'

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * 底部面板。鍵盤可完整操作：Esc 關閉、Tab 在面板內循環、
 * 關閉後焦點回到原本的元素。
 */
export function Sheet({
  title, onClose, children,
}: {
  title: string
  onClose: () => void
  children: ComponentChildren
}) {
  const panel = useRef<HTMLDivElement>(null)

  const backdrop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    // 面板開啟時，背後的內容要退出無障礙樹與 Tab 順序。
    // 只做視覺遮罩不夠：螢幕閱讀器仍讀得到底下的按鈕，
    // 使用者會聽到一個他碰不到的「分享」。
    const inerted: HTMLElement[] = []
    const root = backdrop.current?.parentElement
    if (root) {
      for (const child of Array.from(root.children)) {
        if (child === backdrop.current || !(child instanceof HTMLElement)) continue
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
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const firstEl = items[0] as HTMLElement
      const lastEl = items[items.length - 1] as HTMLElement
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
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
  }, [onClose])

  const t = useT()

  return (
    <div
      class="sheet-backdrop"
      ref={backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div class="sheet" ref={panel} role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet-grip" />
        <div class="sheet-head">
          <h2 class="sheet-title">{title}</h2>
          <div class="spacer" />
          <button class="icon-btn" onClick={onClose} aria-label={t('close')}>
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
