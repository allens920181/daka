import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { IconClose } from './icons'
import { useModal } from './useModal'
import { useT } from './t'

/**
 * 底部面板：用於選單與較長的表單。
 * 需要使用者做「是或否」的決定時用 ConfirmDialog，不要用面板。
 */
export function Sheet({
  title, onClose, children,
}: {
  title: string
  onClose: () => void
  children: ComponentChildren
}) {
  const panel = useRef<HTMLDivElement>(null)
  useModal(panel, onClose)
  const t = useT()

  return (
    <div
      class="overlay overlay-bottom"
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

/**
 * 確認對話框：不可逆動作的最後一道關卡。
 *
 * 刻意不用 window.confirm——它無法翻譯（按鈕永遠是瀏覽器語言）、
 * 無法套用設計系統、在 iOS 上樣式也不受控。
 *
 * 初始焦點放在「取消」：破壞性動作不該讓 Enter 直接送出。
 */
export function ConfirmDialog({
  title, body, confirmLabel, danger = false, onConfirm, onClose,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  useModal(panel, onClose)
  const t = useT()

  return (
    <div
      class="overlay overlay-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        class="dialog"
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
      >
        <h2 class="dialog-title" id="dialog-title">{title}</h2>
        <p class="dialog-body" id="dialog-body">{body}</p>
        <div class="dialog-actions">
          <button class="btn btn-block" onClick={onClose}>{t('cancel')}</button>
          <button
            class={danger ? 'btn btn-danger btn-block' : 'btn btn-primary btn-block'}
            onClick={() => { onConfirm(); onClose() }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
