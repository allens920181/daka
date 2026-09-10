import { Fragment } from 'preact'
import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  connection, dismissToast, editMember, enterRoom, groups, isOwner, leaveRoom, members, pendingUploads,
  openMenuOnEnter, prefs, removeMember, renameRoom, room, setRoomClosed, setStatusWithUndo, showToast,
} from '../lib/store'
import { summarize } from '../lib/merge'
import { dialableFrom, telHref } from '../lib/parse'
import type { Member, MemberStatus } from '../lib/types'
import { csvFilename, downloadFile, toCsv, toShareText } from '../lib/export'
import { copyToClipboard } from '../lib/clipboard'
import { formatTime } from '../lib/format'
import { navigate } from '../router'
import { errorMessage } from './NewRoom'
import { RoleBadge } from './RoleBadge'
import { ConfirmDialog } from './Sheet'
import { AddWalkInSheet, ManageSheet } from './Sheets'
import {
  IconBack, IconCheck, IconClose, IconCopy, IconDownload, IconMore, IconPhone, IconPlus,
  IconSearch,
} from './icons'
import { useT } from './t'

type Filter = 'all' | 'pending' | 'arrived'
type OpenSheet = null | 'manage' | 'walkin'
/** 「更多」要開在哪一頁（底部動作列的「邀請點名」、首頁那顆「更多」、剛建立完副本）。 */
type MenuMode = 'invite' | undefined

/**
 * 「未分組」這個晶片的內部值。用一個不可能當成分組名的哨符，而不是 null——
 * null 已經是「看全部」的意思了，兩者必須分得開。
 */
const UNGROUPED = '\u0000ungrouped'

export function Room({ code }: { code: string }) {
  const t = useT()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  /*
    搜尋 2026-09 收成篩選列右邊的一顆圖示，點了才從那個位置往左長出輸入框
    （見 styles.css 的 .filterbar / @keyframes search-open）。兩件事換來的：
    篩選與搜尋合成一列，頂欄少 76px——正好一列人名，80 人的名單首屏因此
    多看得到一個人。代價是要搜尋得先點一下。

    **不變的是那條安全規則：收起來就代表名單沒有被過濾。** 所以有字的時候
    絕不自己收（失焦只在空字串時收），而收起來的那一刻一定把字清掉——名單上
    只剩兩個人卻沒有任何東西說「這是過濾過的」，在車門口會被讀成「都到齊了」。

    **展開的那一刻把範圍拉回全部**（見 openSearch）：搜尋問的是「這個人在不在
    名單上」，答案不該被畫面上還套著的篩選或分車偷偷縮小。
  */
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // 分車：選了某一車之後，計數與名單都只算那一車——
  // 顧第一車的人要看的是「我這台還有幾個沒上」。
  const [group, setGroup] = useState<string | null>(null)
  const [sheet, setSheet] = useState<OpenSheet>(null)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    enterRoom(code)
      .then(() => { if (alive) setStatus('ready') })
      .catch((e: unknown) => {
        if (!alive) return
        setError(errorMessage(e, t, 'join'))
        setStatus('error')
      })
    return () => { alive = false; leaveRoom() }
    // t 隨語言變動，但重新進空間沒有意義；只依 code。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // 首頁每一列右邊那顆「更多」與「建立副本」都是先進空間、再打開空間自己的
  // 那份選單——整個 app 只有那一份清單，首頁不另做一份能力比較弱的。
  const [menuMode, setMenuMode] = useState<MenuMode>(undefined)
  const [confirmFinish, setConfirmFinish] = useState(false)
  /*
    編輯模式（2026-09）。編輯名單這件事以前是一張面板：把整份名單倒成一個
    textarea 讓人重貼，而「臨時加人」與「從名單移除」又各自散在別的地方——
    同一件事有三個入口、三種長相。現在它是這個畫面自己的一個狀態：名字右邊
    長出叉叉、底下那條動作列變成一顆「＋」、標題變成可以直接改的輸入框。
    改的是眼前這份名單，不是它的文字複本。
  */
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [removing, setRemoving] = useState<Member | null>(null)
  /** 編輯模式下正在改的是哪一列。一次只開一列：兩個名字同時是輸入框時，
   *  沒有人看得出自己剛剛在改誰。 */
  const [editingId, setEditingId] = useState<string | null>(null)

  /**
   * 進編輯模式。Toast 要當場收掉——它上面那顆「復原」也是點名操作，而編輯模式
   * 的規則是「這個模式裡改不到誰到了沒」。剩一顆浮在畫面下緣的復原鍵就是那條
   * 規則唯一的破口。
   */
  function startEditing() {
    if (!current) return
    dismissToast()
    setNameDraft(current.name)
    setEditingId(null)
    setEditing(true)
  }
  /*
    展開就聚焦——跳出鍵盤是使用者剛剛按下那顆放大鏡的直接結果，不是一進房間
    就被彈一臉。（搜尋框一直開著的那一版刻意不自動聚焦，理由正好相反。）
  */
  useEffect(() => { if (searching) searchRef.current?.focus() }, [searching])

  /**
   * 展開搜尋。**先把範圍拉回全部**：切到「全部」那一段，也放掉選到的那一車。
   *
   * 搜尋是在回答「這個人在不在名單上」，而問這句話的當下沒有人記得自己畫面上
   * 還套著哪一層範圍——顧第一車的志工選著「第一車」，有人在車門口報上名字，
   * 搜下去卻是「這裡沒有人」：那個人明明在名單上，只是在第二車。這種假的
   * 「查無此人」在車門口的代價是直接把人丟下。
   *
   * 只在展開的那一刻做一次，不是每次打字都做：展開之後篩選被輸入框蓋著，本來
   * 就改不動；而收起來時兩個控制項都回到畫面上、都停在「全部」，使用者看得到
   * 範圍被拉開了，不是背著他偷偷改又偷偷改回去。
   */
  function openSearch() {
    setFilter('all')
    setGroup(null)
    setSearching(true)
  }

  /** 收起來＝不再過濾。兩件事必須一起發生，見 searching 那段。 */
  function closeSearch() {
    setQuery('')
    setSearching(false)
  }

  useEffect(() => {
    if (status !== 'ready') return
    const pending = openMenuOnEnter.value
    if (pending?.code !== code) return
    openMenuOnEnter.value = null
    setMenuMode(pending.mode)
    setSheet('manage')
  }, [status, code])

  const current = room.value
  const all = members.value
  const groupList = groups.value
  const closed = Boolean(current?.closed_at)

  // 選了分組之後就不存在了的分組（名單被換掉），自動退回全部。
  useEffect(() => {
    if (group === UNGROUPED) return
    if (group && !groupList.includes(group)) setGroup(null)
  }, [group, groupList])

  // 有分車時，「沒有分車的人」也必須是一個可以選的晶片。少了它，兩個顧車的
  // 志工各自選了自己那一車，就沒有人負責名單上那幾個沒填車次的人。
  const hasUngrouped = groupList.length > 0 && all.some((m) => m.group_label === null)

  const scoped = useMemo(
    () => (group === null ? all
      : group === UNGROUPED ? all.filter((m) => m.group_label === null)
      : all.filter((m) => m.group_label === group)),
    [all, group],
  )
  const s = useMemo(() => summarize(scoped), [scoped])

  // 同名的人在現場完全無法分辨：兩列一模一樣的「陳怡君」，點錯了也不知道。
  // 名單上有重複姓名時，那些列要多印一點資訊（分車、電話尾碼、備註）。
  const duplicated = useMemo(() => {
    const seen = new Map<string, number>()
    for (const m of all) seen.set(m.name, (seen.get(m.name) ?? 0) + 1)
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name))
  }, [all])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scoped.filter((m) => {
      if (filter === 'pending' && m.status !== 'pending') return false
      if (filter === 'arrived' && m.status !== 'arrived') return false
      if (!q) return true
      // 備註也要比對：電話已經不是解析出來的欄位，號碼現在原文躺在備註裡
      // （見 parse.ts 的 NAME_TAIL）。少了這一行，「用 0912 找人」就無聲失效。
      return m.name.toLowerCase().includes(q)
        || (m.phone ?? '').includes(q)
        || (m.note ?? '').toLowerCase().includes(q)
    })
  }, [scoped, filter, query])

  if (status === 'loading' && !current) return <RoomSkeleton label={t('loading')} />

  if (status === 'error' && !current) {
    return (
      <div class="shell stack" style="padding-top:60px">
        <p class="note note-error">{error}</p>
        <button class="btn btn-block" onClick={() => navigate('/')}>{t('back')}</button>
      </div>
    )
  }

  if (!current) return <RoomSkeleton label={t('loading')} />

  /** 標題改完就存。空白視同沒改（store 那邊也擋，這裡先擋一次少一次請求）。 */
  async function saveName() {
    const next = nameDraft.trim()
    if (!current || !next || next === current.name) return
    try {
      await renameRoom(current.code, next)
    } catch (e) {
      showToast(errorMessage(e, t))
    }
  }

  async function saveMember(m: Member, name: string, note: string) {
    setEditingId(null)
    if (name.trim() === m.name && (note.trim() || null) === m.note) return
    try {
      await editMember(m.id, name, note)
    } catch (e) {
      showToast(errorMessage(e, t))
    }
  }

  async function remove(m: Member) {
    try {
      await removeMember(m.id)
    } catch (e) {
      showToast(errorMessage(e, t))
    }
  }

  async function toggle(m: Member) {
    if (closed || editing) return
    const next: MemberStatus = m.status === 'arrived' ? 'pending' : 'arrived'
    await setStatusWithUndo(
      m.id,
      next,
      (prev) => `${prev.name} · ${next === 'arrived' ? t('arrived') : t('missing')}`,
      t('undo'),
    )
  }

  /** 結束／重新開啟。離線時會失敗，那時候要當面說，不能靜默。 */
  async function setClosed(next: boolean) {
    try {
      await setRoomClosed(next)
    } catch (e) {
      showToast(errorMessage(e, t))
    }
  }

  async function copySummary() {
    if (!current) return
    // scoped 已經是「目前這一車」的名單；標題用看得懂的字，不是內部哨符。
    const ok = await copyToClipboard(toShareText(current, scoped, prefs.value.lang, groupLabel))
    // 剪貼簿在部分瀏覽器需要使用者手勢或權限，失敗時不能靜默——
    // 主揪會以為已經複製好了，貼出去卻是上一次的東西。
    showToast(ok ? t('summaryCopied') : t('copyFailed'))
  }

  // 空名單不是「全部到齊」，只是還沒有人。
  const allHere = s.people > 0 && s.pending === 0
  const groupLabel = group === UNGROUPED ? t('ungrouped') : group

  return (
    <>
      {/*
        捲動之後計分區離開畫面，未到人數由頂欄接手。接手時它就是這個畫面上
        唯一不能消失的數字，所以字級要和空間名對調——空間名此刻只是脈絡，
        「還有幾個沒到」才是使用者盯著的東西。
      */}
      <div class="topbar">
        <div class="shell topbar-inner">
          <button class="icon-btn" onClick={() => navigate('/')} aria-label={t('back')}>
            <IconBack />
          </button>
          {/*
            編輯模式下標題那一格換成輸入框（2026-09）。它不是巢狀在「回到頂端」
            那顆按鈕裡——按鈕裡再放一個輸入框是無效的 HTML，各家瀏覽器對焦行為
            也不一致——而是整格換掉：編輯的時候沒有人要回頂端。

            **身分、代碼、同步狀態那一列在編輯模式下不印。** 它們回答的是「我能
            不能改、這是哪一間、存進去了沒」，是點名當下要一直看得到的東西；
            編輯時畫面上該只剩「這份名單長什麼樣」。少了那一列，輸入框那 48px
            的手指高度也剛好補回原本兩行的位置，頂欄不會忽高忽低。

            主揪限定：改名字是主揪的事，協助者進編輯模式只是為了那顆「＋」。
          */}
          {editing && isOwner.value ? (
            <div class="topbar-title">
              <input
                class="topbar-name-input"
                value={nameDraft}
                maxLength={80}
                aria-label={t('editName')}
                onInput={(e) => setNameDraft((e.currentTarget as HTMLInputElement).value)}
                onBlur={() => { void saveName() }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
              />
            </div>
          ) : (
            /*
              點頂欄回到頂端。200 人的名單捲到底之後，要回到搜尋框得往上滑
              17 個螢幕——而 overscroll-behavior-y: none 連「用力甩」都擋掉了。
              這是行動裝置的既有慣例（狀態列／標題列回頂），不必再教。
            */
            <button
              class="topbar-title"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label={t('backToTop')}
            >
              {/*
                身分（主揪／協助者）排在空間名前面。「我是主揪還是協助者」決定
                這個畫面上哪些事做得動（編輯名單、結束點名都只有主揪能做），是進
                空間第一眼就該知道的事——它講的是「我」，比後面那個名字更早被讀到。
                它 2026-09 走過兩步：先從管理面板頂端那一列搬到頂欄的副標行（排在
                代碼前面），再從一顆寫著字的藥丸換成圖示、往上挪到名字前面。

                **副標那一行 2026-09 整條拿掉了**（代碼 ＋ 同步狀態），頂欄因此少
                20px。兩樣東西各自的去處：
                - **代碼**去「更多 › 邀請點名 › 代碼」——那一頁整頁就是它，字級大到
                  隔著一支手臂唸得出來，而頂欄那一行只印得下 11px 的小字。首頁每一
                  列也印著代碼，所以退出去就看得到。代價是在空間裡要唸代碼得多按
                  兩下。
                - **同步狀態**縮成名字後面一顆圓點：它整場都在那裡但整場都不該被讀
                  ——真正要傳達的是「顏色變了」。完整的說法留在 aria-label／title，
                  有東西還沒上傳時圓點旁邊才多一個數字。
              */}
              <div class="topbar-heading">
                {!editing && <RoleBadge owner={isOwner.value} />}
                <h1 class="topbar-name">{current.name}</h1>
                {/*
                  關閉是全域狀態，不能只靠一條會捲走的橫幅：捲到名單深處時戳名字
                  沒反應，協助者完全不知道為什麼。它只在關閉時佔位置。
                */}
                {!editing && closed && <span class="topbar-count closed">{t('roomClosedShort')}</span>}
                {/*
                  同步狀態縮成名字後面一顆圓點（2026-09）。它原本跟代碼一起住在
                  底下那一行副標，那一行整條拿掉了——見下面那段註解。
                */}
                {!editing && <SyncBadge />}
              </div>
            </button>
          )}
          {/*
            編輯時這顆變成打勾（＝完成）。編輯模式沒有自己的頂欄，也不該有——
            它改的就是眼前這份名單，離開的路要留在原地，而不是另外長一條。
            用圖示而不是文字：這一格在點名模式下是圖示鍵，換成一顆文字鍵會讓
            整條頂欄在切換模式時跳一下寬度。無障礙名稱仍然是「完成」。
          */}
          {editing ? (
            <button class="icon-btn" onClick={() => setEditing(false)} aria-label={t('done')}>
              <IconCheck size={24} />
            </button>
          ) : (
            <button class="icon-btn" onClick={() => setSheet('manage')} aria-label={t('manage')}>
              <IconMore />
            </button>
          )}
        </div>
        {/*
          篩選與搜尋同一列（2026-09）：三段篩選佔左邊，右邊一顆放大鏡，點下去
          從那顆鍵的位置往左長成整條輸入框（`@keyframes search-open`）。

          兩者都住在 sticky 頂欄裡，理由是同一個：真正需要它們的時刻是你已經
          捲過 60 個人、有人在車門口報上名字，那時候要用得先捲回 17 個螢幕。
          而「未到 N」在計分區拿掉之後是畫面上唯一回答「還有幾個沒到」的東西，
          更不能跟著名單捲走。

          合成一列省下 76px——正好一列人名，80 人的名單首屏因此從 7 個人變成
          8 個。代價講清楚：搜尋從「一直開著」退回「要先點一下」，多一步；而
          展開的時候三段篩選被蓋住（那三個數字跟搜尋無關，收起來就回來了）。
          上一次為了省掉那一步才把它從浮動鍵改成常駐輸入框，這次換成用一整列
          人名去買回那一步——同一個判準，秤的東西不一樣。

          有字才亮（.is-on）：:focus 那圈只在打字的當下看得到，滑走去點名之後
          框就退回一般灰底，畫面上會沒有東西說「名單現在是過濾過的」——而名單
          自己也不會說：只剩兩個人的畫面很容易被讀成「都到齊了」。鍵的是
          query.trim()，跟真正觸發過濾的判準（見 shown 那段 useMemo）同一條。
        */}
        <div class="shell filterbar">
          <div class="segmented" role="group" aria-label={t('filter')}>
            <Segment active={filter === 'all'} onClick={() => setFilter('all')} label={t('all')} count={s.people} />
            <Segment
              active={filter === 'pending'}
              onClick={() => setFilter('pending')}
              label={t('missing')}
              count={s.pending}
              /* allHere 已經排除了空名單：沒有人不等於全部到齊，那時候不轉綠。 */
              tone={allHere ? 'done' : 'pending'}
            />
            <Segment active={filter === 'arrived'} onClick={() => setFilter('arrived')} label={t('arrived')} count={s.arrived} />
          </div>

          {searching ? (
            <div class="search-wrap">
              <input
                ref={searchRef}
                class={query.trim() ? 'input is-on' : 'input'}
                type="search"
                value={query}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
                /* 空的時候滑走就收起來（那一列人名還回去）；有字的時候絕不自己
                   收——收起來會清掉字，而使用者只是移開了手指。 */
                onBlur={() => { if (!query) setSearching(false) }}
                /* 結果是邊打邊出來的，所以 return 鍵要做的事只剩一件：**把鍵盤
                   收掉**，好讓人看得到名單。這在 iOS 上不是小事——不接的話，
                   收鍵盤的唯一辦法是點別的地方，而這個畫面上「別的地方」就是
                   名單列，點下去會直接把人標成已到。（跟底下那顆「取消」一直
                   在的理由是同一個。） */
                enterkeyhint="done"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); return }
                  if (e.key !== 'Escape') return
                  // 先清字（名單立刻回來），再按一次才收回成圖示。
                  if (query) { setQuery(''); return }
                  closeSearch()
                }}
              />
              {/*
                取消。**一直在**，不是有字才長出來——沒有字的時候原本只剩「滑去
                別的地方」一條路可以收起來，而這個畫面上「別的地方」就是名單列，
                點下去會直接把人標成已到。手上只有一根拇指的人等於沒有退路。

                一下就收掉，不是先清字再收：收起來本來就會清掉字（收起來＝沒有在
                過濾），所以這顆鍵在兩種狀態下的結果是一樣的，不必分兩段。鍵盤的
                Esc 才留兩段——手指不必離開鍵盤，清掉重打是那裡的常見動作。

                onMouseDown 擋掉預設行為，焦點才不會先離開輸入框：空字串時失焦
                會收起搜尋，那一收會讓這顆鍵在 click 送達之前就消失。
              */}
              <button
                class="search-clear"
                onMouseDown={(e) => e.preventDefault()}
                onClick={closeSearch}
                aria-label={t('cancel')}
              >×</button>
            </div>
          ) : (
            <button
              class="icon-btn search-toggle"
              onClick={openSearch}
              aria-label={t('searchPlaceholder')}
            >
              <IconSearch />
            </button>
          )}
        </div>
      </div>

      <div class="shell">
        {/*
          結束之後橫幅印的是定格的結果，不是一句「這個空間已關閉」——那時候要
          回答的問題已經不是「還能不能點」，而是「這一場最後是幾個人」。
          再附一顆「複製結果」，因為結束之後才想到要貼回 LINE 是常態。
        */}
        {closed && (
          <div class="result-card" style="margin-top:12px">
            <span class="result-card-text">
              {t('closedResult', {
                summary: allHere
                  ? `${t('allHere')} · ${t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}`
                  : `${t('missingCount', { n: s.pendingHeadcount })} · ${t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}`,
              })}
            </span>
            <ResultActions
              onCopy={() => { void copySummary() }}
              onCsv={() => downloadFile(csvFilename(current), toCsv(all, prefs.value.lang))}
            />
          </div>
        )}

        {groupList.length > 0 && (
          <div class="groups" role="group" aria-label={t('group')}>
            <button
              class="group-chip"
              aria-pressed={group === null}
              aria-label={t('groupCount', { name: t('allGroups'), n: summarize(all).pendingHeadcount })}
              onClick={() => setGroup(null)}
            >
              {t('allGroups')}
              {/* 「全部」也帶一個數字，這一列的數字才加得起來：各車的未到數
                  相加要等於它。少了它，志工看到「第一車 2、第二車 4」和下面
                  的「未到 7」對不上，會開始找那個不存在的差額。 */}
              <span class={allHere ? 'group-n done' : 'group-n'}>{summarize(all).pendingHeadcount}</span>
            </button>
            {groupList.map((g) => {
              const gs = summarize(all.filter((m) => m.group_label === g))
              return (
                <button
                  key={g}
                  class="group-chip"
                  aria-pressed={group === g}
                  onClick={() => setGroup(g)}
                  aria-label={t('groupCount', { name: g, n: gs.pendingHeadcount })}
                >
                  {g}
                  <span class={gs.pending === 0 ? 'group-n done' : 'group-n'}>{gs.pendingHeadcount}</span>
                </button>
              )
            })}
            {hasUngrouped && (() => {
              const gs = summarize(all.filter((m) => m.group_label === null))
              return (
                <button
                  class="group-chip"
                  aria-pressed={group === UNGROUPED}
                  onClick={() => setGroup(UNGROUPED)}
                  aria-label={t('groupCount', { name: t('ungrouped'), n: gs.pendingHeadcount })}
                >
                  {t('ungrouped')}
                  <span class={gs.pending === 0 ? 'group-n done' : 'group-n'}>{gs.pendingHeadcount}</span>
                </button>
              )
            })()}
          </div>
        )}

        <div class="list" role="list" aria-label={t('roster')}>
          {shown.length === 0 ? (
            <div class="empty">
              {/*
                「太好了，全部都到了」等於「可以關門了」，只有在真的沒有人沒到時
                才能說。有搜尋字串時名單是空的通常代表打錯字——收尾時單手打注音
                很容易打錯，這時候要說的是「沒找到」，不是「不用找了」。
              */}
              {query.trim() ? (
                <>
                  <p class="empty-big">{t('emptyList')}</p>
                  <p class="hint">
                    {s.pending > 0 ? t('emptySearchHint', { n: s.pendingHeadcount }) : t('emptySearchHintDone')}
                  </p>
                </>
              ) : (
                <p class="empty-big">
                  {filter === 'pending' && s.people > 0 ? t('emptyMissing') : t('emptyList')}
                </p>
              )}
            </div>
          ) : (
            shown.map((m, i) => {
              // 看全部時在分組交界插一條標示，現場才知道哪裡是第二車的開頭。
              const prev = i > 0 ? shown[i - 1] : undefined
              // 第一列也要有標題：把 prev 的分組當成 null 的話，開頭那一段
              // 「沒有分車的人」就永遠沒有標題——兩個顧車的志工會同時漏掉他們。
              const divider =
                group === null && groupList.length > 0 && (i === 0 || m.group_label !== prev?.group_label)
              return (
                <Fragment key={m.id}>
                  {divider && (
                    <div class="group-divider">{m.group_label ?? t('ungrouped')}</div>
                  )}
                  <MemberRow
                    member={m}
                    showGroup={duplicated.has(m.name)}
                    closed={closed}
                    editing={editing && isOwner.value}
                    editingThis={editingId === m.id}
                    onToggle={() => { void toggle(m) }}
                    onEdit={() => setEditingId(m.id)}
                    onSave={(name, note) => { void saveMember(m, name, note) }}
                    onRemove={() => setRemoving(m)}
                  />
                </Fragment>
              )
            })
          )}
        </div>
      </div>

      {/*
        底部動作列（2026-09 回來）。裝的是一場活動的三個時刻：開場把代碼發出去、
        現場有人臨時要加、車開了收尾。它們原本都在「更多」選單裡，每一次都要先
        開一層才按得到——而這三顆正好是在人擠在車門口、手裡還拿著名單的時候按的。

        2026-08 曾經拿掉底部動作列，那時候兩個槽位裝的是「只看未到」（跟篩選列
        重複）與「複製結果」（一場按一次，而且不急）。這一次裝的東西不一樣：三顆
        都是別的地方按不到的動作，也都不是可以慢慢找的。

        主要按鈕一顆都不放：這個畫面的主要動作是戳名字，動作列上放一顆搶眼的鍵
        只會在收尾之前一直誘導誤觸。
      */}
      {/* 協助者在點名模式下沒有動作列可放的東西（結束點名是主揪的事），那就
          不要留一條空的橫條佔掉一列人名。 */}
      {(editing || isOwner.value) && (
      <div class="dock dock-roll">
        <div class="dock-inner">
          {editing ? (
            /*
              編輯時整條動作列只剩一顆「＋」。加人與刪人是同一件事的兩個方向，
              擺在同一個模式裡才對得起來：右邊的叉叉拿掉人，底下的加號補上人。
              協助者也按得到——站在車門口把臨時來的人補進去是他們的日常。
            */
            <button class="btn btn-block" onClick={() => setSheet('walkin')} aria-label={t('addWalkIn')}>
              <IconPlus />
            </button>
          ) : (
            <button
              class="btn btn-block"
              // 重新開啟不是破壞性動作，直接做；結束才要走流程。
              onClick={() => { if (closed) { void setClosed(false) } else { setConfirmFinish(true) } }}
            >
              {closed ? t('reopenRoom') : t('finishRound')}
            </button>
          )}
        </div>
      </div>
      )}

      {/*
        「車開了」是唯一一次所有人的注意力同時落在同一件事上，也是唯一一次能把
        結果送出去的機會。以前收尾被拆成三個彼此無關的按鈕（複製結果在計分區、
        下載 CSV 在面板第一項、關閉空間在第九項），結果多數空間從未被關閉也從未
        被匯出，30 天後靜靜消失。把結果攤在確認鍵前面，順手就交出去了。
      */}
      {confirmFinish && current && (
        <ConfirmDialog
          title={t('finishRound')}
          /* 單機模式下「複製結果／CSV」不是「帶去別的地方」，是**唯一的備份**
             ——iOS 七天後會把這支手機上的名單清掉（iOS 評估 §3.2）。
             「紀錄還在」那句話在那個情境下是不成立的，所以換一句。 */
          body={connection.value === 'local-only' ? t('finishRoundBodyLocal') : t('finishRoundBody')}
          confirmLabel={t('finishRound')}
          onClose={() => setConfirmFinish(false)}
          onConfirm={() => { void setClosed(true) }}
        >
          <pre class="result-preview">{toShareText(current, all, prefs.value.lang)}</pre>
          <ResultActions
            onCopy={() => { void copySummary() }}
            onCsv={() => downloadFile(csvFilename(current), toCsv(all, prefs.value.lang))}
          />
        </ConfirmDialog>
      )}

      {sheet === 'manage' && (
        <ManageSheet
          owner={isOwner.value}
          initialMode={menuMode}
          onEdit={() => { startEditing(); setSheet(null) }}
          onClose={() => { setSheet(null); setMenuMode(undefined) }}
        />
      )}
      {sheet === 'walkin' && <AddWalkInSheet group={group} onClose={() => setSheet(null)} />}

      {/*
        從名單移除是這個畫面上唯一不可復原、而且會同步到所有裝置的動作，
        所以就算已經先進了編輯模式，還是要問一次。
      */}
      {removing && (
        <ConfirmDialog
          title={t('confirmRemoveMemberTitle', { name: removing.name })}
          body={t('confirmRemoveMemberBody')}
          confirmLabel={t('remove')}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() => { const m = removing; setRemoving(null); void remove(m) }}
        />
      )}
    </>
  )
}

/**
 * 把這一場的結果交出去的三種格式：貼進 LINE、進試算表、存成檔案。
 *
 * 它們 2026-09 從「更多 › 匯出名單」那張子畫面搬到這裡，而且只出現在收尾的兩個
 * 時刻——結束點名的確認鍵前面（決定之前）、結束之後的橫幅（決定之後）。以前
 * 「匯出名單」是選單裡一列要自己想起來去按的東西，而多數空間從未被匯出，30 天
 * 後靜靜消失；「車開了」是唯一一次所有人的注意力同時落在同一件事上，這三顆就
 * 該待在那一刻的必經之路上。
 *
 * 兩個地方共用同一份實作，而且是**同一個尺寸**（`.btn-sm`，2026-09）。它以前在
 * 對話框裡是一般的 `.btn`，於是那張對話框上有四顆一模一樣重的按鈕排成兩列——
 * 「複製／CSV」跟「取消／結束點名」看起來是同一組四選一。帶得走的兩種格式是
 * 順手做的事，要做的決定只有底下那一個，所以它們讓一階。
 *
 * **只有兩顆**（2026-09）。曾經有第三顆「存成 PDF」，它其實不是檔案匯出，是叫出
 * 瀏覽器的列印畫面讓使用者自己選「儲存為 PDF」——帶走的東西比 CSV 少（沒有時間、
 * 沒有誰點的），卻要多一行字解釋自己，在手機上還要多繞兩三步。它連同整套列印
 * 版面一起拿掉了。剩下的兩顆是兩件不一樣的事：**現在交出去**（貼進 LINE）與
 * **留一份紀錄**（八欄的 CSV：時間、誰點的、電話、攜伴、分組、備註）。
 *
 * **畫面上印短的，無障礙名稱印完整的**：在「先把結果帶走：」與一段結果預覽底下，
 * 「複製／CSV」讀得出來的意思跟完整標籤一模一樣。短標籤是完整標籤的子字串，螢幕
 * 閱讀器唸到的仍然是完整那一句（WCAG 2.5.3 label in name）。
 */
function ResultActions({ onCopy, onCsv }: {
  onCopy: () => void
  onCsv: () => void
}) {
  const t = useT()
  return (
    <div class="result-actions">
      <button class="btn btn-sm" onClick={onCopy} aria-label={t('copySummary')}>
        <IconCopy /> {t('copySummaryShort')}
      </button>
      <button class="btn btn-sm" onClick={onCsv} aria-label={t('exportCsv')}>
        <IconDownload /> {t('exportCsvShort')}
      </button>
    </div>
  )
}

/** 載入時顯示即將出現的形狀，比一句「載入中」更能讓人知道在等什麼。 */
function RoomSkeleton({ label }: { label: string }) {
  return (
    <div class="shell" role="status" aria-busy="true" aria-label={label}>
      <span class="sr-only">{label}</span>
      <div class="list" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <div class="skeleton-row" key={i} />)}
      </div>
    </div>
  )
}

/**
 * 篩選列的一段。**數字是這一段的主體**，標籤只是它的單位。
 *
 * `tone` 只給「未到」那一段用：它整場都帶顏色（琥珀），歸零的那一刻轉綠。原則一
 * 說「畫面上最大的數字永遠是還有幾位沒到」，而計分區拿掉之後這裡就是那個數字
 * 唯一的家——它不能長得跟旁邊兩個一樣。
 */
function Segment({ active, onClick, label, count, tone }: {
  active: boolean; onClick: () => void; label: string; count: number
  tone?: 'pending' | 'done'
}) {
  const cls = tone === 'pending' ? 'count count-pending'
    : tone === 'done' ? 'count count-done'
    : 'count'
  return (
    <button class="segment" aria-pressed={active} onClick={onClick}>
      {label} <span class={cls}>{count}</span>
    </button>
  )
}

function MemberRow({
  member, closed, showGroup, editing, editingThis, onToggle, onEdit, onSave, onRemove,
}: {
  member: Member
  closed: boolean
  showGroup: boolean
  /** 編輯模式：右邊那格換成叉叉，戳名字改成編輯這一列。 */
  editing: boolean
  /** 正在改的就是這一列：名字與備註換成輸入框。 */
  editingThis: boolean
  onToggle: () => void
  onEdit: () => void
  onSave: (name: string, note: string) => void
  onRemove: () => void
}) {
  const t = useT()
  const nameRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLInputElement>(null)
  const cls = `member${member.status === 'arrived' ? ' is-arrived' : ''}${editing ? ' is-editing' : ''}`
  const time = member.status_at ? formatTime(member.status_at) : null

  // 名單裡有同名的人時（showGroup），這一列要多給一點辨識用的資訊。分車最
  // 有用；沒有分車就用電話尾四碼——那是現場唯一問得出來的東西。
  const tell = showGroup
    ? member.group_label ?? (member.phone ? t('phoneTail', { tail: member.phone.slice(-4) }) : null)
    : null

  /*
    撥號。號碼有兩個來源：舊名單留下的結構化 phone 欄位，以及備註裡的一串數字
    ——解析階段刻意不判斷任何一串數字是什麼（見 parse.ts 的 NAME_TAIL），那個
    判斷改在這裡做，因為**顯示層猜錯是可逆、可見的**（多一顆鍵，備註原文一字
    未動），而存進資料庫的假號碼是看不見的。

    2026-09 之後這顆鍵長在備註那一行的號碼後面，不再是列右邊獨立的一格：
    備註本來就印出來了，號碼就在那行字裡，撥號鍵貼著它才對得起來。
  */
  const dialable = member.phone ?? dialableFrom(member.note)[0] ?? null

  /*
    這一列正在被改：名字與備註各一個輸入框，離開就存。

    兩個框都是**非受控**的（`defaultValue` ＋ ref 讀值），而不是把值放進 state
    或閉包變數：這個畫面每 15 秒會對帳一次，只要那時候重新 render，受控的
    `value` 就會把使用者正在打的字蓋回伺服器上的舊名字。
  */
  if (editingThis) {
    /*
      焦點從姓名跳到備註時**不能**收起來：那兩個框是同一件事的兩半，中間按一下
      Tab 就結束編輯的話，備註永遠改不到。所以只有焦點真的離開這一列才存檔。
    */
    const commit = (e: JSX.TargetedFocusEvent<HTMLInputElement>) => {
      const row = e.currentTarget.closest('.member')
      const next = e.relatedTarget
      if (row && next instanceof Node && row.contains(next)) return
      onSave(nameRef.current?.value ?? member.name, noteRef.current?.value ?? '')
    }
    return (
      <div class={cls} role="listitem">
        <div class="member-main member-edit">
          <span class="check" aria-hidden="true"><IconCheck /></span>
          <span class="member-body">
            <input
              ref={nameRef}
              class="member-name-input"
              autofocus
              defaultValue={member.name}
              maxLength={60}
              aria-label={t('nameLabel')}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
              onBlur={commit}
            />
            <input
              ref={noteRef}
              class="member-note-input"
              defaultValue={member.note ?? ''}
              maxLength={200}
              placeholder={t('noteLabel')}
              aria-label={t('noteLabel')}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
              onBlur={commit}
            />
          </span>
        </div>

        <div class="member-side">
          <button class="icon-btn" onClick={onRemove} aria-label={`${t('removeMember')}：${member.name}`}>
            <IconClose />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div class={cls} role="listitem">
      <button
        class="member-main"
        onClick={editing ? onEdit : onToggle}
        disabled={closed && !editing}
        aria-pressed={editing ? undefined : member.status === 'arrived'}
        aria-label={editing
          ? `${t('edit')}：${member.name}`
          : `${member.name} · ${member.status === 'arrived' ? t('markMissing') : t('markArrived')}`}
      >
        <span class="check"><IconCheck /></span>
        <span class="member-body">
          <span class="member-name">{member.name}</span>
          {/*
            備註當副標題印在名字底下（2026-09）。它曾經只在紙本上出現，理由是
            長度不受控會撐開行高、吃掉「80 人一屏看得到幾個人」的預算——那個
            代價還在（有備註的列高一行），換到的是「誰坐輪椅、誰只到中午」
            不必點開任何東西就看得到，而那正是備註被寫下來的原因。
          */}
          {member.note && (
            <span class="member-note">
              {member.note}
              {dialable && (
                /*
                  撥號鍵貼在號碼後面。列右邊那一格 2026-09 讓給編輯模式的叉叉，
                  而「看到未到 → 打電話」是收尾唯一的下一步，不能沒有入口。
                  stopPropagation：這顆鍵疊在整片可點的名單列上，不擋的話按下去
                  會先把人標成已到再撥號。
                */
                <a
                  class="note-call"
                  href={telHref(dialable)}
                  aria-label={t('callMember', { name: member.name })}
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconPhone size={16} />
                </a>
              )}
            </span>
          )}
          {/*
            分車／電話尾碼（只在名單裡有同名的人時）與攜伴。這兩樣是**這個人的
            屬性**，不隨點名改變——所以它們留在名字底下，而「誰在幾點標記的」
            搬到列的右邊（見下面 .member-when）。都沒有的時候整個元素不渲染，
            不留一個會撐出行高的空 span。
          */}
          {(tell || member.companions > 0) && (
            <span class="member-meta">
              {tell && <span class="chip chip-tell">{tell}</span>}
              {member.companions > 0 && (
                <span class="chip chip-count">{t('withCompanions', { n: member.companions })}</span>
              )}
            </span>
          )}
        </span>
        {/*
          「誰在幾點標記的」印在列的右邊，不是名字底下多一行（2026-09）。

          它以前跟在屬性後面當第三行，於是**點一個人就會讓那一列長高一行**——
          80 人的名單點到一半，整份名單被自己推長，捲動位置也跟著跑。右邊那一格
          在點名模式下本來就是空的（編輯模式才長出叉叉），而「幾點」是一個右對齊
          讀起來最自然的東西。

          它只在已到時出現，所以未到的列一格都沒有多長。
        */}
        {member.status === 'arrived' && time && (
          <span class="member-when">
            {member.status_by ? t('checkedBy', { name: member.status_by, time }) : t('at', { time })}
          </span>
        )}
      </button>


      {editing && (
        <div class="member-side">
          <button class="icon-btn" onClick={onRemove} aria-label={`${t('removeMember')}：${member.name}`}>
            <IconClose />
          </button>
        </div>
      )}
    </div>
  )
}

function SyncBadge() {
  const t = useT()
  const state = connection.value
  const pending = pendingUploads.value

  const map = {
    online: ['sync-online', t('syncOnline')],
    offline: ['sync-offline', pending > 0 ? `${t('syncOffline')} · ${t('syncPending', { n: pending })}` : t('syncOffline')],
    syncing: ['sync-syncing', pending > 0 ? t('syncPending', { n: pending }) : t('syncSyncing')],
    'local-only': ['sync-local', t('syncLocalOnly')],
  } as const

  const [cls, label] = map[state]
  /*
    畫面上只有一顆圓點（2026-09，副標那一行拿掉之後）。

    這個指示整場都在，但它整場都不該被讀——真正要傳達的是「顏色變了」，而
    「已同步」三個字在 99% 的時間裡只是重複一件沒有變化的事。完整的說法留在
    aria-label／title：螢幕閱讀器唸得到，桌機 hover 得出來。
    **例外是待上傳筆數**：那是一個會變的數字，而且它變大就代表有東西還沒送出
    去——那時候圓點旁邊多一個數字，不然「還有幾筆沒上傳」就沒有地方說了。
  */
  return (
    <span class={`sync ${cls}`} role="status" aria-label={label} title={label}>
      <span class="sync-dot" />
      {pending > 0 && <span class="sync-n">{pending}</span>}
    </span>
  )
}
