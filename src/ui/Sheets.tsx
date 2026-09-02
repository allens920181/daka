import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, connection, copyCurrentRoom, deleteCurrentRoom, groups, identity, leaveRoom, members,
  prefs, removeMember, renameRoom, replaceRoster, requestCode, room, saveRosterAs, savedRosters,
  peers, presenceReady, session, setCheckerName, setMemberGroup, setPrefs, setRoomClosed, setStatusWithUndo,
  shareOnEnter, showToast, type Peer,
  signIn, signOut, startGoogleSignIn,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { copyToClipboard } from '../lib/clipboard'
import { inAppBrowser, secureOrigin } from '../lib/config'
import { csvFilename, downloadFile, toCsv, toShareText } from '../lib/export'
import { formatDate } from '../lib/format'
import { rosterToText } from '../lib/parse'
import type { Member } from '../lib/types'
import { currentRoute, joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { ConfirmDialog, Sheet } from './Sheet'
import { errorMessage } from './NewRoom'
import {
  IconBookmark, IconCopy, IconDownload, IconDuplicate, IconEdit, IconLeave, IconList, IconLock,
  IconGoogle, IconPhone, IconPlus, IconPrinter, IconSettings, IconShare, IconTag, IconTrash,
} from './icons'
import { useT } from './t'

async function copyText(value: string, done: string, fail: string): Promise<void> {
  showToast((await copyToClipboard(value)) ? done : fail)
}

// ---------------------------------------------------------------------------

export function ShareSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT()
  const url = joinUrl(code)
  const [qr, setQr] = useState('')
  // 單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。這個空間真的只存在
  // 這支手機裡，代碼、QR、連結對任何人都沒有用——發出去只會讓五個同工站在
  // 車門口看到「找不到這個代碼。請確認有沒有打錯」，然後重打三次。
  const localOnly = connection.value === 'local-only'
  const here = peers.value

  useEffect(() => {
    if (localOnly) return
    let alive = true
    // QR 只有打開分享面板才用得到，動態載入讓首頁不必背這段程式碼。
    void import('qrcode')
      .then((m) => m.default.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' }))
      .then((d) => { if (alive) setQr(d) })
      .catch(() => { /* QR 產不出來時仍可用代碼與連結 */ })
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

        {/*
          誰已經進來了。06:50 車門口「大家都進來了嗎」現在只能用喊的，而喊得到
          的前提是五個人在同一個地方——他們散在兩台車的前後門。更常見的失敗是
          有人掃了 QR 但停在瀏覽器的「要開啟嗎」對話框上，自己以為進來了；等到
          07:12 發現有一車根本沒人在點，已經沒有第二次機會。
          離線時不顯示（誠實原則：那時候這個數字只是舊的）。
        */}
        {connection.value === 'online' && presenceReady.value && (
          <div class="field">
            <span class="label">{t('whoIsHere')}</span>
            <p class="note">
              {here.length <= 1
                ? t('onlyYouHere')
                : t('peersHere', { n: here.length, names: peerNames(here, t) })}
            </p>
          </div>
        )}

        <div class="row">
          <button
            class="btn btn-block"
            onClick={() => { void copyText(code, t('copied'), t('copyFailed')) }}
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

/** 「陳姐、阿明，另外 2 支沒寫名字」——沒寫名字的人不逐一列出，只算支數。 */
function peerNames(list: readonly Peer[], t: ReturnType<typeof useT>): string {
  const named = list.map((p) => p.name).filter((n): n is string => Boolean(n))
  const anon = list.length - named.length
  if (named.length === 0) return t('peersAllAnon', { n: anon })
  if (anon === 0) return named.join('、')
  return `${named.join('、')}${t('peersPlusAnon', { n: anon })}`
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
  await copyText(url, t('copied'), t('copyFailed'))
}

// ---------------------------------------------------------------------------

type ManageMode = 'menu' | 'copy' | 'rename' | 'roster' | 'saveRoster' | 'settings' | 'walkin'
type Confirming = null | 'delete' | 'replaceRoster' | 'finish'

export function ManageSheet({ owner, group, onClose }: {
  owner: boolean
  /** 目前正在看的那一車。臨時加人要繼承它。 */
  group: string | null
  onClose: () => void
}) {
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
                // 回程空間是新的代碼，五支協助的手機還開著舊空間——複製完的下一個
                // 動作 100% 是把新的代碼發出去。不主動提醒的話，主揪會直接
                // 開始點名，而其他人繼續在舊空間打勾，兩邊的數字各走各的。
                shareOnEnter.value = code
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
              {working ? t('loading') : drafts.length ? `${t('save')} ${drafts.length}` : t('save')}
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
  if (mode === 'walkin') return <AddWalkInSheet group={group} onClose={onClose} />

  const expires = formatDate(current.expires_at, prefs.value.lang)
  const myName = identity.value.checkerName.trim()

  return (
    <Sheet title={t('manage')} onClose={onClose}>
      {/*
        身分與名字。協助者是掃 QR 直接進空間的，從來不會經過首頁——在這之前
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
        {/* 臨時加人從底部動作列搬到這裡：一場活動用 0-2 次，而動作列的兩個
            槽位讓給了整個收尾都在用的「只看未到」與「複製結果」。
            協助者站在車門口也用得到，所以不放在 owner 區塊裡。 */}
        {!closed && (
          <button class="menu-item" onClick={() => setMode('walkin')}>
            <IconPlus />
            <span>
              <strong>{t('addWalkIn')}</strong>
              <span class="sub">{t('walkInPlaceholder')}</span>
            </span>
          </button>
        )}

        <button
          class="menu-item"
          onClick={() => downloadFile(csvFilename(current), toCsv(members.value, prefs.value.lang))}
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

        <div class="menu-divider" />

        {/*
          複製不限主揪。三個真實劇本都會踩到：主揪臨時不能來、手機在遊覽車上
          沒電、在山區沒訊號被降級成協助者——而那時候「回程再點一次」是產品
          方向書明列的核心情境，現場卻只能重貼一次 LINE 接龍重開空間。
          複製對來源空間完全無害（一個字都不改），而名單本來就對所有拿得到代碼
          的人可見，所以把它鎖在擁有權後面沒有保護到任何東西。
        */}
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
            <span class="sub">{owner ? t('copyRoomHint') : t('copyRoomHintHelper')}</span>
          </span>
        </button>

        {owner && (
          <>
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

            <button
              class="menu-item"
              onClick={() => {
                // 重新開啟不是破壞性動作，直接做；結束才要走流程。
                if (closed) { void run(() => setRoomClosed(false)); return }
                setConfirming('finish')
              }}
            >
              <IconLock />
              <span>
                <strong>{closed ? t('reopenRoom') : t('finishRound')}</strong>
                {!closed && <span class="sub">{t('finishRoundHint')}</span>}
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

      {/*
        「車開了」是唯一一次所有人的注意力同時落在同一件事上，也是唯一一次能把
        結果送出去的機會。以前收尾被拆成三個彼此無關的按鈕（複製結果在計分區、
        下載 CSV 在面板第一項、關閉空間在第九項），結果多數空間從未被關閉也從未
        被匯出，30 天後靜靜消失。把結果攤在確認鍵前面，順手就交出去了。
      */}
      {confirming === 'finish' && (
        <ConfirmDialog
          title={t('finishRound')}
          body={t('finishRoundBody')}
          confirmLabel={t('finishRound')}
          onClose={() => setConfirming(null)}
          onConfirm={() => { void run(() => setRoomClosed(true)) }}
        >
          <pre class="result-preview">{toShareText(current, members.value, prefs.value.lang)}</pre>
          <div class="row" style="margin-bottom:12px">
            <button
              class="btn btn-block"
              onClick={() => { void copyText(toShareText(current, members.value, prefs.value.lang), t('summaryCopied'), t('copyFailed')) }}
            >
              <IconCopy /> {t('copySummary')}
            </button>
            <button
              class="btn btn-block"
              onClick={() => downloadFile(csvFilename(current), toCsv(members.value, prefs.value.lang))}
            >
              <IconDownload /> {t('exportCsv')}
            </button>
          </div>
        </ConfirmDialog>
      )}

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
        {group && <p class="note">{t('walkInIntoGroup', { group })}</p>}
        <RosterInput text={text} onText={setText} />
        <button
          class="btn btn-primary btn-block btn-lg"
          disabled={drafts.length === 0}
          onClick={() => { void add() }}
        >
          {drafts.length ? `${t('add')} ${drafts.length}` : t('add')}
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
              <>
                <div class="row">
                  <span class="hint" style="flex:1">
                    {t('signedInAs', { email: session.value.email })}
                  </span>
                  <button class="btn btn-sm" onClick={() => { void signOut() }}>{t('signOut')}</button>
                </div>
                {/* 這支手機可能就是今天唯一管得動這場活動的裝置。按登出的常見
                    動機是「借手機給人用一下」，使用者不會預期代價是失去控制。
                    不加確認對話框（重新登入就還原），但後果要講出來。 */}
                <p class="hint">{t('signOutWhat')}</p>
              </>
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
  // Google 是主要路徑，Email 驗證碼是備援——按了「改用 Email」才會展開。
  const [step, setStep] = useState<'choose' | 'email' | 'code'>('choose')
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
      case 'oauth-lost': return t('errOauthLost')
      case 'insecure-context': return t('errInsecureContext')
      default: return t('errUnknown')
    }
  }

  async function google() {
    setWorking(true)
    setError(null)
    try {
      // 這一行之後整個分頁就被導走了，正常情況不會回到這裡。
      await startGoogleSignIn(currentRoute())
    } catch (e) {
      setError(describe(e))
      setWorking(false)
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

        {step === 'choose' ? (
          <>
            {/*
              照 Google 自己的按鈕規範，不是這個系統的 .btn-primary。
              四色的 G 必須維持原色，放在品牌 teal 上既違反他們的規範，
              藍色與綠色的對比也不夠。
            */}
            <button
              class="btn btn-google btn-block btn-lg"
              disabled={working}
              onClick={() => { void google() }}
            >
              <IconGoogle /> {working ? t('loading') : t('signInGoogle')}
            </button>

            {/*
              Google 在 LINE／FB／IG 的內建瀏覽器裡會直接擋掉 OAuth
              （disallowed_useragent），而主揪很可能就是從 LINE 群裡點自己的
              分享連結進來的。偵測是靠 UA 猜的，會猜錯，所以按鈕不停用——
              只是先說一聲，並把備援擺在旁邊。
            */}
            {/*
              不安全來源（例如區網的 http://192.168.x.x）連 PKCE 的 challenge 都
              簽不出來，Google 也不會放行 http:// 的 redirect URI。這個跟上面的
              內建瀏覽器不同，不是猜的而是確定的，所以直接講，而且優先講——
              兩件事同時成立時，這一件才是真正走不通的那一件。
            */}
            {!secureOrigin() ? <p class="note note-warn">{t('insecureContextWarn')}</p>
              : inAppBrowser() && <p class="note note-warn">{t('inAppBrowserWarn')}</p>}
            {error && <p class="note note-warn">{error}</p>}

            <button class="btn btn-block" disabled={working} onClick={() => setStep('email')}>
              {t('signInWithEmail')}
            </button>
          </>
        ) : step === 'email' ? (
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
            <button class="btn btn-block" disabled={working} onClick={() => { setStep('choose'); setError(null) }}>
              {t('back')}
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
