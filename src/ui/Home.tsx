import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { connection, forgetRecentRoom, myRooms, prefs, recentRooms, session } from '../lib/store'
import { formatDate } from '../lib/format'
import { extractRoomCode, findConfusables, isValidRoomCode, CODE_LENGTH } from '../lib/code'
import { canScanQr } from '../lib/config'
import { isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { IconCamera, IconChevronDown, IconPlus, IconSettings, IconTrash } from './icons'
import { ScanSheet } from './Scan'
import { useT } from './t'

type RoomFilter = 'all' | 'mine' | 'others'

interface RoomRow {
  code: string
  name: string
  isOwner: boolean
  removable: boolean
  meta: ComponentChildren
}

export function Home({ onSettings }: { onSettings: () => void }) {
  const t = useT()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [filter, setFilter] = useState<RoomFilter>('all')
  const codeInputRef = useRef<HTMLInputElement>(null)

  // 按「加入空間」展開輸入框時把焦點直接放進去：不必再點第二下。
  useEffect(() => {
    if (joinOpen) codeInputRef.current?.focus()
  }, [joinOpen])

  function join() {
    const normalized = extractRoomCode(code)
    const confusables = findConfusables(normalized)
    if (confusables.length > 0) {
      setError(t('errConfusable', { chars: confusables.join('、') }))
      return
    }
    if (!isValidRoomCode(normalized)) {
      setError(t('errBadCode'))
      return
    }
    setError(null)
    navigate(`/j/${normalized}`)
  }

  const lang = prefs.value.lang

  // 登入之後「我的活動」與「最近的空間」是兩份各自維護的清單，主揪自己開的空間
  // 兩邊都有——不去重的話首頁會上下相鄰地把同一個空間印兩次。以「我的活動」為準。
  const ownedCodes = new Set(session.value ? myRooms.value.map((r) => r.code) : [])
  const localRooms = recentRooms.value.filter((r) => !ownedCodes.has(r.code))

  const rows: RoomRow[] = [
    ...myRooms.value.map((r) => ({
      code: r.code,
      name: r.name,
      isOwner: true,
      removable: false,
      meta: (
        <>
          <span class="mono">{r.code}</span>
          <span>{formatDate(r.created_at, lang)}</span>
          <span>{t('roomStat', { arrived: r.arrivedHeadcount, total: r.expectedHeadcount })}</span>
        </>
      ),
    })),
    ...localRooms.map((r) => ({
      code: r.code,
      name: r.name,
      isOwner: r.isOwner,
      removable: true,
      meta: (
        <>
          <span class="mono">{r.code}</span>
          <span>{formatDate(r.lastSeen, lang)}</span>
        </>
      ),
    })),
  ]
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => (filter === 'mine' ? r.isOwner : !r.isOwner))
  const emptyText = filter === 'mine' ? t('myRoomsEmpty') : filter === 'others' ? t('noOtherRooms') : t('noRecentRooms')

  // 「創建空間」屬於「我的」——它生出來的空間就是主揪自己的；「加入空間」屬於
  // 「他人的」——會加進來的本來就是別人開的空間。「所有」是兩邊的聯集，兩顆
  // 都置頂。並排時各自 flex:1，單獨出現時滿版寬度跟底下的列對齊。
  const showCreate = filter !== 'others'
  const showJoin = filter !== 'mine'

  const createButton = (block: boolean) => (
    <button
      class={block ? 'btn btn-primary btn-lg btn-block' : 'btn btn-primary btn-lg'}
      style={block ? undefined : 'flex:1'}
      onClick={() => navigate('/new')}
    >
      <IconPlus /> {t('openRoom')}
    </button>
  )
  const joinButton = (block: boolean) => (
    <button
      class={block ? 'btn btn-lg btn-block' : 'btn btn-lg'}
      style={block ? undefined : 'flex:1'}
      aria-expanded={joinOpen}
      aria-controls="join-panel"
      onClick={() => setJoinOpen((v) => !v)}
    >
      {t('joinRoom')} <IconChevronDown class={`select-row-chevron${joinOpen ? ' is-open' : ''}`} />
    </button>
  )

  return (
    <div class="shell">
      <div class="home-head row">
        <div style="flex:1; min-width:0">
          <h1 class="home-title">{t('appName')}</h1>
          <p class="home-tagline">{t('tagline')}</p>
        </div>
        <button class="icon-btn" onClick={onSettings} aria-label={t('settings')}>
          <IconSettings />
        </button>
      </div>

      {connection.value === 'local-only' && (
        <p class="banner banner-muted">{t('localOnlyHint')}</p>
      )}

      <div class="stack">
        <div class="stack">
          <div class="segmented" role="group" aria-label={t('filter')}>
            <button class="segment" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              {t('roomFilterAll')}
            </button>
            <button class="segment" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>
              {t('roomFilterMine')}
            </button>
            <button class="segment" aria-pressed={filter === 'others'} onClick={() => setFilter('others')}>
              {t('roomFilterOthers')}
            </button>
          </div>

          {showCreate && showJoin ? (
            <div class="row" style="gap:8px">
              {joinButton(false)}
              {createButton(false)}
            </div>
          ) : showCreate ? createButton(true) : joinButton(true)}

          {showJoin && joinOpen && (
            <div class="card" id="join-panel">
              <div class="stack">
                <input
                  ref={codeInputRef}
                  class="input code-input"
                  value={code}
                  // 沒有 maxLength：貼上的常常是整條連結，得讓 extractRoomCode 先從裡面
                  // 抓出代碼，原生的長度限制會在那之前就把後半段截斷。裁到固定長度
                  // 改成抓完代碼之後才做，抓出來的碼本來就只有 6 碼。
                  inputMode="text"
                  autocapitalize="characters"
                  autocomplete="off"
                  spellcheck={false}
                  aria-label={t('codePlaceholder')}
                  placeholder="——————"
                  onInput={(e) => {
                    const raw = (e.currentTarget as HTMLInputElement).value
                    setCode(extractRoomCode(raw).slice(0, CODE_LENGTH + 2))
                    setError(null)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') join() }}
                />
                {error && <p class="note note-warn">{error}</p>}
                <button
                  class="btn btn-block"
                  disabled={extractRoomCode(code).length < CODE_LENGTH}
                  onClick={join}
                >
                  {t('join')}
                </button>
                {canScanQr() && (
                  <button class="btn btn-ghost btn-block" onClick={() => setScanOpen(true)}>
                    <IconCamera /> {t('scanQr')}
                  </button>
                )}
              </div>
            </div>
          )}

          {scanOpen && <ScanSheet onClose={() => setScanOpen(false)} />}

          {visibleRows.length === 0 ? (
            <p class="note">{emptyText}</p>
          ) : (
            <div class="stack" style="gap:8px">
              {visibleRows.map((r) => (
                <div class="row" key={r.code} style="gap:6px">
                  <button class="recent-item" onClick={() => navigate(`/r/${r.code}`)}>
                    <div style="flex:1; min-width:0">
                      <div class="recent-name">{r.name}</div>
                      <div class="recent-meta">{r.meta}</div>
                    </div>
                    <span class={r.isOwner ? 'tag tag-owner' : 'tag'}>
                      {r.isOwner ? t('owner') : t('helper')}
                    </span>
                  </button>
                  {r.removable && (
                    <button
                      class="icon-btn"
                      onClick={() => { void forgetRecentRoom(r.code) }}
                      aria-label={`${t('forget')}：${r.name}`}
                    >
                      <IconTrash />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!isSupabaseConfigured && (
          <p class="hint" style="padding-bottom:40px">{t('errNotConfigured')}</p>
        )}
      </div>
    </div>
  )
}
