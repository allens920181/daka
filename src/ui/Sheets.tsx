import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, copyCurrentRoom, deleteCurrentRoom, groups, identity, leaveRoom, members,
  prefs, removeMember, renameRoom, replaceRoster, requestCode, room, saveRosterAs, savedRosters,
  session, setCheckerName, setMemberGroup, setPrefs, setRoomClosed, setStatus, showToast,
  signIn, signOut,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { csvFilename, downloadFile, toCsv } from '../lib/export'
import { rosterToText } from '../lib/parse'
import type { Member } from '../lib/types'
import { joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { ConfirmDialog, Sheet } from './Sheet'
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
type Confirming = null | 'delete' | 'replaceRoster'

export function ManageSheet({ owner, onClose }: { owner: boolean; onClose: () => void }) {
  const t = useT()
  const [mode, setMode] = useState<ManageMode>('menu')
  const [confirming, setConfirming] = useState<Confirming>(null)
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
              onClick={() => setConfirming('replaceRoster')}
            >
              {working ? t('loading') : `${t('save')}（${drafts.length}）`}
            </button>
          </div>
        </div>

        {confirming === 'replaceRoster' && (
          <ConfirmDialog
            title={t('editRoster')}
            body={t('editRosterWarning')}
            confirmLabel={t('save')}
            danger
            onClose={() => setConfirming(null)}
            onConfirm={() => { void run(async () => { await replaceRoster(drafts); setMode('menu') }) }}
          />
        )}
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

        <button class="menu-item" onClick={() => { onClose(); navigate(`/b/${current.code}`) }}>
          <IconList />
          <span>
            <strong>{t('boardMode')}</strong>
            <span class="sub">{t('boardHint')}</span>
          </span>
        </button>

        <button class="menu-item" onClick={() => { onClose(); setTimeout(() => window.print(), 60) }}>
          <IconList />
          <span>
            <strong>{t('printRoster')}</strong>
            <span class="sub">{t('printHint')}</span>
          </span>
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
          <button class="menu-item danger" onClick={() => setConfirming('delete')}>
            <IconTrash />
            <span><strong>{t('deleteRoom')}</strong></span>
          </button>
        )}
      </div>

      {error && <p class="note note-warn" style="margin-top:12px">{error}</p>}
      <p class="hint" style="margin-top:14px">{t('expiresOn', { date: expires })}</p>

      {confirming === 'delete' && (
        <ConfirmDialog
          title={t('deleteRoom')}
          body={t('deleteRoomWarning')}
          confirmLabel={t('deleteRoom')}
          danger
          onClose={() => setConfirming(null)}
          onConfirm={() => { void run(async () => { await deleteCurrentRoom(); onClose(); navigate('/') }) }}
        />
      )}
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

        {owner && groups.value.length > 0 && (
          <>
            <div class="menu-divider" />
            <div class="field" style="padding: 0 12px 8px">
              <span class="label">{t('changeGroup')}</span>
              <div class="groups">
                {groups.value.map((g) => (
                  <button
                    key={g}
                    class="group-chip"
                    aria-pressed={member.group_label === g}
                    onClick={() => { void setMemberGroup(member.id, g); onClose() }}
                  >
                    {g}
                  </button>
                ))}
                {member.group_label && (
                  <button
                    class="group-chip"
                    onClick={() => { void setMemberGroup(member.id, null); onClose() }}
                  >
                    {t('removeFromGroup')}
                  </button>
                )}
              </div>
            </div>
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
  const [signingIn, setSigningIn] = useState(false)

  // 登入成功後要一路關到底：使用者的心智模型是「我登入了，讓我看到我的東西」，
  // 留在設定面板上會讓人以為沒成功。
  if (signingIn) {
    return <SignInSheet onCancel={() => setSigningIn(false)} onDone={onClose} />
  }

  return (
    <Sheet title={t('settings')} onClose={onClose}>
      <div class="stack">
        {isSupabaseConfigured && (
          <div class="field">
            <span class="label">{t('account')}</span>
            {session.value ? (
              <div class="row">
                <span class="hint" style="flex:1">
                  {t('signedInAs', { email: session.value.email })}
                </span>
                <button class="btn btn-sm" onClick={() => { void signOut() }}>{t('signOut')}</button>
              </div>
            ) : (
              <>
                <button class="btn btn-block" onClick={() => setSigningIn(true)}>{t('signIn')}</button>
                <span class="hint">{t('signInWhy')}</span>
              </>
            )}
          </div>
        )}

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
          <span class="label">{t('haptics')}</span>
          <div class="segmented">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                class="segment"
                aria-pressed={p.haptics === on}
                onClick={() => { void setPrefs({ haptics: on }) }}
              >
                {on ? t('on') : t('off')}
              </button>
            ))}
          </div>
          <span class="hint">{t('hapticsHint')}</span>
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

// ---------------------------------------------------------------------------

/**
 * 主揪登入。兩步：寄六碼到 Email、輸入六碼。
 *
 * 用驗證碼而不是魔術連結：魔術連結在信件 App 的內建瀏覽器開啟時，
 * 會落在另一個瀏覽器工作階段，是很常見的失敗模式。
 */
export function SignInSheet({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const t = useT()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function describe(e: unknown): string {
    if (!(e instanceof AuthError)) return t('errUnknown')
    switch (e.kind) {
      case 'offline': return t('errOffline')
      case 'bad-code': return t('errBadOtp')
      case 'rate-limited': return t('errRateLimited')
      case 'not-configured': return t('errNotConfigured')
      default: return t('errUnknown')
    }
  }

  async function send() {
    setWorking(true)
    setError(null)
    try {
      await requestCode(email)
      setStep('code')
    } catch (e) {
      setError(describe(e))
    }
    setWorking(false)
  }

  async function verify() {
    setWorking(true)
    setError(null)
    try {
      const claimed = await signIn(email, code)
      onDone()
      showToast(
        claimed.rooms + claimed.rosters > 0
          ? t('claimed', { rooms: claimed.rooms, rosters: claimed.rosters })
          : t('claimedNothing'),
      )
      return
    } catch (e) {
      setError(describe(e))
    }
    setWorking(false)
  }

  return (
    <Sheet title={t('signIn')} onClose={onCancel}>
      <div class="stack">
        <p class="hint">{t('signInWhy')}</p>

        {step === 'email' ? (
          <>
            <div class="field">
              <label class="label" for="signin-email">{t('emailLabel')}</label>
              <input
                id="signin-email"
                class="input"
                type="email"
                inputMode="email"
                autocomplete="email"
                value={email}
                placeholder={t('emailPlaceholder')}
                onInput={(e) => { setEmail((e.currentTarget as HTMLInputElement).value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@')) void send() }}
              />
            </div>
            {error && <p class="note note-warn">{error}</p>}
            <button
              class="btn btn-primary btn-block btn-lg"
              disabled={working || !email.includes('@')}
              onClick={() => { void send() }}
            >
              {working ? t('loading') : t('sendCode')}
            </button>
          </>
        ) : (
          <>
            <p class="note">{t('codeSent', { email })}</p>
            <div class="field">
              <label class="label" for="signin-code">{t('codeLabel')}</label>
              <input
                id="signin-code"
                class="input code-input"
                inputMode="numeric"
                autocomplete="one-time-code"
                maxLength={6}
                value={code}
                placeholder="——————"
                onInput={(e) => {
                  setCode((e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))
                  setError(null)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void verify() }}
              />
            </div>
            {error && <p class="note note-warn">{error}</p>}
            <button
              class="btn btn-primary btn-block btn-lg"
              disabled={working || code.length !== 6}
              onClick={() => { void verify() }}
            >
              {working ? t('loading') : t('verify')}
            </button>
            <button class="btn btn-block" disabled={working} onClick={() => { void send() }}>
              {t('resend')}
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}
