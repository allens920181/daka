import { Logo } from './Logo'
import { IconHelp, IconSettings } from './icons'
import { useT } from './t'

/**
 * App 那一層的抬頭：標誌 ＋ 產品名 ＋ 設定。
 *
 * **首頁與空間用的是同一條**（2026-09）。空間以前是一整頁蓋掉首頁，於是走進去
 * 之後畫面上沒有一個東西說得出「我還在同一個 app 裡」——只剩一個空間名字和一顆
 * 返回鍵。現在它跟著進去，空間變成這個 app 裡的一頁，而不是另一個地方。
 *
 * 兩邊的差別只在外層怎麼包：
 * - 首頁：它就在頁面最上面，跟著內容一起捲走（底下那條篩選列才是 sticky 的）。
 * - 空間：它住在 sticky 的頂欄裡，往下滑時跟空間名那一列一起收起來
 *   （見 Room 的 `.room-chrome`）。
 *
 * 右邊兩顆，兩邊都在：**使用說明**（`?`）在左、**設定**在右（2026-11）。兩顆都是
 * app 這一層的事，不是這一間空間的事，所以屬於這一列，跟空間自己那一列的「更多」是
 * 兩件事。說明排在設定左邊，是因為最右邊是整個 app 裡固定不動的位置（設定一直在那裡，
 * 使用者是靠位置記它的），新加的鍵往它的左邊長，不去擠它。
 *
 * 說明在這裡而不在設定裡：它不是「這支手機的偏好」，是「我現在卡住了、想看看怎麼用」——
 * 那個時刻使用者找的是畫面上看得見的一顆鍵，不是翻進設定清單的最後一列。
 */
export function AppBar({ onSettings, onGuide }: { onSettings: () => void; onGuide: () => void }) {
  const t = useT()
  return (
    // 底色帶要滿版，所以它自己就是外層，`.shell` 收在裡面——掛在 `.shell` 裡面
    // 的話，那塊底色會被左右內距切掉兩道縫。
    <div class="app-bar-band">
      <div class="shell app-bar row">
        <Logo />
        <h1 class="app-name">{t('appName')}</h1>
        {/* 打開的是一張面板，不是換頁：`aria-haspopup="dialog"` 才是「按下去會開一層」的正確說法。 */}
        <button class="icon-btn" onClick={onGuide} aria-label={t('guideTitle')} aria-haspopup="dialog">
          <IconHelp />
        </button>
        <button class="icon-btn" onClick={onSettings} aria-label={t('settings')}>
          <IconSettings />
        </button>
      </div>
    </div>
  )
}
