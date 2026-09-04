import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, connection, copyCurrentRoom, deleteCurrentRoom, groups, identity, members,
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
import { dialableFrom, isExcusedNote, rosterToText, telHref } from '../lib/parse'
import type { Member } from '../lib/types'
import { currentRoute, joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { ConfirmDialog, Sheet } from './Sheet'
import { errorMessage } from './NewRoom'
import {
  IconBookmark, IconCalendar, IconCopy, IconDownload, IconDuplicate, IconEdit, IconHash, IconLock,
  IconChevronDown, IconGoogle, IconLink, IconPhone, IconPlus, IconPrinter, IconQr, IconShare,
  IconTag, IconTrash, IconUndo, IconUser,
} from './icons'
import { useT } from './t'

async function copyText(value: string, done: string, fail: string): Promise<void> {
  showToast((await copyToClipboard(value)) ? done : fail)
}

// ---------------------------------------------------------------------------

/**
 * 二維碼。只有打開「更多 › 分享 › 二維碼」那一頁才用得到，所以獨立成一個
 * 元件：動態載入 qrcode，首頁與點名畫面都不必背這段程式碼。
 */
function QrCard({ code, url }: { code: string; url: string }) {
  const t = useT()
  const [qr, setQr] = useState('')

  useEffect(() => {
    let alive = true
    void import('qrcode')
      .then((m) => m.default.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' }))
      .then((d) => { if (alive) setQr(d) })
      .catch(() => { /* QR 產不出來時仍可用代碼與連結 */ })
    return () => { alive = false }
  }, [url])

  if (!qr) return <p class="hint">{t('loading')}</p>
  return (
    <div class="qr-card">
      <img src={qr} alt={`${t('scanToJoin')} ${code}`} />
    </div>
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

type ManageMode = 'menu' | 'copy' | 'rename' | 'roster' | 'saveRoster' | 'walkin'
  | 'shareCode' | 'shareLink' | 'shareQr'
// 「更多」面板分頁（2026-09）。依「這個動作在動什麼」分類：'roster' 底下是
// 名單本身——資料與跟這份名單有關的現場動作；'space' 底下是空間這個容器；
// 'share' 底下是把這個空間交出去的三種方式。曾經想過一個「常用」分頁裝複製
// 結果／臨時加人／結束這一輪，但「多常按」跟「動什麼」是兩種不同的分類軸，
// 「結束這一輪」整場只按一次卻歸在「常用」裡本身就矛盾，所以拿掉，三個分頁
// 都用同一種分類方式貫穿到底。
type ManageTab = 'roster' | 'space' | 'share'
type Confirming = null | 'delete' | 'replaceRoster' | 'finish'

export function ManageSheet({ owner, group, initialTab, onCopySummary, onClose }: {
  owner: boolean
  /** 目前正在看的那一車。臨時加人要繼承它。 */
  group: string | null
  /** 「再開一個」導進新空間時直接開在分享分頁：那一刻的下一個動作 100% 是把新代碼發出去。 */
  initialTab?: ManageTab
  /** 複製結果由 Room 執行：它握著「目前這一車」的名單與 Toast，實作只留一份。 */
  onCopySummary: () => void
  onClose: () => void
}) {
  const t = useT()
  const [mode, setMode] = useState<ManageMode>('menu')
  const [tab, setTab] = useState<ManageTab>(initialTab ?? 'roster')
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
      <Sheet title={t('copyRoom')} onClose={onClose} onBack={() => setMode('menu')}>
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
      </Sheet>
    )
  }

  if (mode === 'rename') {
    return (
      <Sheet title={t('rename')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          <input
            class="input" value={value} maxLength={80} aria-label={t('rename')}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          />
          {error && <p class="note note-warn">{error}</p>}
          <button
            class="btn btn-primary btn-block"
            disabled={working || !value.trim()}
            onClick={() => { void run(async () => { await renameRoom(value); setMode('menu') }) }}
          >
            {t('save')}
          </button>
        </div>
      </Sheet>
    )
  }

  if (mode === 'roster') {
    const drafts = draftsFrom(rosterText)
    return (
      <Sheet title={t('editRoster')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          <p class="note note-warn">{t('editRosterWarning')}</p>
          <RosterInput text={rosterText} onText={setRosterText} />
          {error && <p class="note note-warn">{error}</p>}
          <button
            class="btn btn-primary btn-block"
            disabled={working || drafts.length === 0}
            onClick={() => setConfirming('replaceRoster')}
          >
            {working ? t('loading') : drafts.length ? `${t('save')} ${drafts.length}` : t('save')}
          </button>
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
      <Sheet title={t('saveAsRoster')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          <div class="field">
            <label class="label" for="roster-name">{t('saveRosterPrompt')}</label>
            <input
              id="roster-name" class="input" value={value} maxLength={80}
              onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
          {error && <p class="note note-warn">{error}</p>}
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
      </Sheet>
    )
  }

  if (mode === 'walkin') return <AddWalkInSheet group={group} onClose={onClose} onBack={() => setMode('menu')} />

  const url = joinUrl(current.code)

  /*
    分享的三種方式各自一頁，不再全部疊在同一張面板上。代碼那一頁只有代碼：
    06:50 的車門口是隔著一支手臂把它唸出去，那個字級（.code-display）需要
    整頁的寬度，旁邊再擺 QR 與連結只會讓三件事互相搶。
  */
  if (mode === 'shareCode') {
    return (
      <Sheet title={t('roomCode')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          <div class="code-display">{current.code}</div>
          <button
            class="btn btn-primary btn-block"
            onClick={() => { void copyText(current.code, t('copied'), t('copyFailed')) }}
          >
            <IconCopy /> {t('copyCode')}
          </button>
        </div>
      </Sheet>
    )
  }

  if (mode === 'shareLink') {
    return (
      <Sheet title={t('roomLink')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          {/* 連結先印出來：看得到它指去哪一個空間，才敢貼進 200 人的 LINE 群。 */}
          <p class="link-display">{url}</p>
          <button class="btn btn-primary btn-block" onClick={() => { void shareLink(url, t) }}>
            <IconShare /> {t('shareLink')}
          </button>
          <button
            class="btn btn-block"
            onClick={() => { void copyText(url, t('copied'), t('copyFailed')) }}
          >
            <IconCopy /> {t('copyLink')}
          </button>
        </div>
      </Sheet>
    )
  }

  if (mode === 'shareQr') {
    return (
      <Sheet title={t('roomQr')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          <QrCard code={current.code} url={url} />
          <p class="hint">{t('scanToJoin')}</p>
        </div>
      </Sheet>
    )
  }

  const expires = formatDate(current.expires_at, prefs.value.lang)
  // 單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。
  const localOnly = connection.value === 'local-only'
  const here = peers.value

  return (
    <Sheet title={t('manage')} onClose={onClose}>
      {/*
        面板頂端曾經有一列「身分標籤＋你的名字＋設定齒輪」，三個都不在了：

        - 身分標籤搬到頂欄的代碼前面（Room.tsx）。它回答的是「我能不能改」，
          那是進空間第一眼就該看到的事，不是點開面板才知道。
        - 「你的名字」只剩首頁的設定進得去。在空間裡改名字是個一場活動用不到
          一次的動作，卻常態佔著面板最上面一整列。
        - 設定齒輪跟著拿掉：帳號、名字、主題、語言都是跟這台裝置／這個人有關
          的東西，跟「這個空間」無關，同一個目的地不需要兩個入口。

        協助者少掉一半項目這件事仍然要講，所以 helperLimits 這句留著。
      */}
      {!owner && <p class="hint" style="margin-bottom:10px">{t('helperLimits')}</p>}

      {/*
        擠在一條選單裡，掃過去要找的那一項常常要滾好幾屏。分兩頁，依「這個
        動作在動什麼」分類：「名單」是名單本身的資料與跟它有關的現場動作，
        「空間」是空間這個容器。分頁沿用篩選列同一顆 `.segmented`——它已經
        是這個 app 裡「切換一組看哪個子集合」的固定手勢，不必再學一種新的
        切法。

        分頁鍵排列是「空間、名單」，但預設打開的仍是「名單」：這裡的複製
        結果／臨時加人是收尾與現場最常按的動作，開面板就看得到比較重要，
        跟哪顆鍵排在左邊是兩件事。
      */}
      <div class="segmented" role="group" aria-label={t('manageTabs')}>
        <button class="segment" aria-pressed={tab === 'space'} onClick={() => setTab('space')}>
          {t('manageTabSpace')}
        </button>
        <button class="segment" aria-pressed={tab === 'roster'} onClick={() => setTab('roster')}>
          {t('manageTabRoster')}
        </button>
        <button class="segment" aria-pressed={tab === 'share'} onClick={() => setTab('share')}>
          {t('share')}
        </button>
      </div>

      {tab === 'roster' && (
        <div class="menu">
          {/*
            編輯名單、存成常用名單排最前：這兩項通常在活動開始、名單還沒
            開始點名時就會用到。
          */}
          {owner && (
            <button
              class="menu-item"
              onClick={() => { setRosterText(rosterToText(members.value)); setMode('roster') }}
            >
              <IconEdit />
              <span><strong>{t('editRoster')}</strong></span>
            </button>
          )}

          {owner && isSupabaseConfigured && (
            <button
              class="menu-item"
              onClick={() => { setValue(current.name); setMode('saveRoster') }}
            >
              <IconBookmark />
              <span><strong>{t('saveAsRoster')}</strong></span>
            </button>
          )}

          {/* 複製的範圍跟著目前選的分組，所以動作交回 Room 執行。 */}
          <button class="menu-item" onClick={() => { onCopySummary(); onClose() }}>
            <IconCopy />
            <span>
              <strong>{t('copySummary')}</strong>
              <span class="sub">{t('copySummaryHint')}</span>
            </span>
          </button>

          {/* 協助者站在車門口也用得到，所以不放在 owner 限定的項目裡。 */}
          {!closed && (
            <button class="menu-item" onClick={() => setMode('walkin')}>
              <IconPlus />
              <span>
                <strong>{t('addWalkIn')}</strong>
                <span class="sub">{t('walkInPlaceholder')}</span>
              </span>
            </button>
          )}

          <button class="menu-item" onClick={() => { onClose(); setTimeout(() => window.print(), 60) }}>
            <IconPrinter />
            <span>
              <strong>{t('printRoster')}</strong>
              <span class="sub">{t('printHint')}</span>
            </span>
          </button>

          <button
            class="menu-item"
            onClick={() => downloadFile(csvFilename(current), toCsv(members.value, prefs.value.lang))}
          >
            <IconDownload />
            <span><strong>{t('exportCsv')}</strong></span>
          </button>
        </div>
      )}

      {tab === 'space' && (
        <div class="menu">
          {/* 重新命名排最前：通常在活動一開始、名字還沒定案時就會用到。 */}
          {owner && (
            <button class="menu-item" onClick={() => { setValue(current.name); setMode('rename') }}>
              <IconTag />
              <span><strong>{t('rename')}</strong></span>
            </button>
          )}

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
          )}

          {owner && (
            <button class="menu-item danger" onClick={() => setConfirming('delete')}>
              <IconTrash />
              <span><strong>{t('deleteRoom')}</strong></span>
            </button>
          )}
        </div>
      )}

      {/*
        分享從頂欄那顆圖示鍵搬進這裡（2026-09）。三種方式各自一列、各自一頁，
        順序照現場真的會用到的先後：代碼是隔著車門喊得出去的東西，連結是貼進
        LINE 群的，二維碼要對方拿起手機對著你的螢幕——愈往下愈需要兩個人站在
        一起。
      */}
      {tab === 'share' && (localOnly ? (
        /*
          單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。這個空間真的
          只存在這支手機裡，代碼、連結、二維碼對任何人都沒有用——發出去只會讓
          五個同工站在車門口看到「找不到這個代碼。請確認有沒有打錯」，然後以為
          是自己打錯而重打三次。所以這一頁不列那三種方式，改成講清楚會發生什麼。
        */
        <div class="stack">
          <p class="note note-warn">
            <strong>{t('shareLocalTitle')}</strong><br />{t('shareLocalBody')}
          </p>
          <p class="hint">{t('shareLocalHow')}</p>
        </div>
      ) : (
        <>
          <div class="menu">
            <button class="menu-item" onClick={() => setMode('shareCode')}>
              <IconHash />
              <span>
                <strong>{t('roomCode')}</strong>
                <span class="sub mono">{current.code}</span>
              </span>
            </button>

            <button class="menu-item" onClick={() => setMode('shareLink')}>
              <IconLink />
              <span>
                <strong>{t('roomLink')}</strong>
                <span class="sub">{t('shareLinkText')}</span>
              </span>
            </button>

            <button class="menu-item" onClick={() => setMode('shareQr')}>
              <IconQr />
              <span>
                <strong>{t('roomQr')}</strong>
                <span class="sub">{t('scanToJoin')}</span>
              </span>
            </button>
          </div>

          <p class="hint" style="margin-top:12px">{t('shareHint')}</p>

          {/*
            誰已經進來了。06:50 車門口「大家都進來了嗎」現在只能用喊的，而喊得到
            的前提是五個人在同一個地方——他們散在兩台車的前後門。更常見的失敗是
            有人掃了二維碼但停在瀏覽器的「要開啟嗎」對話框上，自己以為進來了；等到
            07:12 發現有一車根本沒人在點，已經沒有第二次機會。
            離線時不顯示（誠實原則：那時候這個數字只是舊的）。
          */}
          {connection.value === 'online' && presenceReady.value && (
            <div class="field" style="margin-top:12px">
              <span class="label">{t('whoIsHere')}</span>
              <p class="note">
                {here.length <= 1
                  ? t('onlyYouHere')
                  : t('peersHere', { n: here.length, names: peerNames(here, t) })}
              </p>
            </div>
          )}
        </>
      ))}

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

  // 「陳大同（請假）」這種名單，note 是「請假」，下面又有一顆會標成「請假」的
  // 狀態切換鍵：兩個都印備註原文的話，這個面板會同時看到「備註：請假」與
  // 一顆已經在講同一件事的按鈕，備註沒有多給任何資訊，純粹是雜訊。
  const noteIsStatus = member.status === 'excused' && isExcusedNote(member.note)

  const notedPhones = dialableFrom(member.note)
  // 「王小明 0912345678」這種名單，note 整則就是一支電話號碼：備註欄位跟
  // 下面的撥號鍵會連續印兩次一模一樣的數字。撥號鍵已經把這串數字講完了
  // （還多了一顆可以按），備註原文在這裡沒有多給任何資訊，是重複。
  const noteIsJustPhone = notedPhones.length === 1 && member.note?.trim() === notedPhones[0]
  const extraPhones = notedPhones.filter((d) => d.replace(/\D/g, '') !== member.phone)

  // 分隔線只留一條，畫在「查得到的資訊」與「會改動這個人的動作」之間——這是
  // 唯一真的需要隔開的界線。下面的狀態鍵、改分組、移除，本來各自帶一條自己的
  // 分隔線，三個都只裝一兩項東西，畫面被切成一截一截，比它們要分開的東西還
  // 顯眼。狀態鍵改用文字位置分開、移除鍵單靠 .danger 的紅色跟排在最後（跟
  // ManageSheet 的「刪除空間」同一套做法），都不必再各自開一條線。
  const hasInfoSection = (member.note && !noteIsStatus && !noteIsJustPhone) || Boolean(member.phone) || extraPhones.length > 0
  const hasActionsSection = !closed || owner

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
        {/*
          備註原文搬到這裡：名單列只留辨識晶片與狀態，備註本身查才需要，不必
          一直印在畫面上。放在撥號鍵之前，因為下面那些從備註裡認出來的號碼
          （見下一段註解）就是從這段文字裡抽出來的——先看到原文，再看到抽出
          的號碼，順序才對得上。
        */}
        {member.note && !noteIsStatus && !noteIsJustPhone && (
          <div class="field" style="padding: var(--sp-2) 12px 8px">
            <span class="label">{t('noteLabel')}</span>
            <p style="margin:0">{member.note}</p>
          </div>
        )}

        {/*
          撥號鍵有兩個來源。上面那個是結構化的 phone 欄位——舊名單留下來的，
          解析器現在不再產生它（見 `parse.ts` 的 `NAME_TAIL`）。下面那些是從備註
          裡認出來的：解析階段刻意不判斷任何一串數字是什麼，這個判斷改在這裡做，
          因為**顯示層猜錯是可逆、可見的**（多一顆鍵，備註原文一字未動），而存進
          資料庫的假號碼是看不見的。
        */}
        {member.phone && (
          <a class="menu-item" href={`tel:${member.phone}`}>
            <IconPhone />
            <span>
              <strong class="mono">{member.phone}</strong>
              <span class="sub">{member.name}</span>
            </span>
          </a>
        )}

        {extraPhones.map((d) => (
          <a key={d} class="menu-item" href={telHref(d)}>
            <IconPhone />
            <span>
              <strong class="mono">{d}</strong>
              <span class="sub">{t('fromNote')}</span>
            </span>
          </a>
        ))}

        {hasInfoSection && hasActionsSection && <div class="menu-divider" />}

        {/*
          「標記已到」不放在這裡：名單列整片可點就是切換已到，任何狀態
          點下去都會變成已到（見 Room.tsx 的 toggle()）——面板裡再放一顆
          一模一樣的按鈕只是重複，是這個面板看起來雜亂的原因之一。

          「改回未到」只在請假狀態才留：從已到點名單列就會變回未到，這條
          路本來就有；但從請假點名單列只會跳去已到，回未到沒有第二條路，
          這顆鍵是唯一入口，不能一起拿掉。
        */}
        {!closed && member.status === 'excused' && (
          <button class="menu-item" onClick={() => mark('pending', t('missing'))}>
            <IconUndo />
            <span><strong>{t('markMissing')}</strong></span>
          </button>
        )}
        {!closed && member.status !== 'excused' && (
          <button class="menu-item" onClick={() => mark('excused', t('excused'))}>
            <IconCalendar />
            <span><strong>{t('markExcused')}</strong></span>
          </button>
        )}

        {owner && groups.value.length > 0 && (
          <div class="field" style="padding: var(--sp-2) 12px 8px">
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
        )}

        {/*
          移除不再自己開一條分隔線：狀態鍵、改分組、移除三個都只裝一兩項
          東西，各自一條線會把面板切成一截一截，比它們要分開的東西還顯眼。
          移除單靠 .danger 的紅色跟排在最後跟其他動作分開——跟 ManageSheet
          的「刪除空間」同一套做法，這個面板不必另外發明一條規則。
        */}
        {owner && (
          <button class="menu-item danger" onClick={() => setConfirmingDelete(true)}>
            <IconTrash />
            <span>
              <strong>{t('removeMember')}</strong>
              <span class="sub">{t('removeMemberSub')}</span>
            </span>
          </button>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

export function AddWalkInSheet({ group, onClose, onBack }: {
  group: string | null
  onClose: () => void
  onBack?: () => void
}) {
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
    <Sheet title={t('addWalkIn')} onClose={onClose} onBack={onBack}>
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
  const [themeOpen, setThemeOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)

  // 登入成功後要一路關到底：使用者的心智模型是「我登入了，讓我看到我的東西」，
  // 留在設定面板上會讓人以為沒成功。
  if (signingIn) {
    return <SignInSheet onCancel={() => setSigningIn(false)} onDone={onClose} />
  }

  return (
    <Sheet title={t('settings')} onClose={onClose}>
      <div class="stack">
        {/*
          名字是這台裝置的本機顯示名，帳號是雲端登入——兩件不同的事，曾經
          擠進同一列（合成一個 .row），但那樣會把「你是誰」跟「這台裝置管
          不管得動雲端」混成一件事。分開回兩塊：名字維持自己獨立的輸入框；
          未登入時帳號縮成一顆 .menu-item（管理面板同一套列表元件），整列
          可點、一行講完「登入」＋為什麼，比原本「標籤＋整寬按鈕＋說明」
          省事，但沒有跟名字混在一起。
        */}
        <div class="field">
          <label class="label" for="checker-name">{t('yourName')}</label>
          <input
            id="checker-name" class="input" value={name} maxLength={40}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => { void setCheckerName(name) }}
          />
          <span class="hint">{t('yourNameHint')}</span>
        </div>

        {isSupabaseConfigured && (session.value ? (
          <div class="field">
            <div class="row">
              <span class="hint" style="flex:1">
                {t('signedInAs', { email: session.value.email })}
              </span>
              <button class="btn btn-sm" onClick={() => { void signOut() }}>{t('signOut')}</button>
            </div>
            {/* 這支手機可能就是今天唯一管得動這場活動的裝置。按登出的常見
                動機是「借手機給人用一下」，使用者不會預期代價是失去控制。
                不加確認對話框（重新登入就還原），但後果要講出來——所以登出
                跟登入不一樣，不做成整列可點的 .menu-item：那樣一大塊觸控
                區域配一個有後果的動作，比一顆刻意小的按鈕更容易誤觸。 */}
            <p class="hint">{t('signOutWhat')}</p>
          </div>
        ) : (
          <button class="menu-item" onClick={() => setSigningIn(true)}>
            <IconUser />
            <span>
              <strong>{t('signIn')}</strong>
              <span class="sub">{t('signInWhy')}</span>
            </span>
          </button>
        ))}

        {/*
          主題／語言各只有 2-3 個選項，卻常態佔著一整條 .segmented 的高度，
          而這兩個是「設一次、很少再改」的偏好，不像篩選段是點名全程反覆
          在用的東西。改成摺疊列：預設收合只顯示目前的值，點了才展開
          .segmented（跟篩選列、管理面板分頁同一顆元件，見 roll-call.md
          「分段控制」）；選了選項就收回去，不必再點一次收合。
        */}
        <div class="field">
          <button class="select-row" aria-expanded={themeOpen} onClick={() => setThemeOpen((v) => !v)}>
            <span class="label">{t('theme')}</span>
            <span class="select-row-value">
              {p.theme === 'system' ? t('themeSystem') : p.theme === 'light' ? t('themeLight') : t('themeDark')}
              <IconChevronDown class={themeOpen ? 'select-row-chevron is-open' : 'select-row-chevron'} />
            </span>
          </button>
          {themeOpen && (
            <div class="segmented" role="group" aria-label={t('theme')}>
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  class="segment"
                  aria-pressed={p.theme === theme}
                  onClick={() => { void setPrefs({ theme }); setThemeOpen(false) }}
                >
                  {theme === 'system' ? t('themeSystem') : theme === 'light' ? t('themeLight') : t('themeDark')}
                </button>
              ))}
            </div>
          )}
        </div>

        <div class="field">
          <button class="select-row" aria-expanded={langOpen} onClick={() => setLangOpen((v) => !v)}>
            <span class="label">{t('language')}</span>
            <span class="select-row-value">
              {p.lang === 'zh' ? '中文' : 'English'}
              <IconChevronDown class={langOpen ? 'select-row-chevron is-open' : 'select-row-chevron'} />
            </span>
          </button>
          {langOpen && (
            <div class="segmented" role="group" aria-label={t('language')}>
              {(['zh', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  class="segment"
                  aria-pressed={p.lang === lang}
                  onClick={() => { void setPrefs({ lang }); setLangOpen(false) }}
                >
                  {lang === 'zh' ? '中文' : 'English'}
                </button>
              ))}
            </div>
          )}
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
