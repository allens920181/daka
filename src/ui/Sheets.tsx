import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, connection, copyCurrentRoom, deleteCurrentRoom, groups, identity, leaveRoom, members,
  prefs, removeMember, renameRoom, replaceRoster, requestCode, room, saveRosterAs, savedRosters,
  session, setCheckerName, setMemberGroup, setPrefs, setRoomClosed, setStatusWithUndo, showToast,
  signIn, signOut,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { csvFilename, downloadFile, toCsv } from '../lib/export'
import { formatDate } from '../lib/format'
import { rosterToText } from '../lib/parse'
import type { Member } from '../lib/types'
import { joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { ConfirmDialog, Sheet } from './Sheet'
import { errorMessage } from './NewRoom'
import {
  IconBookmark, IconCopy, IconDownload, IconDuplicate, IconEdit, IconLeave, IconList, IconLock,
  IconPhone, IconPrinter, IconSettings, IconShare, IconTag, IconTrash,
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
  // 單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。這間房真的只存在
  // 這支手機裡，房號、QR、連結對任何人都沒有用——發出去只會讓五個同工站在
  // 車門口看到「找不到這個房號。請確認有沒有打錯」，然後重打三次。
  const localOnly = connection.value === 'local-only'

  useEffect(() => {
    if (localOnly) return
    let alive = true
    // QR 只有打開分享面板才用得到，動態載入讓首頁不必背這段程式碼。
    void import('qrcode')
      .then((m) => m.default.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' }))
      .then((d) => { if (alive) setQr(d) })
      .catch(() => { /* QR 產不出來時仍可用房號與連結 */ })
    return () => { alive = false }
  }, [url, localOnly])

  if (localOnly) {
    return (
      <Sheet title={t('shareLocalTitle')} onClose={onClose}>
        <div class="stack">
          <p class="note note-warn">{t('shareLocalBody')}</p>
          <p class="hint">{t('shareLocalHow')}</p>
        </div>
      </Sheet>
    )
  }

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
            onClick={() => { void shareLink(url, t) }}
          >
            <IconShare /> {t('shareLink')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/**
 * 有系統分享就用系統分享：主揪要把連結送進 LINE 群，`navigator.share` 直接
 * 走完那段路，而「複製連結」只走到剪貼簿，剩下的自己貼。沒有系統分享（桌面
 * 瀏覽器）或使用者取消時退回複製。
 */
async function shareLink(url: string, t: ReturnType<typeof useT>): Promise<void> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: t('appName'), text: t('shareLinkText'), url })
      return
    } catch (e) {
      // 使用者自己按取消不是錯誤，不要再彈一個提示。
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  await copyText(url, t('copied'), t('errUnknown'))
}

// ---------------------------------------------------------------------------

type ManageMode = 'menu' | 'copy' | 'rename' | 'roster' | 'saveRoster' | 'settings'
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

  if (mode === 'settings') return <SettingsSheet onClose={onClose} />

  const expires = formatDate(current.expires_at, prefs.value.lang)
  const myName = identity.value.checkerName.trim()

  return (
    <Sheet title={t('manage')} onClose={onClose}>
      {/*
        身分與名字。協助者是掃 QR 直接進房的，從來不會經過首頁——在這之前
        整個 App 沒有任何一條路通往設定，於是「你的名字」永遠是空的，
        「誰點的」與衝突提示就常態退化成匿名：現場問「這個是誰點的」沒有答案。
        另外協助者的管理面板會靜默少掉一半項目，這裡也一併說清楚。
      */}
      <div class="role-line">
        <span class={owner ? 'tag tag-owner' : 'tag'}>{owner ? t('owner') : t('helper')}</span>
        <button class="role-name" onClick={() => setMode('settings')}>
          {myName ? t('youAre', { name: myName }) : t('setYourName')}
        </button>
      </div>
      {!owner && <p class="hint" style="margin-bottom:10px">{t('helperLimits')}</p>}

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
          <IconPrinter />
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
              <IconEdit />
              <span><strong>{t('editRoster')}</strong></span>
            </button>

            {isSupabaseConfigured && (
              <button
                class="menu-item"
                onClick={() => { setValue(current.name); setMode('saveRoster') }}
              >
                <IconBookmark />
                <span><strong>{t('saveAsRoster')}</strong></span>
              </button>
            )}

            <button class="menu-item" onClick={() => { setValue(current.name); setMode('rename') }}>
              <IconTag />
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

        <button class="menu-item" onClick={() => setMode('settings')}>
          <IconSettings />
          <span><strong>{t('settings')}</strong></span>
        </button>

        <button class="menu-item" onClick={() => { leaveRoom(); onClose(); navigate('/') }}>
          <IconLeave />
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // 從名單列點名有 5 秒復原；從這裡做同一件事卻什麼都沒有。同一個結果要有
  // 同一種安全網，否則使用者學不會「哪一種操作可以反悔」。
  function mark(status: Member['status'], label: string): void {
    void setStatusWithUndo(member.id, status, (m) => `${m.name} · ${label}`, t('undo'))
    onClose()
  }

  if (confirmingDelete) {
    return (
      <ConfirmDialog
        title={t('confirmRemoveMemberTitle', { name: member.name })}
        body={t('confirmRemoveMemberBody')}
        confirmLabel={t('remove')}
        danger
        onConfirm={() => { void removeMember(member.id); onClose() }}
        onClose={() => setConfirmingDelete(false)}
      />
    )
  }

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
              <button class="menu-item" onClick={() => mark('arrived', t('arrived'))}>
                <span><strong>{t('markArrived')}</strong></span>
              </button>
            )}
            {member.status !== 'pending' && (
              <button class="menu-item" onClick={() => mark('pending', t('missing'))}>
                <span><strong>{t('markMissing')}</strong></span>
              </button>
            )}
            {member.status !== 'excused' && (
              <button class="menu-item" onClick={() => mark('excused', t('excused'))}>
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
            {/* 刪除是這個面板裡唯一不可復原的動作，而它坐在最好按的位置。 */}
            <button class="menu-item danger" onClick={() => setConfirmingDelete(true)}>
              <IconTrash />
              <span>
                <strong>{t('removeMember')}</strong>
                <span class="sub">{t('removeMemberSub')}</span>
              </span>
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

export function AddWalkInSheet({ group, onClose }: { group: string | null; onClose: () => void }) {
  const t = useT()
  const [text, setText] = useState('')
  const drafts = draftsFrom(text)

  async function add(): Promise<void> {
    const added: string[] = []
    for (const d of drafts) {
      const m = await addWalkIn(d, group)
      if (m) added.push(m.name)
    }
    onClose()
    // 加完人之後畫面上常常什麼都沒動：新加的人排在名單最後，而且已經是「已到」，
    // 在「未到」篩選下根本看不見。不講一句話的話，使用者會不確定到底加成功沒有。
    if (added.length === 1) {
      showToast(t(group ? 'walkInAddedInGroup' : 'walkInAdded', { name: added[0] ?? '', group: group ?? '' }))
    } else if (added.length > 1) {
      showToast(t('walkInAddedMany', { n: added.length }))
    }
  }

  return (
    <Sheet title={t('addWalkIn')} onClose={onClose}>
      <div class="stack">
        <p class="hint">{t('walkInPlaceholder')}</p>
        {group && <p class="note">{t('walkInIntoGroup', { group })}</p>}
        <RosterInput text={text} onText={setText} />
        <button
          class="btn btn-primary btn-block btn-lg"
          disabled={drafts.length === 0}
          onClick={() => { void add() }}
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
