import { useState } from 'preact/hooks'
import { connection, forgetRecentRoom, myRooms, prefs, recentRooms, session } from '../lib/store'
import { formatDate } from '../lib/format'
import { findConfusables, isValidRoomCode, normalizeRoomCode, CODE_LENGTH } from '../lib/code'
import { isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { IconPlus, IconSettings, IconTrash } from './icons'
import { useT } from './t'

export function Home({ onSettings }: { onSettings: () => void }) {
  const t = useT()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function join() {
    const normalized = normalizeRoomCode(code)
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

  // 登入之後「我的活動」與「最近的房間」是兩份各自維護的清單，主揪自己開的房
  // 兩邊都有——不去重的話首頁會上下相鄰地把同一間房印兩次。以「我的活動」為準。
  const ownedCodes = new Set(session.value ? myRooms.value.map((r) => r.code) : [])
  const rooms = recentRooms.value.filter((r) => !ownedCodes.has(r.code))

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
        <button class="btn btn-primary btn-lg btn-block" onClick={() => navigate('/new')}>
          <IconPlus /> {t('openRoom')}
        </button>

        <div class="card">
          <h2 class="card-title">{t('joinRoom')}</h2>
          <div class="stack">
            <input
              class="input code-input"
              value={code}
              maxLength={CODE_LENGTH + 2}
              inputMode="text"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              aria-label={t('codePlaceholder')}
              placeholder="——————"
              onInput={(e) => {
                setCode(normalizeRoomCode((e.currentTarget as HTMLInputElement).value))
                setError(null)
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') join() }}
            />
            {error && <p class="note note-warn">{error}</p>}
            <button
              class="btn btn-block"
              disabled={normalizeRoomCode(code).length < CODE_LENGTH}
              onClick={join}
            >
              {t('join')}
            </button>
          </div>
        </div>

        {session.value && (
          <div class="field">
            <span class="label">{t('myRooms')}</span>
            {myRooms.value.length === 0 ? (
              <p class="note">{t('myRoomsEmpty')}</p>
            ) : (
              <div class="stack" style="gap:8px">
                {myRooms.value.map((r) => (
                  <button key={r.code} class="recent-item" onClick={() => navigate(`/r/${r.code}`)}>
                    <div style="flex:1; min-width:0">
                      <div class="recent-name">{r.name}</div>
                      <div class="recent-meta">
                        <span class="mono">{r.code}</span>
                        <span>{formatDate(r.created_at, prefs.value.lang)}</span>
                        <span>{t('roomStat', { arrived: r.arrivedHeadcount, total: r.expectedHeadcount })}</span>
                      </div>
                    </div>
                    <span class="tag tag-owner">{t('owner')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div class="field">
          <span class="label">{t('recentRooms')}</span>
          {rooms.length === 0 ? (
            <p class="note">{t('noRecentRooms')}</p>
          ) : (
            <div class="stack" style="gap:8px">
              {rooms.map((r) => (
                <div class="row" key={r.code} style="gap:6px">
                  <button class="recent-item" onClick={() => navigate(`/r/${r.code}`)}>
                    <div style="flex:1; min-width:0">
                      <div class="recent-name">{r.name}</div>
                      <div class="recent-meta">
                        <span class="mono">{r.code}</span>
                        <span>{formatDate(r.lastSeen, prefs.value.lang)}</span>
                      </div>
                    </div>
                    <span class={r.isOwner ? 'tag tag-owner' : 'tag'}>
                      {r.isOwner ? t('owner') : t('helper')}
                    </span>
                  </button>
                  <button
                    class="icon-btn"
                    onClick={() => { void forgetRecentRoom(r.code) }}
                    aria-label={`${t('forget')}：${r.name}`}
                  >
                    <IconTrash />
                  </button>
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
