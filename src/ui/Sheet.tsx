import type { ComponentChildren, JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { IconBack } from './icons'
import { useModal } from './useModal'
import { useT } from './t'

/** 拖過這個距離放手就收起來。再短就會變成「手指抖一下面板就不見了」。 */
const CLOSE_AT = 88
/** 動這麼多才算拖曳，不然按分頁鍵時手指的自然位移就會被當成手勢。 */
const ENGAGE_AT = 8

/**
 * 底部面板：用於選單與較長的表單。
 * 需要使用者做「是或否」的決定時用 ConfirmDialog，不要用面板。
 *
 * **沒有標題列**（2026-09）。它一路瘦下來：13 項擠成一長串 → 三顆分頁鍵 →
 * 一條平的選單 → 部分面板傳 `head={false}` 整條不畫 → 現在所有面板都不畫。
 * 判準始終是那一條「標題有沒有比它底下那些列多說一件事」，而逐一問過之後，
 * 沒有一頁答得出是。
 *
 * 剩下的是 `.sheet-bar`：**每一頁都在、高度固定的那一條**。它裝著握把（永遠）
 * 與返回鍵（子畫面才有）。這一列存在的理由不再是標題，而是
 * **每一頁的內容都從同一條線開始**——面板不會因為進了子畫面就整個往下推 60px。
 *
 * `aria-label` 仍然是 `title`：眼睛看不到不代表螢幕閱讀器也可以聽不到。
 */
export function Sheet({
  title, onClose, onBack, children,
}: {
  title: string
  onClose: () => void
  /** 只有面板內有多階段時才傳（例如「更多」面板的子畫面）：回上一頁，跟
   *  onClose（離開整個面板）是兩個不同的動作。 */
  onBack?: () => void
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

  /**
   * @param grabAtOnce 一按下去就 setPointerCapture。
   *
   * **沒有返回鍵的那一列要，有的不要。** 那一列只有 48px 高，手指往下劃第一公分
   * 就已經離開它——沒有 capture 的話後續的 pointermove 根本不會再送到它身上，
   * 手勢就這樣斷了（這件事被藏了很久：以前標題列上有同一組 handler，指標滑出
   * 握把之後正好落在標題列上，是它把手勢接了下去）。
   * 但有返回鍵時不能一按下去就 capture——那會吃掉那顆鍵的 click。
   */
  const dragProps = (grabAtOnce: boolean) => ({
    onPointerDown: (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      from.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false }
      if (grabAtOnce) e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: JSX.TargetedPointerEvent<HTMLElement>) => {
      const d = from.current
      if (!d || d.id !== e.pointerId) return
      const dy = e.clientY - d.y
      const dx = e.clientX - d.x
      if (!d.on) {
        // 橫向先動：這是在捲某個橫向可捲的東西，不是要收面板。
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
  })

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
        {/*
          每一頁都在的那一條。握把畫在它的正中間（`::after`），返回鍵靠左——
          所以**有沒有子畫面都不會改變這一列的高度**，內容永遠從同一條線開始。

          它同時是「往下滑收起來」的手勢區，而且比舊的握把寬鬆得多：48px 對一根
          手指來說才是夠的目標，舊的那條線只有 20px。
        */}
        <div class="sheet-bar" {...dragProps(!onBack)}>
          {onBack && (
            <button class="icon-btn" onClick={onBack} aria-label={t('back')}>
              <IconBack />
            </button>
          )}
        </div>
        {/*
          內容自己一格。**高度貼合內容**，但每一頁的落差要小——那兩件事怎麼一起
          成立，見 styles.css 的 .sheet-body。
        */}
        <div class="sheet-body">{children}</div>
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
  /** 決定之前要先看到的東西（例如結束點名時的結果預覽），放在說明與按鈕之間。 */
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
