import { useEffect, useRef } from 'preact/hooks'

/**
 * 把「可以退出的一層」接上瀏覽器歷史（2026-09）。
 *
 * **為什麼需要這個檔案。** 面板、面板的子畫面、確認對話框本來全部只是元件
 * 狀態，沒有任何一個是歷史紀錄。於是在 iOS 上——
 *
 *   在「更多」面板從左緣右滑  →  預期關掉面板，實際**整個退出空間**
 *   在「邀請點名 › 代碼」右滑  →  預期回上一頁，實際同上
 *
 * 邊緣右滑是 iOS 的主要返回操作，而加到主畫面的 PWA 沒有瀏覽器返回鍵，
 * 它是**唯一**的返回操作。Android 的實體返回鍵同理。
 *
 * 這也是這個專案自己的「位置穩定」原則被打破的地方：那條原則保護的是靠位置
 * 記憶操作的人，而右滑是靠**肌肉記憶**操作的人——被送到的地方比記錯位置更遠。
 *
 * ---
 *
 * **機制。** 每開一層就 `pushState` 一格（不動網址，所以不會觸發 hashchange，
 * 路由不受影響）。使用者按返回／右滑時 `popstate` 進來，通知最上層自己被關掉了。
 * 反過來，程式自己關掉一層時（Esc、點遮罩、按面板的返回鍵）要把自己推的那一格
 * **吃掉**，不然歷史裡會留下一格按了什麼都不會發生的空白。
 *
 * 三個陷阱，這裡各有對應：
 *
 * 1. **自己送出的 `back()` 也會觸發 popstate。** 沒有擋的話，關掉對話框會連
 *    底下的面板一起關掉。用 `selfPops` 計數擋掉。
 * 2. **層是疊起來的**（面板之上還能疊確認對話框），所以只有最上層該回應。
 *    用一個模組層級的堆疊，不是各自監聽。
 * 3. **關掉的同時可能正在導航**（「建立副本」會 `navigate` 去新空間）。那時候
 *    我們那一格已經被新的 hash 蓋在底下，再 `back()` 會把導航本身撤銷。
 *    所以推的時候記下網址，清理時網址變了就不吃那一格。
 */

/** 由下而上的層。每一格存「被返回掉時要通知誰」與「推的時候在哪個網址」。 */
const stack: Array<{ pop: () => void; href: string }> = []

/** 正在消化自己送出的 back()：接下來這幾次 popstate 不是使用者按的。 */
let selfPops = 0

let listening = false

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('popstate', () => {
    if (selfPops > 0) {
      selfPops -= 1
      return
    }
    stack.pop()?.pop()
  })
}

function pushLayer(pop: () => void): void {
  ensureListener()
  stack.push({ pop, href: window.location.href })
  window.history.pushState({ rrLayer: stack.length }, '')
}

/**
 * 程式自己關掉一層 → 把那一格吃回來。
 *
 * 網址變了就不吃：那表示這一層是在導航的同時關掉的（見上面第 3 點），
 * 我們那一格已經被壓在新的紀錄底下，`back()` 會撤銷掉導航。留一格沒有吃掉的
 * 紀錄的代價只是「多按一次返回會停在原地」，比把人送回舊空間輕得多。
 */
function dropLayer(): void {
  const layer = stack.pop()
  if (!layer) return
  if (layer.href !== window.location.href) return
  selfPops += 1
  window.history.back()
}

/**
 * 讓一個模態層擁有 `count` 格歷史紀錄。
 *
 * `count` ＝ 1（這一層自己）＋ 目前在第幾層子畫面。所以「更多」面板的選單頁是
 * 1、「邀請點名」是 2、「邀請點名 › 代碼」是 3——每深一層就多一格，右滑就
 * 剛好回上一頁。
 *
 * `onPop` 是「被返回掉時要做什麼」：在子畫面上是回上一頁（`onBack`），
 * 在最外層是關掉整個面板（`onClose`）。**它是用 ref 讀的**，所以彈出的當下
 * 讀到的一定是當時該做的那一件事，而不是推進去時的舊閉包。
 */
export function useHistoryLayers(count: number, onPop: () => void): void {
  const cb = useRef(onPop)
  cb.current = onPop
  const owned = useRef(0)

  // 沒有相依陣列：每次 render 都對帳一次。多數時候兩個數字相等，什麼都不做。
  useEffect(() => {
    while (owned.current < count) {
      owned.current += 1
      pushLayer(() => {
        owned.current -= 1
        cb.current()
      })
    }
    while (owned.current > count) {
      owned.current -= 1
      dropLayer()
    }
  })

  // 卸載時把還握著的格子全部還回去。
  useEffect(() => () => {
    while (owned.current > 0) {
      owned.current -= 1
      dropLayer()
    }
  }, [])
}
