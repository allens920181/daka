/**
 * 首頁標題左邊那顆標誌。
 *
 * 它就是這個 app 的圖示（`public/favicon.svg`）：主畫面上那顆圖示與首頁標題旁邊
 * 這一顆必須是同一個東西，不然「我剛剛點開的是哪個 app」要靠字去認。
 *
 * **但不是把那個檔案縮小。** 那份是為 512px 的圖磚畫的：三列、11px 的勾，縮到
 * 28px 之後勾只剩 0.6px——比髮絲線還細，在畫面上會整個消失，只留下三條白棒。
 * 所以這裡是同一個想法重畫一次：兩列、筆畫加粗、留白放大。小尺寸的標誌本來就
 * 是另一張圖，不是同一張圖的縮圖。
 *
 * **顏色寫死，不跟主題走。** 全站只有這裡這樣——標誌是那個 app 的身分，深色模式
 * 不會換掉它，就像手機主畫面上的圖示不會因為深色模式變一個樣子。深色底上那塊
 * 深 teal 的磚對比只有 2.3:1，但標誌讀得出來靠的是磚上面那些白色記號（8.7:1），
 * 跟深色桌布上的 app 圖示是同一回事。
 *
 * 標題文字本身就是產品名字，所以這顆是裝飾（`aria-hidden`）——讀出來會變成
 * 「RollRoom RollRoom」。
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="presentation"
      aria-hidden="true"
      style="flex:none; display:block"
    >
      <rect width="24" height="24" rx="5.5" fill="#0e5e63" />
      {/* 第一列：打過勾的 */}
      <rect x="4" y="5" width="6" height="6" rx="1.8" fill="#ffffff" />
      <polyline
        points="5.5,8 6.7,9.2 8.5,6.6"
        fill="none"
        stroke="#0e5e63"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="12" y="6.7" width="8" height="2.6" rx="1.3" fill="#ffffff" />
      {/* 第二列：還沒點到的那個人。半透明，因為它講的是「還沒發生」。 */}
      <rect
        x="4.65"
        y="13.65"
        width="4.7"
        height="4.7"
        rx="1.4"
        fill="none"
        stroke="#ffffff"
        stroke-width="1.3"
        opacity="0.55"
      />
      <rect x="12" y="14.7" width="8" height="2.6" rx="1.3" fill="#ffffff" opacity="0.55" />
    </svg>
  )
}
