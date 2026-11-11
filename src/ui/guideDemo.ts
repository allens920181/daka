import { useState } from 'preact/hooks'
import type { MessageKey } from '../lib/i18n'
import type { Member, Room } from '../lib/types'

/**
 * 聚焦導覽的**模擬資料**（2026-11）：三個人、一個示範空間。
 *
 * 全部住在導覽元件的記憶體裡——不碰 `members`、佇列、網路、IndexedDB，關掉就沒了。
 * 這也是為什麼舞台是自己拼的，而不是把真的 `Room` 掛上來：真的 `Room` 一掛上去就會
 * `enterRoom`（連線、同步、寫本機），而「示範用的資料」一旦經過那條路，就有可能變成一份
 * 真的空間（見 `Guide.tsx` 的說明）。
 */

/** 演練名單的三個人。跟「填入範例」同一組名字。 */
export const DEMO_NAMES: readonly MessageKey[] = ['guideDemoName1', 'guideDemoName2', 'guideDemoName3']

/** 示範空間的代碼。合法的 6 碼（見 code.ts 的字母表），但這個空間不存在。 */
export const DEMO_CODE = 'K7F2QM'
export const DEMO_CODE_2 = 'QW3RT9'

/** 第一個人備註裡的電話：跟「填入範例」那一行（`王小明 0912345678`）一樣。 */
const DEMO_PHONE = '0912345678'

/**
 * 演練：**三個人的名單，點得動，行為跟真的點名畫面一模一樣**。
 *
 * 點完也跟真的一樣跳一個 Toast（「某某 · 已到」＋「復原」），而且復原做的事也一樣：
 * 把**剛剛那一個人**退回去。再點同一個人也退得回來。
 *
 * `at` 是每個人被點到的時間（`null` ＝ 還沒到），不是一個布林：真的名單列在右邊印著
 * 「幾點」，演練也印，不然那一格在第一次看到真的畫面時是個沒人解釋過的東西。
 * 舞台上的篩選列數字、「結束點名」的結果文字吃的都是同一份 `at`。
 *
 * 狀態住在導覽元件，不在哪一步的元件裡：走回上一步再回來，點過的人還是已到。
 */
export function useDemo() {
  const [at, setAt] = useState<(number | null)[]>(() => DEMO_NAMES.map(() => null))
  const [last, setLast] = useState<{ index: number; before: number | null } | null>(null)

  const toggle = (index: number) => {
    setLast({ index, before: at[index] ?? null })
    setAt(at.map((v, i) => (i === index ? (v === null ? Date.now() : null) : v)))
  }
  const undo = () => {
    if (!last) return
    setAt(at.map((v, i) => (i === last.index ? last.before : v)))
    setLast(null)
  }
  return { at, last, toggle, undo }
}
export type Demo = ReturnType<typeof useDemo>

/** 這一輪要用到的、跟語言有關的字（名字、備註、分車、空間名）。 */
export interface DemoText {
  names: string[]
  /** 第三個人的備註（「坐輪椅」）。 */
  note3: string
  groups: [string, string]
  roomName: string
}

/**
 * 演練名單 → 真的 `Member`。餵給真的 `MemberRow` 與真的 `toShareText`。
 *
 * 備註與分車跟「填入範例」一樣：王小明帶著電話（所以有一顆撥號鍵）、陳大同寫著「坐輪椅」；
 * 前兩個人在第一車、第三個人在第二車。`withGroups` 為 `false` 時一律沒有分車——大部分的步驟
 * 不講分車，一份有分車標題的名單會把名單撐高兩列。
 */
export function demoMembers(text: DemoText, at: (number | null)[], withGroups: boolean): Member[] {
  return text.names.map((name, i) => {
    const time = at[i] ?? null
    return {
      id: `demo-${i}`, room_id: 'demo', name,
      note: i === 0 ? DEMO_PHONE : i === 2 ? text.note3 : null,
      phone: null, companions: 0,
      group_label: withGroups ? (i < 2 ? text.groups[0] : text.groups[1]) : null,
      sort_order: i, status: time === null ? 'pending' : 'arrived',
      status_at: time === null ? null : new Date(time).toISOString(),
      status_by: null, rev: 0, created_at: '',
    }
  })
}

export function demoRoom(name: string): Room {
  return {
    id: 'demo', code: DEMO_CODE, name, note: null,
    created_at: '', expires_at: '', closed_at: null, copied_from: null,
  }
}
