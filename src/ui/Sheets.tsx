import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, connection, copyRoom, deleteRoom, deleteSavedRoster, forgetRecentRoom, groups,
  identity, members, myRooms, openMenuOnEnter, prefs, recentRooms, removeMember, renameRoom,
  renameSavedRoster, replaceRoster, requestCode, room, saveRosterAs, savedRosters,
  peers, presenceReady, session, setCheckerName, setMemberGroup, setPrefs, setRoomClosed, setStatusWithUndo,
  showToast, type Peer,
  signIn, signOut, startGoogleSignIn,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { copyToClipboard } from '../lib/clipboard'
import { inAppBrowser, secureOrigin } from '../lib/config'
import { csvFilename, downloadFile, toCsv, toShareText } from '../lib/export'
import { formatDate } from '../lib/format'
import { dialableFrom, isExcusedNote, rosterToText, telHref } from '../lib/parse'
import type { Member, SavedRoster } from '../lib/types'
import { currentRoute, joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { ConfirmDialog, Sheet } from './Sheet'
import { errorMessage } from './NewRoom'
import {
  IconBookmark, IconCalendar, IconClose, IconCopy, IconDownload, IconDuplicate, IconEdit, IconHash,
  IconLock, IconChevronDown, IconGoogle, IconLink, IconMore, IconPdf, IconPhone, IconPlus, IconPrinter,
  IconQr, IconShare, IconTrash, IconUndo,
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

/**
 * 列印。`mode` 決定印出來的是哪一份文件：
 * - 'blank'：空白格子的紙本，手機沒電時拿筆勾。
 * - 'result'：目前的點名結果，交差用；在列印畫面選「儲存為 PDF」就是一個檔案。
 *
 * 記號下在 <html> 上讓 @media print 讀，列印畫面關掉之後一定要拿掉，不然下一次
 * 列印會沿用上一次的樣子。afterprint 在某些瀏覽器不會來，所以再壓一個逾時保底。
 */
function printSheet(mode: 'blank' | 'result', onClose: () => void): void {
  const root = document.documentElement
  if (mode === 'result') root.dataset.print = 'result'
  const done = () => {
    delete root.dataset.print
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  setTimeout(done, 60_000)
  // 先關面板：遮罩在紙上是看不到的，但使用者按完要看得到自己的名單。
  onClose()
  setTimeout(() => window.print(), 60)
}

// ---------------------------------------------------------------------------

type ManageMode = 'menu' | 'edit' | 'saveRoster' | 'walkin' | 'export' | 'copy'
  | 'invite' | 'inviteCode' | 'inviteLink' | 'inviteQr'
/** 「編輯」底下的兩半：這場活動叫什麼、有誰。 */
type EditTab = 'name' | 'roster'
type Confirming = null | 'replaceRoster' | 'finish' | 'delete' | 'forget'

/**
 * 空間的「更多」。**整個 app 只有這一份清單**（2026-09）。
 *
 * 它一度被拆成兩份：空間裡一份（點名當下的動作）、首頁每個空間一份（空間這個
 * 容器的動作）。分法本身說得通，但使用者要記的是兩份不一樣的清單——同一顆
 * 「更多」在兩個地方打開不一樣的東西，就得先想「我剛剛是從哪裡按的」。
 * 現在首頁那顆「更多」直接把人帶進空間再打開這一份（`openMenuOnEnter`），
 * 兩邊看到的永遠一模一樣。
 *
 * 順帶：先進空間才打開，這份清單裡的每一項才都做得到——編輯名單、臨時加人、
 * 匯出結果、結束這一輪動的都是這個空間的即時資料，在首頁那種「還沒載入」的
 * 狀態下只能做出一份能力比較弱的第二種選單，那正是要消滅的東西。
 */
export function ManageSheet({ owner, group, initialMode, onCopySummary, onClose }: {
  owner: boolean
  /** 目前正在看的那一車。臨時加人要繼承它。 */
  group: string | null
  /** 剛建立完副本時直接開在邀請頁：那一刻的下一個動作 100% 是把新代碼發出去。 */
  initialMode?: ManageMode
  /** 複製結果由 Room 執行：它握著「目前這一車」的名單與 Toast，實作只留一份。 */
  onCopySummary: () => void
  onClose: () => void
}) {
  const t = useT()
  const [mode, setMode] = useState<ManageMode>(initialMode ?? 'menu')
  const [editTab, setEditTab] = useState<EditTab>('name')
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [value, setValue] = useState('')
  const [rosterText, setRosterText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = room.value
  if (!current) return null
  const closed = Boolean(current.closed_at)
  const url = joinUrl(current.code)
  // 單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。
  const localOnly = connection.value === 'local-only'
  // 「從清單移除」只對本機那份「最近的空間」有意義：「我的活動」是帳號那邊的
  // 清單，移掉了下一次同步又會長回來——那是一顆按了看起來沒反應的按鈕。
  const inRecents = recentRooms.value.some((r) => r.code === current.code)
  const inMyRooms = Boolean(session.value) && myRooms.value.some((r) => r.code === current.code)
  const forgettable = inRecents && !inMyRooms

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

  /*
    編輯：名稱與名單在同一頁，用一顆分段控制切（2026-09 合併）。

    它們原本是兩列（「重新命名」「編輯名單」），而那兩列動的是同一份東西的兩半
    ——「這場活動叫什麼」跟「有誰」。分成兩列等於要使用者在按下去之前先替自己
    的意圖分類，可是真正要改的時候常常是兩個一起改（名字打錯、順便補上兩個人）。
    合併之後那個分類還在，只是搬到頁面裡面用一顆分段控制講完，而且切過去不必
    退回選單再點一次。
  */
  if (mode === 'edit') {
    const drafts = draftsFrom(rosterText)
    return (
      <Sheet title={t('edit')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="segmented" role="group" aria-label={t('edit')}>
          <button class="segment" aria-pressed={editTab === 'name'} onClick={() => setEditTab('name')}>
            {t('editName')}
          </button>
          <button class="segment" aria-pressed={editTab === 'roster'} onClick={() => setEditTab('roster')}>
            {t('roster')}
          </button>
        </div>

        {editTab === 'name' ? (
          <div class="stack">
            <input
              class="input" value={value} maxLength={80} aria-label={t('editName')}
              onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            />
            {error && <p class="note note-warn">{error}</p>}
            <button
              class="btn btn-primary btn-block"
              disabled={working || !value.trim()}
              onClick={() => { void run(async () => { await renameRoom(current.code, value); setMode('menu') }) }}
            >
              {working ? t('loading') : t('save')}
            </button>
          </div>
        ) : (
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
        )}

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

  if (mode === 'copy') {
    return (
      <Sheet title={t('copyRoom')} onClose={onClose} onBack={() => setMode('menu')}>
        <div class="stack">
          {/* 協助者要知道新空間會是他的——選單列的副標拿掉之後，只剩這裡說得出來。 */}
          <p class="hint">{owner ? t('copyRoomHint') : t('copyRoomHintHelper')}</p>
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
              const code = await copyRoom(current.code, value)
              onClose()
              // 副本是新的代碼，而五支協助的手機還開著舊空間——他們的畫面完全沒有
              // 變化，會繼續在舊空間打勾。複製完的下一個動作 100% 是把新代碼發
              // 出去，所以直接導進新空間、面板停在邀請頁。
              openMenuOnEnter.value = { code, mode: 'invite' }
              navigate(`/r/${code}`)
            }) }}
          >
            {working ? t('loading') : t('confirm')}
          </button>
        </div>
      </Sheet>
    )
  }

  /*
    邀請的三種方式各自一頁，不全部疊在同一張面板上。代碼那一頁只有代碼：
    06:50 的車門口是隔著一支手臂把它唸出去，那個字級（.code-display）需要
    整頁的寬度，旁邊再擺 QR 與連結只會讓三件事互相搶。
  */
  if (mode === 'inviteCode') {
    return (
      <Sheet title={t('roomCode')} onClose={onClose} onBack={() => setMode('invite')}>
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

  if (mode === 'inviteLink') {
    return (
      <Sheet title={t('roomLink')} onClose={onClose} onBack={() => setMode('invite')}>
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

  if (mode === 'inviteQr') {
    return (
      <Sheet title={t('roomQr')} onClose={onClose} onBack={() => setMode('invite')}>
        <div class="stack">
          <QrCard code={current.code} url={url} />
          <p class="hint">{t('scanToJoin')}</p>
        </div>
      </Sheet>
    )
  }

  if (mode === 'invite') {
    return (
      <Sheet title={t('invite')} onClose={onClose} onBack={() => setMode('menu')}>
        {/*
          單機模式下這個空間真的只存在這支手機裡，代碼、連結、二維碼對任何人都
          沒有用——發出去只會讓五個同工站在車門口看到「找不到這個代碼。請確認有
          沒有打錯」，然後以為是自己打錯而重打三次。所以那三列不列，改成講清楚
          會發生什麼。
        */}
        {localOnly ? (
          <div class="stack">
            <p class="note note-warn">
              <strong>{t('shareLocalTitle')}</strong><br />{t('shareLocalBody')}
            </p>
            <p class="hint">{t('shareLocalHow')}</p>
          </div>
        ) : (
          <>
            <div class="menu">
              <button class="menu-item" onClick={() => setMode('inviteCode')}>
                <IconHash />
                <span>
                  <strong>{t('roomCode')}</strong>
                  <span class="sub mono">{current.code}</span>
                </span>
              </button>

              <button class="menu-item" onClick={() => setMode('inviteLink')}>
                <IconLink />
                <span><strong>{t('roomLink')}</strong></span>
              </button>

              <button class="menu-item" onClick={() => setMode('inviteQr')}>
                <IconQr />
                <span><strong>{t('roomQr')}</strong></span>
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
                  {peers.value.length <= 1
                    ? t('onlyYouHere')
                    : t('peersHere', { n: peers.value.length, names: peerNames(peers.value, t) })}
                </p>
              </div>
            )}
          </>
        )}
      </Sheet>
    )
  }

  /*
    把這一場的結果交出去的四種方式。複製結果 2026-09 從選單搬進來：它跟 CSV、
    PDF 是同一件事的三種格式（貼進 LINE、進試算表、存成檔案），分開放在兩層
    選單裡只會讓人以為它們是不同的東西。

    紙本與 PDF 走的是同一個列印畫面，但印出來的是兩份不同的文件：紙本印空白
    格子（手機沒電時用筆勾），PDF 印目前的點名結果（交差用）。差別由
    <html data-print> 決定，見 styles.css 的 @media print。所以紙本排在最後：
    另外三列帶走的都是「今天點到哪裡」，只有它帶走的是一張還沒開始點的表。

    瀏覽器沒有「下載 PDF」這種 API，PDF 一律是從列印畫面選「儲存為 PDF」存下來
    的——所以標籤寫「存成 PDF」而不是「下載 PDF」，上面那句 hint 也直說會跳出
    列印畫面。要真的產出一個 .pdf 檔就得自己畫版面再嵌一份中文字型，那是好幾 MB
    的字型檔，對一個要在 6:50 的停車場用爛網路開起來的工具划不來。
  */
  if (mode === 'export') {
    return (
      <Sheet title={t('export')} onClose={onClose} onBack={() => setMode('menu')}>
        <p class="hint" style="margin-bottom:10px">{t('exportHint')}</p>
        <div class="menu">
          {/* 複製的範圍跟著目前選的分組，所以動作交回 Room 執行。 */}
          <button class="menu-item" onClick={() => { onCopySummary(); onClose() }}>
            <IconCopy />
            <span><strong>{t('copySummary')}</strong></span>
          </button>

          <button
            class="menu-item"
            onClick={() => downloadFile(csvFilename(current), toCsv(members.value, prefs.value.lang))}
          >
            <IconDownload />
            <span><strong>{t('exportCsv')}</strong></span>
          </button>

          <button class="menu-item" onClick={() => printSheet('result', onClose)}>
            <IconPdf />
            <span><strong>{t('exportPdf')}</strong></span>
          </button>

          <button class="menu-item" onClick={() => printSheet('blank', onClose)}>
            <IconPrinter />
            <span><strong>{t('printRoster')}</strong></span>
          </button>
        </div>
      </Sheet>
    )
  }

  const expires = formatDate(current.expires_at, prefs.value.lang)

  return (
    <Sheet
      title={current.name}
      onClose={onClose}
      /*
        標題列印的是空間的名字。它曾經是「更多」（那兩個字說不出任何一件這裡做得到
        的事，所以拿掉），接著是三顆分頁鍵（分頁 2026-09 也拿掉了）。名字是這一列
        唯一還說得出東西的東西：這些動作要動的是哪一個空間。

        用 `head` 傳而不是用 `title` 印，是為了不要那顆關閉鍵：收起來靠點面板外面、
        Esc、或從這一列往下滑，三條路都在，都不佔位置。無障礙名稱一樣是這個名字。
      */
      head={<h2 class="sheet-title">{current.name}</h2>}
    >
      {/* 協助者看到的項目少一半，要有一句話說清楚少了什麼。 */}
      {!owner && <p class="hint" style="margin-bottom:10px">{t('helperLimits')}</p>}

      {/*
        排列照一場活動的時間軸走：發代碼、把名單弄對（出發前）→ 臨時加人（現場）
        → 匯出結果、結束這一輪（車開了）→ 建立副本（回程）→ 不要了（清單、刪除）。
        破壞性的兩項排最後，而且中間隔著一整段距離。
      */}
      <div class="menu">
        <button class="menu-item" onClick={() => setMode('invite')}>
          <IconShare />
          <span><strong>{t('invite')}</strong></span>
        </button>

        {/* 名稱與名單在同一頁，用分段控制切——它們是同一份東西的兩半。 */}
        {owner && (
          <button
            class="menu-item"
            onClick={() => {
              setValue(current.name)
              setRosterText(rosterToText(members.value))
              setEditTab('name')
              setMode('edit')
            }}
          >
            <IconEdit />
            <span><strong>{t('edit')}</strong></span>
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

        {/* 協助者站在車門口也用得到，所以不放在 owner 限定的項目裡。 */}
        {!closed && (
          <button class="menu-item" onClick={() => setMode('walkin')}>
            <IconPlus />
            <span><strong>{t('addWalkIn')}</strong></span>
          </button>
        )}

        {/* 匯出不經過伺服器，單機模式下照樣在。 */}
        <button class="menu-item" onClick={() => setMode('export')}>
          <IconDownload />
          <span><strong>{t('export')}</strong></span>
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
            <span><strong>{closed ? t('reopenRoom') : t('finishRound')}</strong></span>
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
          <span><strong>{t('copyRoom')}</strong></span>
        </button>

        {/*
          「從清單移除」跟「刪除空間」隔壁排，是刻意的：它們以前一個是首頁清單上的
          垃圾桶圖示、一個藏在面板第九項，長得完全不像同一種東西，但使用者想的都是
          「我不要再看到這個」。擺在一起、各自寫清楚做了什麼，才選得對。
        */}
        {forgettable && (
          <button class="menu-item" onClick={() => setConfirming('forget')}>
            <IconClose size={20} />
            <span><strong>{t('forget')}</strong></span>
          </button>
        )}

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

      {/*
        從清單移除也要問一次。它在首頁曾經是一顆一按就生效的垃圾桶，但在單機模式
        下它同時會清掉本機那份快照——那個空間就真的沒了，而按鍵旁邊沒有一個字
        說得出這件事。現在它跟刪除空間隔壁排，更不能讓兩顆長得一樣的鍵一顆要確認、
        一顆不用。
      */}
      {confirming === 'forget' && (
        <ConfirmDialog
          title={t('forget')}
          body={localOnly ? t('forgetWarningLocal') : t('forgetWarning')}
          confirmLabel={t('forget')}
          danger={localOnly}
          onClose={() => setConfirming(null)}
          onConfirm={() => { void run(async () => {
            await forgetRecentRoom(current.code)
            onClose()
            navigate('/')
          }) }}
        />
      )}

      {confirming === 'delete' && (
        <ConfirmDialog
          title={t('deleteRoom')}
          body={t('deleteRoomWarning')}
          confirmLabel={t('deleteRoom')}
          danger
          onClose={() => setConfirming(null)}
          onConfirm={() => { void run(async () => { await deleteRoom(current.code); onClose(); navigate('/') }) }}
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

type SavedRosterMode = 'list' | 'actions' | 'rename'

/**
 * 常用名單清單。開空間的「常用」鍵直接開這一頁——不再是「更多」底下的一個
 * 分頁，這個按鈕本身現在只做這一件事。每一列可以直接點來套用；右邊的
 * 「更多」另外開一層，管重新命名跟刪除，避免整列變成一顆按鈕之後塞不進
 * 兩種完全不同的動作（套用 vs. 改名單本身）。
 */
export function SavedRostersSheet({ onApply, onClose }: {
  onApply: (roster: SavedRoster) => void
  onClose: () => void
}) {
  const t = useT()
  const [mode, setMode] = useState<SavedRosterMode>('list')
  const [active, setActive] = useState<SavedRoster | null>(null)
  const [value, setValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  if (mode === 'actions' && active) {
    return (
      <Sheet title={active.name} onClose={onClose} onBack={() => setMode('list')}>
        <div class="menu">
          <button class="menu-item" onClick={() => { setValue(active.name); setMode('rename') }}>
            <IconEdit />
            <span><strong>{t('rename')}</strong></span>
          </button>
          <button class="menu-item danger" onClick={() => setConfirmingDelete(true)}>
            <IconTrash />
            <span><strong>{t('deleteRoster')}</strong></span>
          </button>
        </div>
        {error && <p class="note note-warn">{error}</p>}

        {confirmingDelete && (
          <ConfirmDialog
            title={t('confirmDeleteRosterTitle', { name: active.name })}
            body={t('deleteRosterWarning')}
            confirmLabel={t('deleteRoster')}
            danger
            onClose={() => setConfirmingDelete(false)}
            onConfirm={() => { void run(async () => { await deleteSavedRoster(active.id); setMode('list') }) }}
          />
        )}
      </Sheet>
    )
  }

  if (mode === 'rename' && active) {
    return (
      <Sheet title={t('rename')} onClose={onClose} onBack={() => setMode('actions')}>
        <div class="stack">
          <input
            class="input" value={value} maxLength={80} aria-label={t('rename')}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          />
          {error && <p class="note note-warn">{error}</p>}
          <button
            class="btn btn-primary btn-block"
            disabled={working || !value.trim()}
            onClick={() => { void run(async () => { await renameSavedRoster(active, value); setMode('list') }) }}
          >
            {t('save')}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={t('savedRosters')} onClose={onClose}>
      <div class="stack">
        {savedRosters.value.length === 0 ? (
          <p class="note">{t('noSavedRosters')}</p>
        ) : (
          <div class="menu">
            {savedRosters.value.map((r) => (
              <div class="row" key={r.id}>
                <button class="menu-item" style="flex:1; min-width:0" onClick={() => onApply(r)}>
                  <IconBookmark />
                  <span>
                    <strong>{r.name}</strong>
                    <span class="sub">{t('parsedCount', { n: r.members.length })}</span>
                  </span>
                </button>
                <button
                  class="icon-btn"
                  onClick={() => { setActive(r); setMode('actions') }}
                  aria-label={`${r.name} ${t('manage')}`}
                >
                  <IconMore />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

/**
 * 設定頁的一列：標籤、目前的值、一顆箭頭；點了才展開自己的內容。
 *
 * 定義在元件外面不是風格問題——寫在 SettingsSheet 裡面的話每次 render 都是
 * 一個新的元件型別，Preact 會把整棵子樹拆掉重建，暱稱打到一半就會掉焦點。
 */
function SettingRow({ label, value, open, onToggle, children }: {
  label: string
  /** 收合時右邊那段字：這一列現在是什麼。四列都要有，這是不用展開就看得到的資訊。 */
  value: string
  open: boolean
  onToggle: () => void
  children: ComponentChildren
}) {
  return (
    <div class="field">
      <button class="select-row" aria-expanded={open} onClick={onToggle}>
        <span class="label">{label}</span>
        <span class="select-row-value">
          <span class="select-row-text">{value}</span>
          <IconChevronDown class={open ? 'select-row-chevron is-open' : 'select-row-chevron'} />
        </span>
      </button>
      {open && children}
    </div>
  )
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const p = prefs.value
  const [name, setName] = useState(identity.value.checkerName)
  const [signingIn, setSigningIn] = useState(false)
  /*
    一次只開一列。四列都是「設一次、很少再改」的偏好，同時攤開只是把面板拉長；
    而且展開的內容（輸入框、登出鍵、分段控制）互相之間沒有關係，不必並排比較。
  */
  const [open, setOpen] = useState<null | 'name' | 'account' | 'theme' | 'lang'>(null)

  // 登入成功後要一路關到底：使用者的心智模型是「我登入了，讓我看到我的東西」，
  // 留在設定面板上會讓人以為沒成功。
  if (signingIn) {
    return <SignInSheet onCancel={() => setSigningIn(false)} onDone={onClose} />
  }

  const toggle = (row: 'name' | 'account' | 'theme' | 'lang') =>
    () => setOpen((cur) => (cur === row ? null : row))
  const themeName = p.theme === 'system' ? t('themeSystem')
    : p.theme === 'light' ? t('themeLight') : t('themeDark')

  return (
    <Sheet title={t('settings')} onClose={onClose}>
      {/*
        四列長得一模一樣：暱稱、帳戶、主題、語言。它們是同一種東西——跟這台
        裝置／這個人有關的偏好，跟任何一個空間無關（所以這個面板只從首頁進得
        去，見 04-components/overlays.md）。以前暱稱是一直攤開的輸入框、帳戶
        是一顆 .menu-item，主題與語言才是摺疊列，三種長相排在一起，讀起來像
        三件不相干的事。收合時右邊直接印出目前的值，不展開也看得到自己設了什麼。
      */}
      <div class="stack">
        <SettingRow
          label={t('yourName')}
          value={name.trim() || t('notSet')}
          open={open === 'name'}
          onToggle={toggle('name')}
        >
          <input
            id="checker-name" class="input" value={name} maxLength={40}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => { void setCheckerName(name) }}
          />
          <span class="hint">{t('yourNameHint')}</span>
        </SettingRow>

        {/* 沒設定雲端的建置沒有帳戶這回事，整列不出現——不給一個按了只會說
            「還沒設定雲端連線」的入口。 */}
        {isSupabaseConfigured && (
          <SettingRow
            label={t('account')}
            value={session.value ? session.value.email : t('notSignedIn')}
            open={open === 'account'}
            onToggle={toggle('account')}
          >
            {session.value ? (
              <>
                {/* 這支手機可能就是今天唯一管得動這場活動的裝置。按登出的常見
                    動機是「借手機給人用一下」，使用者不會預期代價是失去控制。
                    不加確認對話框（重新登入就還原），但後果要講出來。 */}
                <button class="btn btn-sm" onClick={() => { void signOut() }}>{t('signOut')}</button>
                <p class="hint">{t('signOutWhat')}</p>
              </>
            ) : (
              <>
                <button class="btn btn-sm" onClick={() => setSigningIn(true)}>{t('signIn')}</button>
                <p class="hint">{t('signInWhy')}</p>
              </>
            )}
          </SettingRow>
        )}

        {/*
          主題／語言各只有 2-3 個選項，攤開就是一整條 .segmented 的高度。展開
          用的是篩選列同一顆元件（見 roll-call.md「分段控制」）；選了就收回去，
          不必再點一次收合。
        */}
        <SettingRow
          label={t('theme')}
          value={themeName}
          open={open === 'theme'}
          onToggle={toggle('theme')}
        >
          <div class="segmented" role="group" aria-label={t('theme')}>
            {(['system', 'light', 'dark'] as const).map((theme) => (
              <button
                key={theme}
                class="segment"
                aria-pressed={p.theme === theme}
                onClick={() => { void setPrefs({ theme }); setOpen(null) }}
              >
                {theme === 'system' ? t('themeSystem') : theme === 'light' ? t('themeLight') : t('themeDark')}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow
          label={t('language')}
          value={p.lang === 'zh' ? '中文' : 'English'}
          open={open === 'lang'}
          onToggle={toggle('lang')}
        >
          <div class="segmented" role="group" aria-label={t('language')}>
            {(['zh', 'en'] as const).map((lang) => (
              <button
                key={lang}
                class="segment"
                aria-pressed={p.lang === lang}
                onClick={() => { void setPrefs({ lang }); setOpen(null) }}
              >
                {lang === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </SettingRow>
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
