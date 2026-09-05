import type { ComponentChildren, JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { IconBack, IconClose } from './icons'
import { useModal } from './useModal'
import { useT } from './t'

/** 拖過這個距離放手就收起來。再短就會變成「手指抖一下面板就不見了」。 */
const CLOSE_AT = 88
/** 動這麼多才算拖曳，不然按分頁鍵時手指的自然位移就會被當成手勢。 */
const ENGAGE_AT = 8

/**
 * 底部面板：用於選單與較長的表單。
 * 需要使用者做「是或否」的決定時用 ConfirmDialog，不要用面板。
 */
export function Sheet({
  title, onClose, onBack, head, children,
}: {
  title: string
  onClose: () => void
  /** 只有面板內有多階段時才傳（例如「更多」面板的子畫面）：回上一頁，跟
   *  onClose（離開整個面板）是兩個不同的動作。 */
  onBack?: () => void
  /**
   * 標題那一列要放的東西，取代標題本身（「更多」面板放的是它的分頁鍵）。
   * 用在標題只是複述底下內容、自己說不出任何一件事的面板：與其讓標題列
   * 只剩一顆孤零零的關閉鍵佔掉一整列，不如把面板自己的控制項搬上去。
   * **`aria-label` 仍然是 title**——螢幕閱讀器聽得到的不能跟著少。
   */
  head?: ComponentChildren
  children: ComponentChildren
}) {
  const panel = useRef<HTMLDivElement>(null)
  useModal(panel, onClose)
  const t = useT()

  /*
    往下滑收起來。面板是從下緣長上來的，把它推回去是這個動作最直覺的手勢，
    而且手指本來就停在頂端那一帶（握把、分頁鍵）。

    只吃「往下」這一個方向：標題列裡住著分頁鍵，`.segmented` 自己是可以橫向
    捲的，所以先動到橫向就把這次手勢讓出去。垂直位移超過 ENGAGE_AT 才接管，
    接管之後 setPointerCapture 會把後續事件（含 click）綁在這裡，按鍵不會誤觸發。
  */
  const from = useRef<{ id: number; x: number; y: number; on: boolean } | null>(null)
  const [dragY, setDragY] = useState(0)

  const drag = {
    onPointerDown: (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      from.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false }
    },
    onPointerMove: (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      const d = from.current
      if (!d || d.id !== e.pointerId) return
      const dy = e.clientY - d.y
      const dx = e.clientX - d.x
      if (!d.on) {
        // 橫向先動：這是在捲分頁鍵，不是要收面板。
        if (Math.abs(dx) > ENGAGE_AT && Math.abs(dx) > Math.abs(dy)) { from.current = null; return }
        if (dy < ENGAGE_AT) return
        d.on = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      setDragY(Math.max(0, dy))
    },
    onPointerUp: (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      const d = from.current
      from.current = null
      setDragY(0)
      if (!d || d.id !== e.pointerId || !d.on) return
      if (e.clientY - d.y > CLOSE_AT) onClose()
    },
    onPointerCancel: () => { from.current = null; setDragY(0) },
  }

  return (
    <div
      class="overlay overlay-bottom"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        class={dragY ? 'sheet is-dragging' : 'sheet'}
        style={dragY ? `transform: translateY(${dragY}px)` : undefined}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div class="sheet-grip" {...drag} />
        <div class="sheet-head" {...drag}>
          {onBack && (
            <button class="icon-btn" onClick={onBack} aria-label={t('back')}>
              <IconBack />
            </button>
          )}
          {head ?? <h2 class="sheet-title">{title}</h2>}
          {/*
            有 head 的時候不再另外放關閉鍵：那一列已經被面板自己的控制項佔滿，
            再擠一顆叉叉就是憑空多出來的東西。收起來靠點面板外面、Esc、或是
            從這一帶往下滑——三條路都在，只是都不佔位置。
          */}
          {!head && (
            <>
              <div class="spacer" />
              <button class="icon-btn" onClick={onClose} aria-label={t('close')}>
                <IconClose />
              </button>
            </>
          )}
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
  title, body, confirmLabel, cancelLabel, danger = false, onConfirm, onClose, children,
}: {
  title: string
  body: string
  confirmLabel: string
  /** 預設是「取消」。兩個選項都是有意義的決定（不是「做」或「算了」）時換成
   *  具體的說法——例如開空間偵測到草稿，兩顆鍵是「繼續使用草稿」跟
   *  「清掉重來」，沒有一顆單純是「取消」。 */
  cancelLabel?: string
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
          <button class="btn btn-block" onClick={onClose}>{cancelLabel ?? t('cancel')}</button>
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
