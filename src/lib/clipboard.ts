/**
 * 複製到剪貼簿。
 *
 * `navigator.clipboard` 是 secure context 專屬的 API：HTTPS 與 localhost 有，
 * 從區網開的 `http://192.168.x.x:5173` 沒有。而這個產品在現場的第一個動作
 * 就是「把連結貼進 LINE 群」——複製壞掉，主揪就叫不到人。
 *
 * 所以有新 API 就用新 API，沒有就退回 `execCommand('copy')`。它已經被標記為
 * 過時，但在不安全來源底下它是唯一還能用的一條路，而且各家瀏覽器都還支援。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 權限被拒、不在使用者手勢裡、或分頁沒有焦點。往下走退路，
    // 不要直接回報失敗——舊 API 在這幾種情況下常常還是成功的。
  }
  return legacyCopy(text)
}

/**
 * 為什麼是移到畫面外而不是 `display:none`：隱藏起來的元素選不到文字，
 * 選不到就沒有東西可以複製。
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false

  const el = document.createElement('textarea')
  el.value = text
  // readOnly 而不是 disabled：disabled 的欄位選不起來。也順便擋掉手機鍵盤彈出。
  el.readOnly = true
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('tabindex', '-1')
  // font-size 一定要 16px：iOS Safari 會對更小的輸入框自動放大整個畫面，
  // 使用者只是按了「複製」，畫面卻跳一下。
  el.style.cssText = 'position:fixed; top:0; left:-9999px; opacity:0; font-size:16px'
  document.body.appendChild(el)

  try {
    el.select()
    // iOS 只認 setSelectionRange，select() 對它沒有作用。
    el.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    el.remove()
  }
}
