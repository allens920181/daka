import { Logo } from './Logo'
import { IconSettings } from './icons'
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
 * 設定鍵兩邊都在，而且都在這一列的右邊——它改的是 app 的設定，不是這一間空間的
 * 設定，所以它屬於這一列，跟空間自己那一列的「更多」是兩件事。
 */
export function AppBar({ onSettings }: { onSettings: () => void }) {
  const t = useT()
  return (
    <div class="app-bar row">
      <Logo />
      <h1 class="app-name">{t('appName')}</h1>
      <button class="icon-btn" onClick={onSettings} aria-label={t('settings')}>
        <IconSettings />
      </button>
    </div>
  )
}
