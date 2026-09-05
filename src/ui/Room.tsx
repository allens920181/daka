import { Fragment } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  connection, enterRoom, groups, isOwner, leaveRoom, members, pendingUploads,
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
import { ConfirmDialog } from './Sheet'
import { AddWalkInSheet, ManageSheet } from './Sheets'
import { IconBack, IconCheck, IconClose, IconCopy, IconDownload, IconMore, IconPhone, IconPlus } from './icons'
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
        <p class="note note-warn">{error}</p>
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
              <div class="topbar-sub">
              {/*
                身分標籤本來在管理面板頂端那一列。「我是主揪還是協助者」決定
                這個畫面上哪些事做得動（編輯名單、結束點名都只有主揪能做），
                是進空間第一眼就該知道的事，不該要先點開管理面板才看得到。
                排在代碼前面：代碼與同步狀態講的是「這是哪個空間、連上了沒」，
                身分講的是「我」，順序從人到空間再到連線。
              */}
              <span class={isOwner.value ? 'tag tag-owner' : 'tag'}>
                {isOwner.value ? t('owner') : t('helper')}
              </span>
              {closed ? (
                // 關閉是全域狀態，不能只靠一條會捲走的橫幅。捲到名單深處時
                // 戳名字沒反應，協助者完全不知道為什麼。
                <span class="topbar-count closed">{t('roomClosedShort')}</span>
              ) : (
                <span class="mono">{current.code}</span>
              )}
              <SyncBadge />
              </div>
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
              <h1 class="topbar-name">{current.name}</h1>
              <div class="topbar-sub">
              {/*
                身分標籤本來在管理面板頂端那一列。「我是主揪還是協助者」決定
                這個畫面上哪些事做得動（編輯名單、結束點名都只有主揪能做），
                是進空間第一眼就該知道的事，不該要先點開管理面板才看得到。
                排在代碼前面：代碼與同步狀態講的是「這是哪個空間、連上了沒」，
                身分講的是「我」，順序從人到空間再到連線。
              */}
              <span class={isOwner.value ? 'tag tag-owner' : 'tag'}>
                {isOwner.value ? t('owner') : t('helper')}
              </span>
              {closed ? (
                // 關閉是全域狀態，不能只靠一條會捲走的橫幅。捲到名單深處時
                // 戳名字沒反應，協助者完全不知道為什麼。
                <span class="topbar-count closed">{t('roomClosedShort')}</span>
              ) : (
                <span class="mono">{current.code}</span>
              )}
              <SyncBadge />
              </div>
            </button>
          )}
          {/*
            頂欄只剩一顆動作鍵。分享搬進「更多」的分享分頁——它整場只用一次
            （開場把代碼發出去），卻長期佔著頂欄兩顆位置的其中一顆；而頂欄的
            位置要留給「一直都要按得到」的東西。
          */}
          {/*
            編輯時這顆變成「完成」。編輯模式沒有自己的頂欄，也不該有——它改的
            就是眼前這份名單，離開的路要留在原地，而不是另外長一條。
          */}
          {editing ? (
            <button class="btn btn-sm" onClick={() => setEditing(false)}>{t('done')}</button>
          ) : (
            <button class="icon-btn" onClick={() => setSheet('manage')} aria-label={t('manage')}>
              <IconMore />
            </button>
          )}
        </div>
        {/*
          搜尋框長在頂欄裡，一直顯示，不是點了才展開。
          三個理由，都是量出來的／試出來的：80 人的名單首屏只看得到 5 個人名，
          而搜尋框連間距吃掉 76px（正好一列人名）；它原本會跟著名單捲走——真正
          需要搜尋的時刻是你已經捲過 60 個人、有人報上名字，那時要用它得先捲回
          17 個螢幕（roll-call.md 的「頂欄標題可點回到頂端」就是為了這件事）；
          而且它整場反覆在用，多一次「先點開才能打字」是白白多出來的一步。
          頂欄是 sticky，搬進來、一直開著，三個問題一起消失。

          不自動聚焦：一進房間就跳出虛擬鍵盤會蓋掉半個畫面，而這裡不像過去
          「按一下才展開」那樣是使用者剛做出的明確動作。

          有字才亮（.is-on）：搜尋框一直開著，:focus 那圈只在打字的當下看得到，
          點開別人的成員面板、或只是滑走去點名之後，框就退回跟平常一樣的灰底，
          畫面上完全沒有東西說「名單現在是過濾過的」。名單本身也不會說——空
          名單那句「這裡沒有人」跟「太好了全部都到了」長得不一樣，但沒清空
          搜尋字之前只看得到過濾後的幾個人，很容易誤讀成「全部都到了」。
          鍵的是 query.trim()，跟真正觸發過濾的判準（見 shown 那段 useMemo）
          同一條，而不是原始的 query——只打了空白鍵不該亮。
        */}
        <div class="shell search-wrap">
          <input
            class={query.trim() ? 'input is-on' : 'input'}
            type="search"
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQuery(''); (e.currentTarget as HTMLInputElement).blur() }
            }}
          />
          {query && (
            <button class="search-clear" onClick={() => setQuery('')} aria-label={t('cancel')}>×</button>
          )}
        </div>

        {/*
          篩選留在頂欄裡，和搜尋框同一個理由：頂欄是 sticky。

          計分區（44px 的大字＋「8 / 9 人」＋進度條）拿掉之後，「未到 N」就是
          畫面上唯一回答「還有幾個沒到」的東西——它不能跟著名單捲走。以前那個
          數字靠「計分區捲出畫面時頂欄接手」來續命，現在不需要那套機關了：它
          本來就一直在畫面上。
          省下的高度全部變成人名：首屏本來有 45–50% 被控制項吃掉。
        */}
        <div class="shell">
          <div class="segmented" role="group" aria-label={t('filter')}>
            <Segment active={filter === 'all'} onClick={() => setFilter('all')} label={t('all')} count={s.people} />
            <Segment active={filter === 'pending'} onClick={() => setFilter('pending')} label={t('missing')} count={s.pending} />
            <Segment active={filter === 'arrived'} onClick={() => setFilter('arrived')} label={t('arrived')} count={s.arrived} />
          </div>
        </div>
      </div>

      <div class="shell">
        {/*
          紙本備援的抬頭。只在列印時出現。
          以前列印是把螢幕的計分區借來當標題，於是紙上印的是「還有 12 位沒到」
          ——一個離開印表機就過期的數字，而真正需要的活動名稱與代碼反而被
          display:none 掉了。手機沒電時拿著這張紙的人要知道：這是哪一場、
          代碼多少、誰在點、幾號。
        */}
        <div class="print-head" aria-hidden="true">
          <h1 class="print-title">{current.name}</h1>
          <p class="print-meta">
            <span>{t('roomCode')}：{current.code}</span>
            <span>{t('printTotal', { people: s.people, heads: s.expectedHeadcount })}</span>
            {group !== null && <span>{groupLabel}</span>}
          </p>
          <p class="print-blanks">{t('printBlanks')}</p>
        </div>

        {/*
          結束之後橫幅印的是定格的結果，不是一句「這個空間已關閉」——那時候要
          回答的問題已經不是「還能不能點」，而是「這一場最後是幾個人」。
          再附一顆「複製結果」，因為結束之後才想到要貼回 LINE 是常態。
        */}
        {closed && (
          <div class="banner banner-warn banner-result" style="margin-top:12px">
            <span class="banner-result-text">
              {t('closedResult', {
                summary: allHere
                  ? `${t('allHere')} · ${t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}`
                  : `${t('missingCount', { n: s.pendingHeadcount })} · ${t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}`,
              })}
            </span>
            <button class="btn btn-sm" onClick={() => { void copySummary() }}>
              <IconCopy /> {t('copySummary')}
            </button>
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
                    onToggle={() => { void toggle(m) }}
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
            <>
              <button
                class="btn btn-block"
                onClick={() => { setMenuMode('invite'); setSheet('manage') }}
              >
                {t('invite')}
              </button>

              {isOwner.value && (
                <button
                  class="btn btn-block"
                  // 重新開啟不是破壞性動作，直接做；結束才要走流程。
                  onClick={() => { if (closed) { void setClosed(false) } else { setConfirmFinish(true) } }}
                >
                  {closed ? t('reopenRoom') : t('finishRound')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        「車開了」是唯一一次所有人的注意力同時落在同一件事上，也是唯一一次能把
        結果送出去的機會。以前收尾被拆成三個彼此無關的按鈕（複製結果在計分區、
        下載 CSV 在面板第一項、關閉空間在第九項），結果多數空間從未被關閉也從未
        被匯出，30 天後靜靜消失。把結果攤在確認鍵前面，順手就交出去了。
      */}
      {confirmFinish && current && (
        <ConfirmDialog
          title={t('finishRound')}
          body={t('finishRoundBody')}
          confirmLabel={t('finishRound')}
          onClose={() => setConfirmFinish(false)}
          onConfirm={() => { void setClosed(true) }}
        >
          <pre class="result-preview">{toShareText(current, all, prefs.value.lang)}</pre>
          <div class="row" style="margin-bottom:12px">
            <button class="btn btn-block" onClick={() => { void copySummary() }}>
              <IconCopy /> {t('copySummary')}
            </button>
            <button
              class="btn btn-block"
              onClick={() => downloadFile(csvFilename(current), toCsv(all, prefs.value.lang))}
            >
              <IconDownload /> {t('exportCsv')}
            </button>
          </div>
        </ConfirmDialog>
      )}

      {sheet === 'manage' && (
        <ManageSheet
          owner={isOwner.value}
          initialMode={menuMode}
          onCopySummary={() => { void copySummary() }}
          onEdit={() => { setNameDraft(current.name); setEditing(true); setSheet(null) }}
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

function Segment({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count: number
}) {
  return (
    <button class="segment" aria-pressed={active} onClick={onClick}>
      {label} <span class="count mono">{count}</span>
    </button>
  )
}

function MemberRow({ member, closed, showGroup, editing, onToggle, onRemove }: {
  member: Member
  closed: boolean
  showGroup: boolean
  /** 編輯模式：右邊那格換成叉叉，戳名字不再改狀態。 */
  editing: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const t = useT()
  const cls = `member${member.status === 'arrived' ? ' is-arrived' : ''}`
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

    它 2026-09 從成員面板搬回這一列：那張面板整個拿掉了，而「看到未到 → 打電話」
    是收尾時唯一的下一步，不能跟著面板一起消失。
  */
  const dialable = member.phone ?? dialableFrom(member.note)[0] ?? null

  return (
    <div class={cls} role="listitem">
      <button
        class="member-main"
        onClick={onToggle}
        disabled={closed || editing}
        aria-pressed={member.status === 'arrived'}
        aria-label={`${member.name} · ${member.status === 'arrived' ? t('markMissing') : t('markArrived')}`}
      >
        <span class="check"><IconCheck /></span>
        <span class="member-body">
          <span class="member-name">{member.name}</span>
          <span class="member-meta">
            {tell && <span class="chip chip-tell">{tell}</span>}
            {member.companions > 0 && (
              <span class="chip chip-count">{t('withCompanions', { n: member.companions })}</span>
            )}
            {/*
              備註原文不顯示在螢幕上：這一列只留住「哪一個人」（辨識晶片）與
              「現在什麼狀態」，備註本身長度不受控，印在這裡會把行高撐開，破壞
              80 人名單一屏看幾個人的預算。.chip-note 用 CSS 在螢幕上關掉
              （見 styles.css 的 `.member .chip-note`），但紙本上要留著：手機
              沒電時拿著這張紙的人只有那張紙，理由跟 .print-phone 一樣。
            */}
            {member.note && <span class="chip chip-note">{member.note}</span>}
            {member.status === 'arrived' && time && (
              <span>{member.status_by ? t('checkedBy', { name: member.status_by, time }) : t('at', { time })}</span>
            )}
          </span>
        </span>
      </button>

      {/* 紙本上要看得到電話：收尾時「看到未到 → 打電話」是唯一的下一步，
          而螢幕上電話只做成 tel: 圖示按鈕，列印時整個 .member-side 會被藏起來。 */}
      {dialable && <span class="print-phone" aria-hidden="true">{dialable}</span>}

      <div class="member-side">
        {editing ? (
          <button class="icon-btn" onClick={onRemove} aria-label={`${t('removeMember')}：${member.name}`}>
            <IconClose />
          </button>
        ) : (
          dialable && member.status === 'pending' && (
            <a
              class="icon-btn call-btn"
              href={telHref(dialable)}
              aria-label={t('callMember', { name: member.name })}
            >
              <IconPhone />
            </a>
          )
        )}
      </div>
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
  // 頂欄接手顯示未到人數時空間會不夠，文字收起來只留圓點——但無障礙名稱要
  // 留著，而且點名人數才是那一刻不能被擠掉的東西。
  return (
    <span class={`sync ${cls}`} role="status" aria-label={label} title={label}>
      <span class="sync-dot" />
      <span class="sync-text">{label}</span>
    </span>
  )
}
