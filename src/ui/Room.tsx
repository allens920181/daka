import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  connection, enterRoom, isOwner, leaveRoom, members, pendingUploads,
  room, setStatusWithUndo, showToast, summary,
} from '../lib/store'
import type { Member, MemberStatus } from '../lib/types'
import { toShareText } from '../lib/export'
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
  const s = summary.value
  const closed = Boolean(current?.closed_at)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((m) => {
      if (filter === 'pending' && m.status !== 'pending') return false
      if (filter === 'arrived' && m.status !== 'arrived') return false
      if (filter === 'excused' && m.status !== 'excused') return false
      if (!q) return true
      return m.name.toLowerCase().includes(q) || (m.phone ?? '').includes(q)
    })
  }, [all, filter, query])

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
    await navigator.clipboard.writeText(toShareText(current, all))
    showToast(t('summaryCopied'))
  }

  const progress = s.headcount === 0 ? 0 : (s.arrivedHeadcount / s.headcount) * 100

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
                <span class={s.pending === 0 ? 'topbar-count done' : 'topbar-count'}>
                  {s.pending === 0 ? t('allHere') : t('missingCount', { n: s.pending })}
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
            <span class={s.pending === 0 ? 'score-number done' : 'score-number'}>{s.pending}</span>
            <span class="score-label">
              {s.pending === 0 ? t('allHere') : t('missingCount', { n: s.pending })}
            </span>
          </div>
          <span class="score-heads">
            {t('headcount', { arrived: s.arrivedHeadcount, total: s.headcount })}
          </span>
        </div>

        <div class="progress-row">
          <div
            class="progress"
            role="progressbar"
            aria-label={t('headcount', { arrived: s.arrivedHeadcount, total: s.headcount })}
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
              <p class="empty-big">
                {filter === 'pending' && s.people > 0 ? t('emptyMissing') : t('emptyList')}
              </p>
            </div>
          ) : (
            shown.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                closed={closed}
                onToggle={() => { void toggle(m) }}
                onDetail={() => setSheet({ member: m })}
              />
            ))
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

function MemberRow({ member, closed, onToggle, onDetail }: {
  member: Member; closed: boolean; onToggle: () => void; onDetail: () => void
}) {
  const t = useT()
  const cls = `member${member.status === 'arrived' ? ' is-arrived' : ''}${member.status === 'excused' ? ' is-excused' : ''}`
  const time = member.status_at
    ? new Date(member.status_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null

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
