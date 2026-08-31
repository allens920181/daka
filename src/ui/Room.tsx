import { Fragment } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  connection, enterRoom, groups, isOwner, leaveRoom, members, pendingUploads,
  room, setStatusWithUndo, showToast,
} from '../lib/store'
import { summarize } from '../lib/merge'
import type { Member, MemberStatus } from '../lib/types'
import { toShareText } from '../lib/export'
import { formatTime } from '../lib/format'
import { navigate } from '../router'
import { errorMessage } from './NewRoom'
import { AddWalkInSheet, ManageSheet, MemberSheet, ShareSheet } from './Sheets'
import { IconBack, IconCheck, IconCopy, IconMore, IconPhone, IconShare } from './icons'
import { useT } from './t'

type Filter = 'all' | 'pending' | 'arrived' | 'excused'
type OpenSheet = null | 'share' | 'manage' | 'walkin' | { member: Member }

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
  // 計分區捲出畫面時，頂欄接手顯示未到人數——這個數字不能消失。
  const scoreboardRef = useRef<HTMLDivElement>(null)
  const [scoreVisible, setScoreVisible] = useState(true)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    enterRoom(code)
      .then(() => { if (alive) setStatus('ready') })
      .catch((e: unknown) => {
        if (!alive) return
        setError(errorMessage(e, t))
        setStatus('error')
      })
    return () => { alive = false; leaveRoom() }
    // t 隨語言變動，但重新進房沒有意義；只依 code。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useEffect(() => {
    const el = scoreboardRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setScoreVisible(Boolean(e?.isIntersecting)), {
      rootMargin: '-56px 0px 0px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [status])

  const current = room.value
  const all = members.value
  const groupList = groups.value
  const closed = Boolean(current?.closed_at)

  // 選了分組之後就不存在了的分組（名單被換掉），自動退回全部。
  useEffect(() => {
    if (group && !groupList.includes(group)) setGroup(null)
  }, [group, groupList])

  const scoped = useMemo(
    () => (group === null ? all : all.filter((m) => m.group_label === group)),
    [all, group],
  )
  const s = useMemo(() => summarize(scoped), [scoped])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scoped.filter((m) => {
      if (filter === 'pending' && m.status !== 'pending') return false
      if (filter === 'arrived' && m.status !== 'arrived') return false
      if (filter === 'excused' && m.status !== 'excused') return false
      if (!q) return true
      return m.name.toLowerCase().includes(q) || (m.phone ?? '').includes(q)
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
    await navigator.clipboard.writeText(toShareText(current, all, group))
    showToast(t('summaryCopied'))
  }

  // 分母是「今天該到的人頭」而不是名單總人頭：請假的人不該讓進度條永遠差一截。
  const progress = s.expectedHeadcount === 0 ? 0 : (s.arrivedHeadcount / s.expectedHeadcount) * 100
  // 空名單不是「全部到齊」，只是還沒有人。
  const allHere = s.people > 0 && s.pending === 0

  return (
    <>
      <div class="topbar">
        <div class="shell topbar-inner">
          <button class="icon-btn" onClick={() => navigate('/')} aria-label={t('back')}>
            <IconBack />
          </button>
          <div class="topbar-title">
            <div class="topbar-name">{current.name}</div>
            <div class="topbar-sub">
              {scoreVisible ? (
                <span class="mono">{current.code}</span>
              ) : (
                <span class={allHere ? 'topbar-count done' : 'topbar-count'}>
                  {group !== null && <span class="topbar-scope">{group}</span>}
                  {allHere ? t('allHere') : t('missingCount', { n: s.pending })}
                </span>
              )}
              <SyncBadge />
            </div>
          </div>
          <button class="icon-btn" onClick={() => setSheet('share')} aria-label={t('share')}>
            <IconShare />
          </button>
          <button class="icon-btn" onClick={() => setSheet('manage')} aria-label={t('manage')}>
            <IconMore />
          </button>
        </div>
      </div>

      <div class="shell">
        {closed && <p class="banner banner-warn" style="margin-top:12px">{t('roomClosed')}</p>}

        <div class="scoreboard" ref={scoreboardRef}>
          <div class="score-main">
            {allHere ? (
              // 全部到齊時不印那顆「0」：44px 的 0 配上「全部到齊」會讓人愣一下。
              <span class="score-number score-done">{t('allHere')}</span>
            ) : (
              <>
                <span class="score-number">{s.pending}</span>
                <span class="score-text">
                  <span class="score-label">{t('missingUnit')}</span>
                  {group !== null && <span class="score-scope">{group}</span>}
                </span>
              </>
            )}
          </div>
          <span class="score-heads">
            {t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}
          </span>
        </div>

        <div class="progress-row">
          <div
            class="progress"
            role="progressbar"
            aria-label={t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div class="progress-fill" style={`width:${progress}%`} />
          </div>
          <button class="btn btn-sm" onClick={() => { void copySummary() }}>
            <IconCopy /> {t('copySummary')}
          </button>
        </div>

        {groupList.length > 0 && (
          <div class="groups" role="group" aria-label={t('group')}>
            <button
              class="group-chip"
              aria-pressed={group === null}
              onClick={() => setGroup(null)}
            >
              {t('allGroups')}
            </button>
            {groupList.map((g) => {
              const gs = summarize(all.filter((m) => m.group_label === g))
              return (
                <button
                  key={g}
                  class="group-chip"
                  aria-pressed={group === g}
                  onClick={() => setGroup(g)}
                  aria-label={t('groupCount', { name: g, arrived: gs.arrived, total: gs.people })}
                >
                  {g}
                  <span class={gs.pending === 0 ? 'group-n done' : 'group-n'}>{gs.pending}</span>
                </button>
              )
            })}
          </div>
        )}

        <div class="segmented" role="group" aria-label={t('all')}>
          <Segment active={filter === 'all'} onClick={() => setFilter('all')} label={t('all')} count={s.people} />
          <Segment active={filter === 'pending'} onClick={() => setFilter('pending')} label={t('missing')} count={s.pending} />
          <Segment active={filter === 'arrived'} onClick={() => setFilter('arrived')} label={t('arrived')} count={s.arrived} />
          {s.excused > 0 && (
            <Segment active={filter === 'excused'} onClick={() => setFilter('excused')} label={t('excused')} count={s.excused} />
          )}
        </div>

        <div class="search-wrap">
          <input
            class="input"
            type="search"
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
          {query && (
            <button class="search-clear" onClick={() => setQuery('')} aria-label={t('cancel')}>×</button>
          )}
        </div>

        <div class="list">
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
                    {s.pending > 0 ? t('emptySearchHint', { n: s.pending }) : t('emptySearchHintDone')}
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
              const divider =
                group === null && groupList.length > 0 && m.group_label !== (prev?.group_label ?? null)
              return (
                <Fragment key={m.id}>
                  {divider && (
                    <div class="group-divider">{m.group_label ?? t('ungrouped')}</div>
                  )}
                  <MemberRow
                    member={m}
                    showGroup={false}
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

      <div class="dock">
        <div class="dock-inner">
          <button class="btn btn-primary btn-block" onClick={() => setSheet('share')}>
            <IconShare /> {t('share')}
          </button>
          <button class="btn" disabled={closed} onClick={() => setSheet('walkin')}>
            {t('addWalkIn')}
          </button>
        </div>
      </div>

      {sheet === 'share' && <ShareSheet code={current.code} onClose={() => setSheet(null)} />}
      {sheet === 'manage' && (
        <ManageSheet owner={isOwner.value} onClose={() => setSheet(null)} />
      )}
      {sheet === 'walkin' && <AddWalkInSheet onClose={() => setSheet(null)} />}
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
      <div class="scoreboard"><span class="sr-only">{label}</span></div>
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

  return (
    <div class={cls}>
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
            {showGroup && member.group_label && (
              <span class="chip chip-note">{member.group_label}</span>
            )}
            {member.companions > 0 && (
              <span class="chip chip-count">{t('withCompanions', { n: member.companions })}</span>
            )}
            {member.note && <span class="chip chip-note">{member.note}</span>}
            {member.status === 'arrived' && time && (
              <span>{member.status_by ? t('checkedBy', { name: member.status_by, time }) : t('at', { time })}</span>
            )}
            {member.status === 'excused' && <span>{t('excused')}</span>}
          </span>
        </span>
      </button>

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
  return (
    <span class={`sync ${cls}`}>
      <span class="sync-dot" />
      {label}
    </span>
  )
}
