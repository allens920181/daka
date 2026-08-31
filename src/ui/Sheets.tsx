import { useEffect, useState } from 'preact/hooks'
import {
  addWalkIn, copyCurrentRoom, deleteCurrentRoom, identity, leaveRoom, members,
  prefs, removeMember, renameRoom, replaceRoster, room, saveRosterAs, savedRosters,
  setCheckerName, setPrefs, setRoomClosed, setStatus, showToast,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { csvFilename, downloadFile, toCsv } from '../lib/export'
import { rosterToText } from '../lib/parse'
import type { Member } from '../lib/types'
import { joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { Sheet } from './Sheet'
import { errorMessage } from './NewRoom'
import {
  IconCopy, IconDownload, IconDuplicate, IconList, IconLock, IconPhone, IconTrash,
} from './icons'
import { useT } from './t'

async function copyText(value: string, done: string, fail: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    showToast(done)
  } catch {
    showToast(fail)
  }
}

// ---------------------------------------------------------------------------

export function ShareSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT()
  const url = joinUrl(code)
  const [qr, setQr] = useState('')

  useEffect(() => {
    let alive = true
    // QR 只有打開分享面板才用得到，動態載入讓首頁不必背這段程式碼。
    void import('qrcode')
      .then((m) => m.default.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' }))
      .then((d) => { if (alive) setQr(d) })
      .catch(() => { /* QR 產不出來時仍可用房號與連結 */ })
    return () => { alive = false }
  }, [url])

  return (
    <Sheet title={t('shareTitle')} onClose={onClose}>
      <div class="stack">
        <p class="hint">{t('shareHint')}</p>

        <div class="field">
          <span class="label">{t('roomCode')}</span>
          <div class="code-display">{code}</div>
        </div>

        {qr && (
          <div class="field">
            <span class="label">{t('scanToJoin')}</span>
            <div class="qr-card">
              <img src={qr} alt={`${t('scanToJoin')} ${code}`} />
            </div>
          </div>
        )}

        <div class="row">
          <button
            class="btn btn-block"
            onClick={() => { void copyText(code, t('copied'), t('errUnknown')) }}
          >
            <IconCopy /> {t('copyCode')}
          </button>
          <button
            class="btn btn-primary btn-block"
            onClick={() => { void copyText(url, t('copied'), t('errUnknown')) }}
          >
            <IconCopy /> {t('copyLink')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

type ManageMode = 'menu' | 'copy' | 'rename' | 'roster' | 'saveRoster'

export function ManageSheet({ owner, onClose }: { owner: boolean; onClose: () => void }) {
  const t = useT()
  const [mode, setMode] = useState<ManageMode>('menu')
  const [value, setValue] = useState('')
  const [rosterText, setRosterText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = room.value
  if (!current) return null
  const closed = Boolean(current.closed_at)

  async function run(fn: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e, t))
      setWorking(false)
      return
    }
    setWorking(false)
  }

  if (mode === 'copy') {
    return (
      <Sheet title={t('copyRoom')} onClose={onClose}>
        <div class="stack">
          <p class="hint">{t('copyRoomHint')}</p>
          <div class="field">
            <label class="label" for="copy-name">{t('copyRoomName')}</label>
            <input
              id="copy-name" class="input" value={value} maxLength={80}
              onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
          {error && <p class="note note-warn">{error}</p>}
          <div class="row">
            <button class="btn btn-block" onClick={() => setMode('menu')}>{t('cancel')}</button>
            <button
              class="btn btn-primary btn-block"
              disabled={working || !value.trim()}
              onClick={() => { void run(async () => {
                const code = await copyCurrentRoom(value)
                onClose()
                navigate(`/r/${code}`)
              }) }}
            >
              {working ? t('loading') : t('confirm')}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  if (mode === 'rename') {
    return (
      <Sheet title={t('rename')} onClose={onClose}>
        <div class="stack">
          <input
            class="input" value={value} maxLength={80} aria-label={t('rename')}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          />
          {error && <p class="note note-warn">{error}</p>}
          <div class="row">
            <button class="btn btn-block" onClick={() => setMode('menu')}>{t('cancel')}</button>
            <button
              class="btn btn-primary btn-block"
              disabled={working || !value.trim()}
              onClick={() => { void run(async () => { await renameRoom(value); setMode('menu') }) }}
            >
              {t('save')}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  if (mode === 'roster') {
    const drafts = draftsFrom(rosterText)
    return (
      <Sheet title={t('editRoster')} onClose={onClose}>
        <div class="stack">
          <p class="note note-warn">{t('editRosterWarning')}</p>
          <RosterInput text={rosterText} onText={setRosterText} />
          {error && <p class="note note-warn">{error}</p>}
          <div class="row">
            <button class="btn btn-block" onClick={() => setMode('menu')}>{t('cancel')}</button>
            <button
              class="btn btn-primary btn-block"
              disabled={working || drafts.length === 0}
              onClick={() => { void run(async () => { await replaceRoster(drafts); setMode('menu') }) }}
            >
              {working ? t('loading') : `${t('save')}（${drafts.length}）`}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  if (mode === 'saveRoster') {
    return (
      <Sheet title={t('saveAsRoster')} onClose={onClose}>
        <div class="stack">
          <div class="field">
            <label class="label" for="roster-name">{t('saveRosterPrompt')}</label>
            <input
              id="roster-name" class="input" value={value} maxLength={80}
              onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
          {error && <p class="note note-warn">{error}</p>}
          <div class="row">
            <button class="btn btn-block" onClick={() => setMode('menu')}>{t('cancel')}</button>
            <button
              class="btn btn-primary btn-block"
              disabled={working || !value.trim()}
              onClick={() => { void run(async () => {
                await saveRosterAs(value, members.value.map((m) => ({
                  name: m.name, note: m.note, phone: m.phone,
                  companions: m.companions, group_label: m.group_label,
                })))
                showToast(t('copied'))
                setMode('menu')
              }) }}
            >
              {working ? t('loading') : t('save')}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  const expires = new Date(current.expires_at).toLocaleDateString()

  return (
    <Sheet title={t('manage')} onClose={onClose}>
      <div class="menu">
        <button
          class="menu-item"
          onClick={() => downloadFile(csvFilename(current), toCsv(members.value))}
        >
          <IconDownload />
          <span><strong>{t('exportCsv')}</strong></span>
        </button>

        {owner && (
          <>
            <div class="menu-divider" />
            <button
              class="menu-item"
              onClick={() => {
                setValue(current.name.includes(t('returnTrip')) ? current.name : `${current.name} · ${t('returnTrip')}`)
                setMode('copy')
              }}
            >
              <IconDuplicate />
              <span>
                <strong>{t('copyRoom')}</strong>
                <span class="sub">{t('copyRoomHint')}</span>
              </span>
            </button>

            <button
              class="menu-item"
              onClick={() => { setRosterText(rosterToText(members.value)); setMode('roster') }}
            >
              <IconList />
              <span><strong>{t('editRoster')}</strong></span>
            </button>

            {isSupabaseConfigured && (
              <button
                class="menu-item"
                onClick={() => { setValue(current.name); setMode('saveRoster') }}
              >
                <IconList />
                <span><strong>{t('saveAsRoster')}</strong></span>
              </button>
            )}

            <button class="menu-item" onClick={() => { setValue(current.name); setMode('rename') }}>
              <IconList />
              <span><strong>{t('rename')}</strong></span>
            </button>

            <button class="menu-item" onClick={() => { void run(() => setRoomClosed(!closed)) }}>
              <IconLock />
              <span>
                <strong>{closed ? t('reopenRoom') : t('closeRoom')}</strong>
                {!closed && <span class="sub">{t('closeRoomHint')}</span>}
              </span>
            </button>
          </>
        )}

        <div class="menu-divider" />

        <button class="menu-item" onClick={() => { leaveRoom(); onClose(); navigate('/') }}>
          <span><strong>{t('leaveRoom')}</strong></span>
        </button>

        {owner && (
          <button
            class="menu-item danger"
            onClick={() => {
              if (!window.confirm(t('deleteRoomWarning'))) return
              void run(async () => { await deleteCurrentRoom(); onClose(); navigate('/') })
            }}
          >
            <IconTrash />
            <span><strong>{t('deleteRoom')}</strong></span>
          </button>
        )}
      </div>

      {error && <p class="note note-warn" style="margin-top:12px">{error}</p>}
      <p class="hint" style="margin-top:14px">{t('expiresOn', { date: expires })}</p>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

export function MemberSheet({ member, owner, onClose }: {
  member: Member; owner: boolean; onClose: () => void
}) {
  const t = useT()
  const closed = Boolean(room.value?.closed_at)

  return (
    <Sheet title={member.name} onClose={onClose}>
      <div class="menu">
        {member.phone && (
          <a class="menu-item" href={`tel:${member.phone}`}>
            <IconPhone />
            <span>
              <strong class="mono">{member.phone}</strong>
              <span class="sub">{member.name}</span>
            </span>
          </a>
        )}

        {!closed && (
          <>
            <div class="menu-divider" />
            {member.status !== 'arrived' && (
              <button class="menu-item" onClick={() => { void setStatus(member.id, 'arrived'); onClose() }}>
                <span><strong>{t('markArrived')}</strong></span>
              </button>
            )}
            {member.status !== 'pending' && (
              <button class="menu-item" onClick={() => { void setStatus(member.id, 'pending'); onClose() }}>
                <span><strong>{t('markMissing')}</strong></span>
              </button>
            )}
            {member.status !== 'excused' && (
              <button class="menu-item" onClick={() => { void setStatus(member.id, 'excused'); onClose() }}>
                <span><strong>{t('markExcused')}</strong></span>
              </button>
            )}
          </>
        )}

        {owner && (
          <>
            <div class="menu-divider" />
            <button
              class="menu-item danger"
              onClick={() => { void removeMember(member.id); onClose() }}
            >
              <IconTrash />
              <span><strong>{t('deleteRoster')}</strong></span>
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

export function AddWalkInSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [text, setText] = useState('')
  const drafts = draftsFrom(text)

  return (
    <Sheet title={t('addWalkIn')} onClose={onClose}>
      <div class="stack">
        <p class="hint">{t('walkInPlaceholder')}</p>
        <RosterInput text={text} onText={setText} />
        <button
          class="btn btn-primary btn-block btn-lg"
          disabled={drafts.length === 0}
          onClick={() => {
            for (const d of drafts) void addWalkIn(d)
            onClose()
          }}
        >
          {`${t('add')}（${drafts.length}）`}
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const p = prefs.value
  const [name, setName] = useState(identity.value.checkerName)

  return (
    <Sheet title={t('theme')} onClose={onClose}>
      <div class="stack">
        <div class="field">
          <label class="label" for="checker-name">{t('yourName')}</label>
          <input
            id="checker-name" class="input" value={name} maxLength={40}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => { void setCheckerName(name) }}
          />
          <span class="hint">{t('yourNameHint')}</span>
        </div>

        <div class="field">
          <span class="label">{t('theme')}</span>
          <div class="segmented">
            {(['system', 'light', 'dark'] as const).map((theme) => (
              <button
                key={theme}
                class="segment"
                aria-pressed={p.theme === theme}
                onClick={() => { void setPrefs({ theme }) }}
              >
                {theme === 'system' ? t('themeSystem') : theme === 'light' ? t('themeLight') : t('themeDark')}
              </button>
            ))}
          </div>
        </div>

        <div class="field">
          <span class="label">{t('language')}</span>
          <div class="segmented">
            {(['zh', 'en'] as const).map((lang) => (
              <button
                key={lang}
                class="segment"
                aria-pressed={p.lang === lang}
                onClick={() => { void setPrefs({ lang }) }}
              >
                {lang === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </div>

        {isSupabaseConfigured && savedRosters.value.length > 0 && (
          <p class="hint">{t('savedRosters')}：{savedRosters.value.length}</p>
        )}
      </div>
    </Sheet>
  )
}
