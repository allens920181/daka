import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, archivedRooms, connection, copyRoom, deleteRoom, deleteSavedRoster,
  setRoomArchived,
  identity, members, openMenuOnEnter, prefs, renameSavedRoster, requestCode,
  room, roomExpiry, saveRosterAs, savedRosters,
  session, setCheckerName, setPrefs,
  showToast,
  signIn, signOut, startGoogleSignIn,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { copyToClipboard } from '../lib/clipboard'
import { inAppBrowser, secureOrigin } from '../lib/config'
import { formatDate } from '../lib/format'
import type { SavedRoster } from '../lib/types'
import { currentRoute, joinUrl, navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { ConfirmDialog, Sheet } from './Sheet'
import { errorMessage } from './NewRoom'
import {
  IconArchive, IconBookmark, IconChevronRight, IconCopy, IconDuplicate,
  IconEdit, IconGoogle, IconHash, IconLink, IconMore,
  IconQr, IconShare, IconTrash,
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

type ManageMode = 'menu' | 'saveRoster'
  | 'invite' | 'inviteCode' | 'inviteLink' | 'inviteQr'

/**
 * 空間裡的「更多」：**這份名單的事**。
 *
 * 這條清單一路瘦下來——13 項 → 三個分頁 → 一條平的選單。2026-09 又走了三批：
 * 邀請點名、臨時加人、結束點名搬到底部動作列與頂欄（一場活動的三個時刻，每次
 * 都要先開一層才按得到是不對的）；「匯出名單」搬進結束點名（把結果交出去是收尾
 * 的一部分）；**建立副本與刪除空間搬去首頁那顆「更多」**（見 `RoomActionsSheet`）。
 *
 * 剩下的三項都是**這個空間裡面**的事：把代碼發出去、把名單弄對、把名單留下來。
 * 這也是這一顆與首頁那一顆的分工：**進來以後做裡面的事，退出去做空間本身的事。**
 *
 * 「邀請點名」2026-09 在選單 → 底部動作列 → 頂欄圖示鍵之後又收回這裡：一個
 * 空間只該有一顆「更多」，分享單獨掛在頂欄時，同一張面板有兩個入口通往它的
 * 不同頁，而使用者要記的變成「哪一件事在外面、哪一件事在裡面」。
 *
 * （這兩份清單 2026-09 稍早曾經合成一份，理由是「同一顆更多在兩個地方打開不一樣
 * 的東西，使用者要記兩份」。合併沒有解決那件事，只是把它換了個位置：首頁那顆
 * 「更多」變成先把人帶進空間、載入名單、再打開一份裡面大半用不到的清單——按一顆
 * 「刪除空間」要先等整份名單同步完。分開之後兩邊各自都短，而且判準說得出口：
 * 名單的事 vs 空間本身的事。）
 */
export function ManageSheet({ owner, initialMode, onEdit, onClose }: {
  owner: boolean
  /** 剛建立完副本、或從底部動作列按「邀請點名」進來時，直接開在邀請頁。 */
  initialMode?: ManageMode
  /** 「編輯」不是面板裡的一頁，是點名畫面自己的一個狀態，所以交回 Room 開。 */
  onEdit: () => void
  onClose: () => void
}) {
  const t = useT()
  const [mode, setMode] = useState<ManageMode>(initialMode ?? 'menu')
  const [value, setValue] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = room.value
  if (!current) return null
  const url = joinUrl(current.code)
  // 單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。
  const localOnly = connection.value === 'local-only'

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
          {error && <p class="note note-error">{error}</p>}
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

  /*
    邀請的三種方式各自一頁，不全部疊在同一張面板上。代碼那一頁只有代碼：
    06:50 的車門口是隔著一支手臂把它唸出去，那個字級（.code-display）需要
    整頁的寬度，旁邊再擺 QR 與連結只會讓三件事互相搶。
  */
  if (mode === 'inviteCode') {
    return (
      <Sheet title={t('roomCode')} onClose={onClose} onBack={() => setMode('invite')} depth={2}>
        {/*
          複製收成代碼右邊的一顆圖示（2026-09），不再是底下一顆滿版的按鈕。
          這一頁的主角是那六個字——它是隔著一支手臂唸出去的東西，整頁的寬度都
          該留給它；而複製是「順手也可以這樣做」，不值得用一整列去宣告。
          左邊那個等寬的空白（`::before`）讓代碼落在整個框的正中間，而不是被
          右邊那顆鍵擠得偏左。
        */}
        <div class="copy-row is-centered">
          <div class="code-display">{current.code}</div>
          <button
            class="icon-btn"
            aria-label={t('copyCode')}
            onClick={() => { void copyText(current.code, t('copied'), t('copyFailed')) }}
          >
            <IconCopy size={20} />
          </button>
        </div>
      </Sheet>
    )
  }

  if (mode === 'inviteLink') {
    return (
      <Sheet title={t('roomLink')} onClose={onClose} onBack={() => setMode('invite')} depth={2}>
        <div class="stack">
          {/*
            連結先印出來：看得到它指去哪一個空間，才敢貼進 200 人的 LINE 群。
            複製收成它右邊的一顆圖示（2026-09）——同一件事（把這串字帶走）不該
            在同一頁上出現兩次：一次是網址本身，一次是底下一整列寫著「複製連結」。
            底下留下來的是「傳給別人」，那是另一件事（叫出系統分享單）。
          */}
          <div class="copy-row">
            <p class="link-display">{url}</p>
            <button
              class="icon-btn"
              aria-label={t('copyLink')}
              onClick={() => { void copyText(url, t('copied'), t('copyFailed')) }}
            >
              <IconCopy size={20} />
            </button>
          </div>
          <button class="btn btn-primary btn-block" onClick={() => { void shareLink(url, t) }}>
            <IconShare /> {t('shareLink')}
          </button>
        </div>
      </Sheet>
    )
  }

  if (mode === 'inviteQr') {
    return (
      <Sheet title={t('roomQr')} onClose={onClose} onBack={() => setMode('invite')} depth={2}>
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
          /*
            三列，每一列一種方式，順序是**代碼 → 連結 → 二維碼**：代碼是隔著車門
            喊得出去的，連結是貼進 LINE 群的，二維碼要對方拿起手機對著你的螢幕
            ——愈往下愈需要兩個人站在一起。

            這一頁 2026-09 只剩這三列：底下那句「不用註冊、不用安裝」是在回答一個
            沒有人在這一刻問的問題（要發代碼的人早就決定要發了），而「現在在這個
            空間裡」那一區連同 presence 追蹤一起拿掉了。代碼那一列右邊也不再印代碼
            本身——點進去那一頁整頁就是它，用得上的字級在這裡放不下。
          */
          <div class="sheet-items">
            <button class="sheet-item" onClick={() => setMode('inviteCode')}>
              <IconHash />
              <span class="sheet-item-main"><strong>{t('roomCode')}</strong></span>
              <IconChevronRight class="go" />
            </button>

            <button class="sheet-item" onClick={() => setMode('inviteLink')}>
              <IconLink />
              <span class="sheet-item-main"><strong>{t('roomLink')}</strong></span>
              <IconChevronRight class="go" />
            </button>

            <button class="sheet-item" onClick={() => setMode('inviteQr')}>
              <IconQr />
              <span class="sheet-item-main"><strong>{t('roomQr')}</strong></span>
              <IconChevronRight class="go" />
            </button>
          </div>
        )}
      </Sheet>
    )
  }

  return (
    <Sheet
      title={current.name}
      onClose={onClose}
    >
      {/* 協助者看到的項目少一半，要有一句話說清楚少了什麼。 */}
      {!owner && <p class="hint" style="margin-bottom:10px">{t('helperLimits')}</p>}

      {/*
        照一場活動的時間軸排：把代碼發出去（開場）→ 把名單弄對 → 把它留下來。
        三列都是「這個空間裡面」的事；空間本身的事（建立副本、刪除空間）在首頁
        那顆「更多」裡，車開了那一刻的事在「結束點名」的確認鍵前面。
      */}
      <div class="sheet-items">
        {/*
          邀請點名。它 2026-09 在三個地方待過：選單 → 底部動作列 → 頂欄的分享
          圖示 → 又回到選單。理由是**一個空間只該有一顆「更多」**：分享單獨掛在
          頂欄時，這個畫面上同時有兩個入口通往同一張面板的不同頁，而使用者要記
          的是「哪一件事在外面、哪一件事在裡面」。收回來之後頂欄只剩返回、標題、
          更多，選單也不再是薄薄一兩列。
          代價：發代碼要多開一層。那是一場活動按一次的動作，而且不趕時間——
          真正趕的那一顆（結束點名）在底部動作列上，沒有跟著收進來。
        */}
        <button class="sheet-item" onClick={() => setMode('invite')}>
          <IconShare />
          <span class="sheet-item-main"><strong>{t('invite')}</strong></span>
          <IconChevronRight class="go" />
        </button>

        {/*
          編輯不開子畫面，直接把點名畫面切進編輯模式（見 Room.tsx）：名字右邊
          長出叉叉、底下變成一顆「＋」、標題變成可以改的輸入框。改的是眼前這份
          名單，不是它的文字複本。協助者也進得去——他只是看不到叉叉與標題。
        */}
        <button class="sheet-item" onClick={() => { onEdit(); }}>
          <IconEdit />
          <span class="sheet-item-main"><strong>{t('edit')}</strong></span>
        </button>

        {owner && isSupabaseConfigured && (
          <button
            class="sheet-item"
            onClick={() => { setValue(current.name); setMode('saveRoster') }}
          >
            <IconBookmark />
            <span class="sheet-item-main"><strong>{t('saveAsRoster')}</strong></span>
            <IconChevronRight class="go" />
          </button>
        )}

      </div>

      {error && <p class="note note-error" style="margin-top:12px">{error}</p>}

    </Sheet>
  )
}

// ---------------------------------------------------------------------------

type ActionsMode = 'menu' | 'copy' | 'remove'
type Confirming = null | 'delete' | 'forget'

/**
 * 首頁清單上每一列右邊那顆「更多」：**空間本身的事**。
 *
 * 兩列：建立副本（把這一間再開一次）、刪除空間（不要了，裡面收著「從清單移除」）。
 * 它們動的都是空間這個容器，不是裡面那份名單——所以不必先進去、不必等名單同步，
 * 在首頁按就是了。名單的事在空間裡那顆「更多」（`ManageSheet`）。
 *
 * 這兩份清單 2026-09 稍早曾經合成一份：首頁那顆「更多」先把人帶進空間再打開空間
 * 自己的那一份。理由是「同一顆更多在兩個地方打開不一樣的東西，使用者要記兩份」。
 * 合併沒有解決那件事，只是換了個位置——按一顆「刪除空間」要先進空間、等整份名單
 * 載完、再從一份大半用不到的清單裡找到最後一列。分開之後兩邊各自都短，而且判準
 * 講得出口：**在裡面做名單的事，在外面做空間的事。**
 *
 * 代價：人在空間裡想刪掉這一間，要先按返回回到首頁。刪除一場活動不是趕時間的
 * 動作，多那一步換到的是兩份清單都短、而且各自只講一件事。
 */
export function RoomActionsSheet({ code, name, owner, onClose }: {
  code: string
  name: string
  owner: boolean
  onClose: () => void
}) {
  const t = useT()
  const [mode, setMode] = useState<ActionsMode>('menu')
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [value, setValue] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
    自動刪除的日期。首頁的兩份清單只有「我的活動」帶得到 expires_at，本機那份
    要去快照裡拿（見 store.ts 的 roomExpiry），所以這裡是非同步的。拿不到就不印
    ——那一列照樣按得下去，不要為了湊一句話去猜一個日期。
  */
  const [expires, setExpires] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void roomExpiry(code).then((iso) => { if (alive && iso) setExpires(formatDate(iso, prefs.value.lang)) })
    return () => { alive = false }
  }, [code])

  /*
   * 封存（2026-09，取代「從清單移除」）。
   *
   * 舊那顆只對本機那份「最近的空間」有意義——帳號那份（`myRooms`）移掉了下一次
   * 同步又會長回來，所以它對登入的主揪根本沒作用。**封存不受這個限制**：它存在
   * 一份獨立的本機清單上，首頁兩份來源都照它篩，所以誰的空間都封存得起來。
   */
  const archived = archivedRooms.value.includes(code)

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
          {/* 協助者要知道新空間會是他的——選單列的副標拿掉之後，只剩這裡說得出來。 */}
          <p class="hint">{owner ? t('copyRoomHint') : t('copyRoomHintHelper')}</p>
          <div class="field">
            <label class="label" for="copy-name">{t('copyRoomName')}</label>
            <input
              id="copy-name" class="input" value={value} maxLength={80}
              onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
          {error && <p class="note note-error">{error}</p>}
          <button
            class="btn btn-primary btn-block"
            disabled={working || !value.trim()}
            onClick={() => { void run(async () => {
              const next = await copyRoom(code, value)
              onClose()
              // 副本是新的代碼，而五支協助的手機還開著舊空間——他們的畫面完全沒有
              // 變化，會繼續在舊空間打勾。複製完的下一個動作 100% 是把新代碼發
              // 出去，所以直接導進新空間、面板停在邀請頁。
              openMenuOnEnter.value = { code: next, mode: 'invite' }
              navigate(`/r/${next}`)
            }) }}
          >
            {working ? t('loading') : t('confirm')}
          </button>
        </div>
      </Sheet>
    )
  }



  /*
    這一份**要有標題列**，跟空間裡那一份相反。那一份的標題印的是空間名字，而那個
    名字就在面板正上方的頂欄裡，同一屏印兩次；這一份是從一列七個長得差不多的空間
    裡點開的，不印名字就沒有東西說得出「我剛剛按的是哪一間」。
  */
  return (
    <Sheet title={name} onClose={onClose}>
      <div class="sheet-items">
        {/*
          複製不限主揪。三個真實劇本都會踩到：主揪臨時不能來、手機在遊覽車上
          沒電、在山區沒訊號被降級成協助者——而那時候「回程再點一次」是產品
          方向書明列的核心情境，現場卻只能重貼一次 LINE 接龍重開空間。
          複製對來源空間完全無害（一個字都不改），而名單本來就對所有拿得到代碼
          的人可見，所以把它鎖在擁有權後面沒有保護到任何東西。
        */}
        <button
          class="sheet-item"
          onClick={() => {
            setValue(name.includes(t('returnTrip')) ? name : `${name} · ${t('returnTrip')}`)
            setMode('copy')
          }}
        >
          <IconDuplicate />
          <span class="sheet-item-main"><strong>{t('copyRoom')}</strong></span>
          <IconChevronRight class="go" />
        </button>

        {/*
          封存（2026-09，取代「從清單移除」）。

          **它不是一種刪除，所以不再收在「刪除空間」裡面。** 舊的做法把兩者並排
          在同一張子畫面上，理由是「按下去的當下想的是同一件事」——但那不成立：
          一個什麼都沒動、隨時拿得回來，另一個是所有人的紀錄一起沒。把可逆的東西
          擺在不可逆的旁邊，只會讓人在按之前多猶豫一次。

          也因為它可逆，**不需要確認對話框**。舊那顆要問，是因為它會連本機快照
          一起刪掉。
        */}
        <button
          class="sheet-item"
          onClick={() => { void run(async () => { await setRoomArchived(code, !archived); onClose() }) }}
        >
          <IconArchive />
          <span class="sheet-item-main">
            <strong>{archived ? t('unarchiveRoom') : t('archiveRoom')}</strong>
          </span>
        </button>

        {/*
          自動刪除的日期印在這一列右邊：那句話講的就是「這個空間什麼時候會不見」，
          跟這一列是同一件事的兩種發生方式——你按，或是時間到。**印的是值，不是
          說明**。
        */}
        {owner && (
          <button class="sheet-item danger" onClick={() => setConfirming('delete')}>
            <IconTrash />
            <span class="sheet-item-main">
              <strong>{t('deleteRoom')}</strong>
              {expires && <span class="sub">{t('expiresOn', { date: expires })}</span>}
            </span>
          </button>
        )}
      </div>

      {error && <p class="note note-error" style="margin-top:12px">{error}</p>}

      {confirming === 'delete' && (
        <ConfirmDialog
          title={t('deleteRoom')}
          body={t('deleteRoomWarning')}
          confirmLabel={t('deleteRoom')}
          danger
          onClose={() => setConfirming(null)}
          onConfirm={() => { void run(async () => { await deleteRoom(code); onClose() }) }}
        />
      )}
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
      <div class="stack walkin">
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
        <div class="sheet-items">
          <button class="sheet-item" onClick={() => { setValue(active.name); setMode('rename') }}>
            <IconEdit />
            <span class="sheet-item-main"><strong>{t('rename')}</strong></span>
            <IconChevronRight class="go" />
          </button>
          <button class="sheet-item danger" onClick={() => setConfirmingDelete(true)}>
            <IconTrash />
            <span class="sheet-item-main"><strong>{t('deleteRoster')}</strong></span>
          </button>
        </div>
        {error && <p class="note note-error">{error}</p>}

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
      <Sheet title={t('rename')} onClose={onClose} onBack={() => setMode('actions')} depth={2}>
        <div class="stack">
          <input
            class="input" value={value} maxLength={80} aria-label={t('rename')}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          />
          {error && <p class="note note-error">{error}</p>}
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
          <div class="sheet-items">
            {savedRosters.value.map((r) => (
              <div class="row" key={r.id}>
                <button class="sheet-item" style="flex:1; min-width:0" onClick={() => onApply(r)}>
                  <IconBookmark />
                  <span class="sheet-item-main">
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
 * 設定。四列：暱稱、帳戶、主題、語言——都是跟這台裝置／這個人有關的偏好，
 * 跟任何一個空間無關（所以這個面板只從首頁進得去，見 04-components/overlays.md）。
 *
 * **每一列點了都是開一張子畫面**（2026-09）。它們本來是「就地上下展開」，
 * 而那是**全 app 唯一一個會在原地長高的地方**：其他每一張面板（更多、邀請點名、
 * 空間的更多、常用名單）都是換頁。理由不是「統一比較好看」，是三件具體的事：
 *
 * 1. **面板不再在腳下移動。** 實測展開一列會讓面板從 280 長到 360——而這個檔案
 *    原本的註解寫著「高度鎖住⋯展開與收合都在同一個位置發生」，`Sheet` 根本沒有
 *    鎖高度的參數。**那個機制從來不存在**，而它想解決的正是這個問題。
 * 2. **少一個互動方案。** 全 app 的箭頭因此只剩兩個方向：`›` 進去、`‹` 回來。
 *    `.chevron`／`IconChevronDown` 一併移除。
 * 3. **這裡本來就有現成的子畫面機制。** 「重新命名」「建立副本」「存成常用名單」
 *    都是「標籤 ＋ 輸入框 ＋ 確認」的子畫面，暱稱跟它們是同一種東西。
 *
 * **沒有換成原生 `<select>`**：主題 3 個選項、語言 2 個，而原生選單在 iOS 上是
 * 「點 → 滾輪 → 完成」，比現在多一次操作；規範自己也寫著 2–4 個選項用
 * `.segmented`。而且它蓋不到暱稱（文字）與帳戶（兩顆按鈕）——那兩列還是得有
 * 別的做法，等於**多一種方案而不是少一種**。
 *
 * 收合列右邊仍然印著目前的值（`.sheet-item-value`），不進去也看得到自己設了
 * 什麼——那個好處來自那一格，不是來自展開。
 */
/**
 * 「名單怎麼寫」。開空間那一頁頂欄、標題右邊那顆 `?`。
 *
 * **為什麼需要這一頁。** 這些規則本來只有兩個地方寫著：解析器的原始碼，與
 * README——而會去讀 README 的是工程師，不是站在遊覽車門口的主揪。範例（「填入
 * 範例」）示範得出「長什麼樣」，但示範不出「為什麼」：為什麼那串號碼跑到備註裡、
 * 為什麼那一行不見了、為什麼那六個人掛在第一車。人是在結果不如預期的時候才會
 * 想找說明，而那個時刻以前無處可去。
 *
 * **每一條都配一個看得出來的例子**（`.fmt-eg`，長得像輸入框裡的字）。光是
 * 「名字之後第一個空白＋數字起算備註」這句話，讀三遍也不如看一眼
 * `王小明 0912345678`。
 *
 * 它刻意**不是**格式的完整規格。`#未分組`（結束分車）與 `#1 王小明`（那是人不是
 * 車次）都真的有效，但都不在這裡——它們回答的是「我已經知道 # 是分車了，那
 * 邊界怎麼辦」，而會問到那一步的人，早就不需要這一頁了。說明長一倍，換來的是
 * 第一次打開的人多讀兩條用不到的規則。`〖〗`、20 字上限這些同理，留在 docs/。
 */
export function FormatHelpSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const rows: [string, string, string][] = [
    [t('fmtLines'), t('fmtLinesEg'), t('fmtLinesSay')],
    [t('fmtNotes'), t('fmtNotesEg'), t('fmtNotesSay')],
    ['', t('fmtNotesParenEg'), t('fmtNotesParenSay')],
    [t('fmtGroups'), t('fmtGroupsEg'), t('fmtGroupsSay')],
  ]
  return (
    <Sheet title={t('formatHelp')} onClose={onClose}>
      <div class="fmt">
        {rows.map(([heading, eg, say]) => (
          <div class={heading ? 'fmt-row is-head' : 'fmt-row'} key={eg}>
            {heading && <h3 class="label fmt-head">{heading}</h3>}
            {/* 例子用 code：它是一段要照著打的字，不是引用的句子。 */}
            <code class="mono fmt-eg">{eg}</code>
            <p class="fmt-say">{say}</p>
          </div>
        ))}
        {/* 略過那條沒有例子——它講的是「沒讀到的東西去哪了」，
            而那件事的例子就是畫面上那行「N 行看起來不是姓名，已略過」。 */}
        <p class="fmt-say fmt-tail">{t('fmtSkipped')}</p>
      </div>
    </Sheet>
  )
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const p = prefs.value
  const [name, setName] = useState(identity.value.checkerName)
  const [signingIn, setSigningIn] = useState(false)
  /** 現在停在哪一張子畫面；null 就是那份清單。 */
  const [mode, setMode] = useState<null | 'name' | 'account' | 'theme' | 'font' | 'toast' | 'lang'>(null)

  // 登入成功後要一路關到底：使用者的心智模型是「我登入了，讓我看到我的東西」，
  // 留在設定面板上會讓人以為沒成功。
  if (signingIn) {
    return <SignInSheet onCancel={() => setSigningIn(false)} onDone={onClose} />
  }

  const back = () => setMode(null)
  const themeName = p.theme === 'system' ? t('themeSystem')
    : p.theme === 'light' ? t('themeLight') : t('themeDark')
  const fontName = p.font === 'base' ? t('fontBase')
    : p.font === 'lg' ? t('fontLarge') : t('fontXLarge')
  const toastName = p.rollCallToast ? t('rollCallToastOn') : t('rollCallToastOff')

  if (mode === 'name') {
    // 離開這一頁就存。`onBlur` 也留著——用 Esc 直接關掉整張面板時焦點會先離開，
    // 那條路走不到下面這個 onBack。
    const save = () => { void setCheckerName(name); back() }
    return (
      <Sheet title={t('yourName')} onClose={onClose} onBack={save}>
        <div class="stack">
          <div class="field">
            {/*
              **標籤收進輸入框裡**（2026-09）。
              這一頁只有一個欄位，而你是點了一列叫「暱稱」的東西才進來的——畫面
              再印一次「暱稱」是同一個字說第三遍（面板的 aria-label 也是它）。
              空的時候由 placeholder 說，寫了之後那兩個字的工作已經做完了。

              **`<label>` 沒有拿掉，只是看不見**：placeholder 不是可靠的無障礙
              名稱（規範 §inputs「placeholder 不得取代 label」擋的就是這件事）。
              這裡放行的是「看得見的那一份」，不是那個名稱本身。

              說明沒有跟著收進去：量過，「暱稱（選填，別人會看到是你點的）」在
              320px 的手機上**預設字級就會被截斷**（272 / 262px），放大字級是
              530px。而且它講的是後果，那是打字的當下最該看得到的一句。
            */}
            <label class="sr-only" for="checker-name">{t('yourName')}</label>
            <input
              id="checker-name" class="input" value={name} maxLength={40}
              placeholder={t('yourNamePlaceholder')}
              // return 鍵變成「完成」，按下去就跟按返回一樣：存起來、回上一頁。
              enterkeyhint="done"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
              onBlur={() => { void setCheckerName(name) }}
            />
          </div>
        </div>
      </Sheet>
    )
  }

  if (mode === 'account') {
    return (
      <Sheet title={t('account')} onClose={onClose} onBack={back}>
        <div class="stack">
          {session.value ? (
            <>
              {/*
                登入後收成**一列**：左邊是「你是誰」，右邊是那一個動作。
                滿版的登出鍵會讓這一頁看起來像在邀請你按它，而這一頁真正要回答的
                問題是「我現在是用哪個帳號」——那個答案本來只印在上一層的收合列上。

                登出鍵刻意做小（`.btn-sm`）：這支手機可能就是今天唯一管得動這場
                活動的裝置。按登出的常見動機是「借手機給人用一下」，使用者不會
                預期代價是失去控制。不加確認對話框（重新登入就還原），但後果要
                用底下那句 `.hint` 講出來。
              */}
              <div class="row">
                <span class="account-who">{session.value.email}</span>
                <span class="spacer" />
                <button class="btn btn-sm" onClick={() => { void signOut() }}>{t('signOut')}</button>
              </div>
              <p class="hint">{t('signOutWhat')}</p>
            </>
          ) : (
            <>
              <button class="btn btn-block" onClick={() => setSigningIn(true)}>{t('signIn')}</button>
              <p class="hint">{t('signInWhy')}</p>
            </>
          )}
        </div>
      </Sheet>
    )
  }

  /*
    主題／語言各只有 2–3 個選項，用的是篩選列同一顆 `.segmented`
    （見 roll-call.md「分段控制」）。**選了就自己返回**，不必再按一次返回鍵——
    這一頁存在的理由只有那一個選擇。
  */
  if (mode === 'theme') {
    return (
      <Sheet title={t('theme')} onClose={onClose} onBack={back}>
        <div class="field">
          {/* 標題小字拿掉了（2026-09）：你是點了那一列進來的，面板的 aria-label
              也是同一個字，畫面再印一次是第三遍。分段控制自己的 aria-label 還在，
              螢幕閱讀器聽得到的沒有變少。 */}
          <div class="segmented" role="group" aria-label={t('theme')}>
            {(['system', 'light', 'dark'] as const).map((theme) => (
              <button
                key={theme}
                class="segment"
                aria-pressed={p.theme === theme}
                onClick={() => { void setPrefs({ theme }); back() }}
              >
                {theme === 'system' ? t('themeSystem') : theme === 'light' ? t('themeLight') : t('themeDark')}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    )
  }

  /*
    文字大小。三個選項，所以跟主題一樣用 `.segmented`。

    **它是倍率，不是字級。** 那七階仍然跟著系統的 Dynamic Type 走，這裡選的是
    「在那之上再放大多少」——所以底下那句 `.hint` 是必要的，不然選了「標準」
    卻發現字跟系統一樣大的人會以為這顆鍵沒有作用。

    這一頁**不自己返回**（主題與語言會）。放大字級是一件要看著結果調的事：
    整張面板就在眼前跟著變，留在這裡才看得到自己選了什麼。
  */
  if (mode === 'font') {
    return (
      <Sheet title={t('fontSize')} onClose={onClose} onBack={back}>
        <div class="field">
          {/* 標題小字拿掉了（2026-09）：你是點了那一列進來的，面板的 aria-label
              也是同一個字，畫面再印一次是第三遍。分段控制自己的 aria-label 還在，
              螢幕閱讀器聽得到的沒有變少。 */}
          <div class="segmented" role="group" aria-label={t('fontSize')}>
            {(['base', 'lg', 'xl'] as const).map((font) => (
              <button
                key={font}
                class="segment"
                aria-pressed={p.font === font}
                onClick={() => { void setPrefs({ font }) }}
              >
                {font === 'base' ? t('fontBase') : font === 'lg' ? t('fontLarge') : t('fontXLarge')}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    )
  }

  /*
    點名提示。兩個選項，跟語言一樣用 `.segmented`。

    跟其他子畫面一樣不留說明（使用者要求）。**代價記著**：它關掉的是一張安全網
    （誤觸後那句「某某 · 已到」與「復原」），而現在沒有任何地方講這件事——選
    「不顯示」的人不會知道自己少了什麼。要補回來的話，這一頁還有位置放一句 `.hint`。

    選了不自己返回：跟字級一樣，這是會想看一眼自己選了什麼的設定。
  */
  if (mode === 'toast') {
    return (
      <Sheet title={t('rollCallToast')} onClose={onClose} onBack={back}>
        <div class="field">
          <div class="segmented" role="group" aria-label={t('rollCallToast')}>
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                class="segment"
                aria-pressed={p.rollCallToast === on}
                onClick={() => { void setPrefs({ rollCallToast: on }) }}
              >
                {on ? t('rollCallToastOn') : t('rollCallToastOff')}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    )
  }

  if (mode === 'lang') {
    return (
      <Sheet title={t('language')} onClose={onClose} onBack={back}>
        <div class="field">
          {/* 標題小字拿掉了（2026-09）：你是點了那一列進來的，面板的 aria-label
              也是同一個字，畫面再印一次是第三遍。分段控制自己的 aria-label 還在，
              螢幕閱讀器聽得到的沒有變少。 */}
          <div class="segmented" role="group" aria-label={t('language')}>
            {(['zh', 'en'] as const).map((lang) => (
              <button
                key={lang}
                class="segment"
                aria-pressed={p.lang === lang}
                onClick={() => { void setPrefs({ lang }); back() }}
              >
                {lang === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={t('settings')} onClose={onClose}>
      <div class="sheet-items">
        <button class="sheet-item" onClick={() => setMode('name')}>
          <span class="sheet-item-main"><strong>{t('yourName')}</strong></span>
          <span class="sheet-item-value">{name.trim() || t('notSet')}</span>
          <IconChevronRight class="go" />
        </button>

        {/* 沒設定雲端的建置沒有帳戶這回事，整列不出現——不給一個按了只會說
            「還沒設定雲端連線」的入口。 */}
        {isSupabaseConfigured && (
          <button class="sheet-item" onClick={() => setMode('account')}>
            <span class="sheet-item-main"><strong>{t('account')}</strong></span>
            <span class="sheet-item-value">
              {session.value ? session.value.email : t('notSignedIn')}
            </span>
            <IconChevronRight class="go" />
          </button>
        )}

        <button class="sheet-item" onClick={() => setMode('theme')}>
          <span class="sheet-item-main"><strong>{t('theme')}</strong></span>
          <span class="sheet-item-value">{themeName}</span>
          <IconChevronRight class="go" />
        </button>

        <button class="sheet-item" onClick={() => setMode('font')}>
          <span class="sheet-item-main"><strong>{t('fontSize')}</strong></span>
          <span class="sheet-item-value">{fontName}</span>
          <IconChevronRight class="go" />
        </button>

        <button class="sheet-item" onClick={() => setMode('toast')}>
          <span class="sheet-item-main"><strong>{t('rollCallToast')}</strong></span>
          <span class="sheet-item-value">{toastName}</span>
          <IconChevronRight class="go" />
        </button>

        <button class="sheet-item" onClick={() => setMode('lang')}>
          <span class="sheet-item-main"><strong>{t('language')}</strong></span>
          <span class="sheet-item-value">{p.lang === 'zh' ? '中文' : 'English'}</span>
          <IconChevronRight class="go" />
        </button>
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
    /*
      **返回鍵回上一層，不是回上一個畫面。** 在選擇方式那一步，上一層是「帳戶」
      那一頁（`onCancel`）；已經走進 Email 或驗證碼那兩步的話，上一層是選擇方式。
      跟全 app 的 `‹` 是同一個意思——見 04-components 的方向記號。

      說明拿掉了（2026-09）：「為什麼要登入」那句話在上一頁（帳戶）已經講過，
      而你按了「登入」才會走到這裡——走進來的人已經被說服了。
    */
    <Sheet
      title={t('signIn')}
      onClose={onCancel}
      onBack={step === 'choose' ? onCancel : () => { setStep('choose'); setError(null) }}
    >
      <div class="stack">

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
            {error && <p class="note note-error">{error}</p>}

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
                // 「傳送」——按下去寄出驗證碼，就是底下 onKeyDown 做的事。
                // 不是「下一個」：下一欄要等信到了才存在。
                enterkeyhint="send"
                autocomplete="email"
                value={email}
                placeholder={t('emailPlaceholder')}
                onInput={(e) => { setEmail((e.currentTarget as HTMLInputElement).value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@')) void send() }}
              />
            </div>
            {error && <p class="note note-error">{error}</p>}
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
                // 「前往」——六碼打滿按下去就驗證並登入。
                enterkeyhint="go"
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
            {error && <p class="note note-error">{error}</p>}
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
