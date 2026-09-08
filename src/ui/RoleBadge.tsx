import { IconKey, IconUser } from './icons'
import { useT } from './t'

/**
 * 「我在這個空間是誰」——主揪或協助者。
 *
 * 2026-09 從一顆寫著字的藥丸標籤（`.tag`）換成圖示：它在首頁每一列與空間頂欄
 * 各出現一次，而那兩個地方最缺的都是橫向空間——首頁那一列右邊要留給「更多」，
 * 頂欄那一行要留給空間名字，而「主揪」三個字連內距吃掉的寬度跟一顆圖示差了
 * 三倍。**位置也跟著換到標題前面**：它講的是「我」，比它後面那個名字更早被讀到。
 *
 * 兩個圖示要一眼分得開，不能只靠顏色（色盲、以及最低亮度下的螢幕都分不出來）：
 * - **主揪＝鑰匙**：這支手機握著改動這個空間的權限（`ownerKey`），而畫面上哪些
 *   事做得動（編輯名單、結束點名）就是由它決定的。
 * - **協助者＝人**：你是來幫忙點名的其中一個人。
 *
 * 代價講清楚：**字沒了**。第一次用的人看不到「主揪」兩個字，只能靠形狀與顏色
 * 分辨，桌機能 hover 出 `title`、螢幕閱讀器唸得到 `aria-label`，但手機上沒有
 * hover。換到的是首頁一列多出約 60px 給空間名字、頂欄少一格。
 */
export function RoleBadge({ owner }: { owner: boolean }) {
  const t = useT()
  const label = owner ? t('owner') : t('helper')
  return (
    <span
      class={owner ? 'role-badge is-owner' : 'role-badge'}
      role="img"
      aria-label={label}
      title={label}
    >
      {owner ? <IconKey size={16} /> : <IconUser size={16} />}
    </span>
  )
}
