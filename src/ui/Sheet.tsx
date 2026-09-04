import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { IconBack, IconClose } from './icons'
import { useModal } from './useModal'
import { useT } from './t'

/**
 * 底部面板：用於選單與較長的表單。
 * 需要使用者做「是或否」的決定時用 ConfirmDialog，不要用面板。
 */
export function Sheet({
  title, onClose, onBack, hideTitle = false, children,
}: {
  title: string
  onClose: () => void
  /** 只有面板內有多階段時才傳（例如「更多」面板的子畫面）：回上一頁，跟
   *  onClose（離開整個面板）是兩個不同的動作。 */
  onBack?: () => void
  /**
   * 標題只當無障礙名稱用，畫面上不印。用在標題只是複述底下那排分頁的面板
   * ——「更多」兩個字說不出任何一件這裡做得到的事，而分頁鍵已經寫著空間、
   * 名單、分享。`aria-label` 仍然是 title，螢幕閱讀器聽得到的沒有變少。
   */
  hideTitle?: boolean
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
          {onBack && (
            <button class="icon-btn" onClick={onBack} aria-label={t('back')}>
              <IconBack />
            </button>
          )}
          {!hideTitle && <h2 class="sheet-title">{title}</h2>}
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
  title, body, confirmLabel, danger = false, onConfirm, onClose, children,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
  /** 決定之前要先看到的東西（例如結束這一輪時的結果預覽），放在說明與按鈕之間。 */
  children?: ComponentChildren
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
        {children}
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
