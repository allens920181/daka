import type { MessageKey } from '../lib/i18n'

/**
 * 聚焦導覽的步驟表（2026-11）：**整個 app 的每一個功能，一個一個框給你看**。
 *
 * 一步 ＝ 一個舞台畫面（`stage`）＋ 舞台上的一個目標（`target`，CSS 選擇器）＋ 一段說明。
 * 導覽引擎（`Guide.tsx`）與舞台（`GuideStages.tsx`）都讀這張表；加一個功能的介紹，
 * 只要在這裡加一列、在 i18n 加兩個字串，必要時在舞台上補一個目標。
 *
 * **順序是一場活動的時間軸**：開空間 → 別人加進來 → 現場點名 → 發代碼、改名單 → 車開了收尾
 * →（回到首頁）管理空間 → 設定。每一章結束時下一章的畫面就是下一件會碰到的事。
 *
 * `cloud`：只有連上雲端（有設定 Supabase）的版本才有的功能。單機版（名單只存在這支手機）
 * 這些步驟整個不出現——不介紹一個按了只會說「還沒設定雲端」的按鈕（跟設定裡的「帳戶」
 * 那一列同一個規矩）。章節底下一步都不剩，章節也跟著不出現。
 *
 * 說明裡「」括起來的字都是畫面上的原字，`i18n.test.ts` 會一個一個去對（見那邊的說明）。
 */

/** 舞台：一個畫面，有時加一張疊上去的面板或對話框。 */
export type StageId =
  | 'home'          // 首頁，還沒有任何空間（第一次打開看到的樣子）
  | 'homeJoin'      // 首頁 ＋「加入空間」面板
  | 'homeRooms'     // 首頁，有兩個空間（出現篩選列）
  | 'homeRowMenu'   // 首頁 ＋ 某一個空間的「更多」面板
  | 'homeSettings'  // 首頁 ＋ 設定面板
  | 'new'           // 開空間第一步：貼名單
  | 'newList'       // 開空間第二步：看解析結果
  | 'room'          // 空間（主揪的視角）
  | 'roomGroups'    // 空間，名單有分車
  | 'roomSync'      // 空間，離線中、有兩筆待上傳
  | 'roomMenu'      // 空間 ＋「更多」面板
  | 'roomInvite'    // 空間 ＋「邀請點名」那一頁
  | 'roomEdit'      // 空間，編輯模式
  | 'roomFinish'    // 空間 ＋「結束點名」的確認對話框
  | 'roomClosed'    // 空間，結束之後

export type ChapterId =
  | 'start' | 'join' | 'roll' | 'invite' | 'edit' | 'finish' | 'home' | 'settings' | 'tips'

export interface Chapter { id: ChapterId; title: MessageKey }

export const CHAPTERS: readonly Chapter[] = [
  { id: 'start', title: 'guideChStart' },
  { id: 'join', title: 'guideChJoin' },
  { id: 'roll', title: 'guideChRoll' },
  { id: 'invite', title: 'guideChInvite' },
  { id: 'edit', title: 'guideChEdit' },
  { id: 'finish', title: 'guideChFinish' },
  { id: 'home', title: 'guideChHome' },
  { id: 'settings', title: 'guideChSettings' },
  { id: 'tips', title: 'guideChTips' },
]

export interface Step {
  id: string
  chapter: ChapterId
  stage: StageId
  /** 舞台上要框住的東西（CSS 選擇器，在舞台裡找）。`null`＝這一步沒有東西可框。 */
  target: string | null
  title: MessageKey
  body: MessageKey
  /** 單機版換一句話（那時候這一步講的事做不到，見 `shareLocalBody`）。 */
  bodyLocal?: MessageKey
  cloud?: boolean
  /** 舞台上的名單點得動（只有「點名」那一步）。 */
  interactive?: boolean
  /** 說明卡片裡多一塊這一步自己的東西。 */
  extra?: 'feedback'
}

export const STEPS: readonly Step[] = [
  // --- 開一個空間 -----------------------------------------------------------
  { id: 'create', chapter: 'start', stage: 'home', target: '[data-tour="create"]', title: 'guideCreateTitle', body: 'guideCreateBody' },
  { id: 'roster', chapter: 'start', stage: 'new', target: '[data-tour="roster"]', title: 'guideRosterTitle', body: 'guideRosterBody' },
  { id: 'example', chapter: 'start', stage: 'new', target: '[data-tour="example"]', title: 'guideExampleTitle', body: 'guideExampleBody' },
  { id: 'help', chapter: 'start', stage: 'new', target: '.fmt-help-btn', title: 'guideHelpTitle', body: 'guideHelpBody' },
  { id: 'saved', chapter: 'start', stage: 'new', target: '[data-tour="saved"]', title: 'guideSavedTitle', body: 'guideSavedBody', cloud: true },
  { id: 'preview', chapter: 'start', stage: 'newList', target: '[data-tour="preview"]', title: 'guidePreviewTitle', body: 'guidePreviewBody' },
  { id: 'confirm', chapter: 'start', stage: 'newList', target: '[data-tour="confirm"]', title: 'guideConfirmTitle', body: 'guideConfirmBody' },

  // --- 加入別人的空間 -------------------------------------------------------
  { id: 'join', chapter: 'join', stage: 'home', target: '[data-tour="join"]', title: 'guideJoinTitle', body: 'guideJoinBody', cloud: true },
  { id: 'joinCode', chapter: 'join', stage: 'homeJoin', target: '[data-tour="sheetbody"]', title: 'guideJoinCodeTitle', body: 'guideJoinCodeBody', cloud: true },

  // --- 點名 -----------------------------------------------------------------
  { id: 'identity', chapter: 'roll', stage: 'room', target: '.topbar-heading', title: 'guideIdentityTitle', body: 'guideIdentityBody' },
  { id: 'filter', chapter: 'roll', stage: 'room', target: '.filterbar', title: 'guideFilterTitle', body: 'guideFilterBody' },
  { id: 'groups', chapter: 'roll', stage: 'roomGroups', target: '.groups', title: 'guideGroupsTitle', body: 'guideGroupsBody' },
  { id: 'tap', chapter: 'roll', stage: 'room', target: '[data-tour="list"]', title: 'guideTapTitle', body: 'guideTapBody', interactive: true, extra: 'feedback' },
  { id: 'notes', chapter: 'roll', stage: 'room', target: '.member:first-child .member-note', title: 'guideNotesTitle', body: 'guideNotesBody' },
  { id: 'sync', chapter: 'roll', stage: 'roomSync', target: '.sync', title: 'guideSyncTitle', body: 'guideSyncBody', cloud: true },

  // --- 邀請與協助者 ---------------------------------------------------------
  { id: 'more', chapter: 'invite', stage: 'room', target: '[data-tour="more"]', title: 'guideMoreTitle', body: 'guideMoreBody' },
  { id: 'menu', chapter: 'invite', stage: 'roomMenu', target: '[data-tour="sheetbody"]', title: 'guideMenuTitle', body: 'guideMenuBody', bodyLocal: 'guideMenuBodyLocal' },
  { id: 'invite', chapter: 'invite', stage: 'roomInvite', target: '[data-tour="sheetbody"]', title: 'guideInviteTitle', body: 'guideInviteBody', bodyLocal: 'guideInviteBodyLocal' },

  // --- 編輯名單 -------------------------------------------------------------
  { id: 'edit', chapter: 'edit', stage: 'roomEdit', target: '[data-tour="list"]', title: 'guideEditTitle', body: 'guideEditBody' },
  { id: 'walkin', chapter: 'edit', stage: 'roomEdit', target: '[data-tour="walkin"]', title: 'guideWalkinTitle', body: 'guideWalkinBody' },

  // --- 結束與帶走 -----------------------------------------------------------
  { id: 'finish', chapter: 'finish', stage: 'room', target: '[data-tour="finish"]', title: 'guideFinishTitle', body: 'guideFinishBody' },
  { id: 'finishDialog', chapter: 'finish', stage: 'roomFinish', target: '.dialog', title: 'guideFinishDialogTitle', body: 'guideFinishDialogBody' },
  { id: 'closed', chapter: 'finish', stage: 'roomClosed', target: '.result-card', title: 'guideClosedTitle', body: 'guideClosedBody' },

  // --- 管理你的空間（首頁）-------------------------------------------------
  { id: 'rows', chapter: 'home', stage: 'homeRooms', target: '.recent-item', title: 'guideRowsTitle', body: 'guideRowsBody' },
  { id: 'homeFilter', chapter: 'home', stage: 'homeRooms', target: '.home-filterbar', title: 'guideHomeFilterTitle', body: 'guideHomeFilterBody' },
  { id: 'rowMenu', chapter: 'home', stage: 'homeRowMenu', target: '[data-tour="sheetbody"]', title: 'guideRowMenuTitle', body: 'guideRowMenuBody' },

  // --- 設定與帳戶 -----------------------------------------------------------
  { id: 'settings', chapter: 'settings', stage: 'homeSettings', target: '[data-tour="sheetbody"]', title: 'guideSettingsTitle', body: 'guideSettingsBody' },
  { id: 'account', chapter: 'settings', stage: 'homeSettings', target: '[data-tour="account"]', title: 'guideAccountTitle', body: 'guideAccountBody', cloud: true },

  // --- 最後 -----------------------------------------------------------------
  { id: 'tips', chapter: 'tips', stage: 'home', target: null, title: 'guideTipsTitle', body: 'guideTipsBody' },
]

/** 這個版本看得到的步驟。單機版略過 `cloud` 的。 */
export function stepsFor(cloud: boolean): Step[] {
  return STEPS.filter((s) => cloud || !s.cloud)
}

/** 章節在這份步驟裡的樣子：標題、從第幾步開始、有幾步。沒有步驟的章節不列。 */
export function chaptersFor(steps: readonly Step[]): { id: ChapterId; title: MessageKey; first: number; count: number }[] {
  return CHAPTERS.flatMap((c) => {
    const first = steps.findIndex((s) => s.chapter === c.id)
    if (first < 0) return []
    return [{ id: c.id, title: c.title, first, count: steps.filter((s) => s.chapter === c.id).length }]
  })
}
