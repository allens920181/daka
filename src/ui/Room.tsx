import { Fragment } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  connection, enterRoom, groups, isOwner, leaveRoom, members, pendingUploads,
  prefs, room, setStatusWithUndo, shareOnEnter, showToast,
} from '../lib/store'
import { summarize } from '../lib/merge'
import { isExcusedNote } from '../lib/parse'
import type { Member, MemberStatus } from '../lib/types'
import { toShareText } from '../lib/export'
import { copyToClipboard } from '../lib/clipboard'
import { formatTime } from '../lib/format'
import { navigate } from '../router'
import { errorMessage } from './NewRoom'
import { AddWalkInSheet, ManageSheet, MemberSheet, ShareSheet } from './Sheets'
import { IconBack, IconCheck, IconCopy, IconMore, IconPhone, IconSearch, IconShare } from './icons'
import { useT } from './t'

type Filter = 'all' | 'pending' | 'arrived' | 'excused'
type OpenSheet = null | 'share' | 'manage' | 'walkin' | { member: Member }

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
  const [searchOpen, setSearchOpen] = useState(false)
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

  // 剛從「再開一個」進來的話，直接把分享面板打開。
  useEffect(() => {
    if (status !== 'ready') return
    if (shareOnEnter.value !== code) return
    shareOnEnter.value = null
    setSheet('share')
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
      if (filter === 'excused' && m.status !== 'excused') return false
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

  async function toggle(m: Member) {
    if (closed) return
    const next: MemberStatus = m.status === 'arrived' ? 'pending' : 'arrived'
    await setStatusWithUndo(
      m.id,
      next,
      (prev) => `${prev.name} · ${next === 'arrived' ? t('arrived') : t('missing')}`,
      t('undo'),
    )
  }

  async function copySummary() {
    if (!current) return
    // scoped 已經是「目前這一車」的名單；標題用看得懂的字，不是內部哨符。
    const ok = await copyToClipboard(toShareText(current, scoped, prefs.value.lang, groupLabel))
    // 剪貼簿在部分瀏覽器需要使用者手勢或權限，失敗時不能靜默——
    // 主揪會以為已經複製好了，貼出去卻是上一次的東西。
    showToast(ok ? t('summaryCopied') : t('copyFailed'))
  }

  // 分母是「今天該到的人頭」而不是名單總人頭：請假的人不該讓進度條永遠差一截。
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
            點頂欄回到頂端。200 人的名單捲到底之後，要回到搜尋框得往上滑
            17 個螢幕——而 overscroll-behavior-y: none 連「用力甩」都擋掉了。
            這是行動裝置的既有慣例（狀態列／標題列回頂），不必再教。
          */}
          <button
            class="topbar-title"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label={t('backToTop')}
          >
            <h1 class="topbar-name">{current.name}</h1>
            <div class="topbar-sub">
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
          <button class="icon-btn" onClick={() => setSheet('share')} aria-label={t('share')}>
            <IconShare />
          </button>
          <button class="icon-btn" onClick={() => setSheet('manage')} aria-label={t('manage')}>
            <IconMore />
          </button>
        </div>
        {/*
          搜尋框長在頂欄裡，不在名單上方。
          兩個理由，都是量出來的：80 人的名單首屏只看得到 5 個人名，而搜尋框
          連間距吃掉 76px（正好一列人名）；而且它原本會跟著名單捲走——真正需要
          搜尋的時刻是你已經捲過 60 個人、有人報上名字，那時要用它得先捲回
          17 個螢幕（roll-call.md 的「頂欄標題可點回到頂端」就是為了這件事）。
          頂欄是 sticky，搬進來之後兩個問題一起消失。
        */}
        {searchOpen && (
          <div class="shell search-wrap">
            <input
              class="input"
              type="search"
              value={query}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              ref={(el) => el?.focus()}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } }}
            />
            {query && (
              <button class="search-clear" onClick={() => setQuery('')} aria-label={t('cancel')}>×</button>
            )}
          </div>
        )}

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
            {s.excused > 0 && (
              <Segment active={filter === 'excused'} onClick={() => setFilter('excused')} label={t('excused')} count={s.excused} />
            )}
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
                    onToggle={() => { void toggle(m) }}
                    onDetail={() => setSheet({ member: m })}
                  />
                </Fragment>
              )
            })
          )}
        </div>
      </div>

      {/*
        搜尋鍵浮在右下角，底部動作列整條拿掉了。

        兩個槽位裝的原本是「只看未到」與「複製結果」。前者在篩選搬進 sticky 頂欄
        之後變成重複的按鈕——它存在的理由本來就是「收尾要按篩選，但你已經捲過
        80 個人，得捲回頂端」，那個理由整條消失了。後者搬進管理面板：一場活動
        按一次，不值得整場佔著一列人名的高度。

        搜尋鍵反過來是整場反覆在用的，而它原本在頂欄右上角——390×844 上單手要跨
        780px 過去。浮在拇指落點是對的位置。

        但**輸入框仍然開在頂欄**（sticky），不跟著鍵盤走：`position: fixed` 的底部
        元素在 iOS 是對著 layout viewport 定位的，鍵盤升起時會蓋住它，於是變成盲打。
        觸發器在下、欄位在上，兩邊的問題都不用碰。
      */}
      <button
        class={searchOpen ? 'fab is-on' : 'fab'}
        onClick={() => setSearchOpen((v) => !v)}
        aria-label={t('searchPlaceholder')}
        aria-expanded={searchOpen}
      >
        <IconSearch />
      </button>

      {sheet === 'share' && <ShareSheet code={current.code} onClose={() => setSheet(null)} />}
      {sheet === 'manage' && (
        <ManageSheet
          owner={isOwner.value}
          group={group}
          onCopySummary={() => { void copySummary() }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'walkin' && <AddWalkInSheet group={group} onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === 'object' && (
        <MemberSheet member={sheet.member} owner={isOwner.value} onClose={() => setSheet(null)} />
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

function MemberRow({ member, closed, showGroup, onToggle, onDetail }: {
  member: Member; closed: boolean; showGroup: boolean; onToggle: () => void; onDetail: () => void
}) {
  const t = useT()
  const cls = `member${member.status === 'arrived' ? ' is-arrived' : ''}${member.status === 'excused' ? ' is-excused' : ''}`
  const time = member.status_at ? formatTime(member.status_at) : null

  // 名單裡有同名的人時（showGroup），這一列要多給一點辨識用的資訊。分車最
  // 有用；沒有分車就用電話尾四碼——那是現場唯一問得出來的東西。
  const tell = showGroup
    ? member.group_label ?? (member.phone ? t('phoneTail', { tail: member.phone.slice(-4) }) : null)
    : null

  // 「陳大同（請假）」這種名單，note 是「請假」而狀態也是請假：兩個都印的話
  // 螢幕上與紙本上都會出現「請假 請假」。狀態自己會說，備註就不必再說一次。
  const noteIsStatus = member.status === 'excused' && isExcusedNote(member.note)

  return (
    <div class={cls} role="listitem">
      <button
        class="member-main"
        onClick={onToggle}
        disabled={closed}
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
            {member.note && !noteIsStatus && <span class="chip chip-note">{member.note}</span>}
            {member.status === 'arrived' && time && (
              <span>{member.status_by ? t('checkedBy', { name: member.status_by, time }) : t('at', { time })}</span>
            )}
            {member.status === 'excused' && <span class="meta-excused">{t('excused')}</span>}
          </span>
        </span>
      </button>

      {/* 紙本上要看得到電話：收尾時「看到未到 → 打電話」是唯一的下一步，
          而螢幕上電話只做成 tel: 圖示按鈕，列印時整個 .member-side 會被藏起來。 */}
      {member.phone && <span class="print-phone" aria-hidden="true">{member.phone}</span>}

      <div class="member-side">
        {member.phone && member.status === 'pending' && (
          <a
            class="icon-btn call-btn"
            href={`tel:${member.phone}`}
            aria-label={t('callMember', { name: member.name })}
          >
            <IconPhone />
          </a>
        )}
        <button class="icon-btn" onClick={onDetail} aria-label={`${member.name} ${t('manage')}`}>
          <IconMore />
        </button>
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
