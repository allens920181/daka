import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import {
  AuthError, addWalkIn, connection, copyRoom, deleteRoom, deleteSavedRoster, forgetRecentRoom,
  identity, members, myRooms, openMenuOnEnter, prefs, recentRooms, renameSavedRoster, requestCode,
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
  IconBookmark, IconClose, IconCopy, IconDuplicate, IconEdit, IconHash,
  IconChevronDown, IconGoogle, IconLink, IconMore,
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

  /*
    邀請的三種方式各自一頁，不全部疊在同一張面板上。代碼那一頁只有代碼：
    06:50 的車門口是隔著一支手臂把它唸出去，那個字級（.code-display）需要
    整頁的寬度，旁邊再擺 QR 與連結只會讓三件事互相搶。
  */
  if (mode === 'inviteCode') {
    return (
      <Sheet title={t('roomCode')} onClose={onClose} onBack={() => setMode('invite')}>
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
      <Sheet title={t('roomLink')} onClose={onClose} onBack={() => setMode('invite')}>
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
          /*
            三列，每一列一種方式，順序是**代碼 → 連結 → 二維碼**：代碼是隔著車門
            喊得出去的，連結是貼進 LINE 群的，二維碼要對方拿起手機對著你的螢幕
            ——愈往下愈需要兩個人站在一起。

            這一頁 2026-09 只剩這三列：底下那句「不用註冊、不用安裝」是在回答一個
            沒有人在這一刻問的問題（要發代碼的人早就決定要發了），而「現在在這個
            空間裡」那一區連同 presence 追蹤一起拿掉了。代碼那一列右邊也不再印代碼
            本身——點進去那一頁整頁就是它，用得上的字級在這裡放不下。
          */
          <div class="menu">
            <button class="menu-item" onClick={() => setMode('inviteCode')}>
              <IconHash />
              <span><strong>{t('roomCode')}</strong></span>
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
        )}
      </Sheet>
    )
  }

  return (
    <Sheet
      title={current.name}
      onClose={onClose}
      /*
        整條標題列都不要（`head={false}`）。它一路瘦下來：「更多」兩個字說不出
        任何一件這裡做得到的事 → 換成三顆分頁鍵 → 分頁拿掉之後改印空間名字 →
        而那個名字就在面板正上方的頂欄裡，同一個字在同一屏印兩次，第二次只是
        佔掉一列。收起來的三條路（點遮罩、Esc、從握把往下滑）一條都沒有少，
        無障礙名稱也還是這個空間的名字。
      */
      head={false}
    >
      {/* 協助者看到的項目少一半，要有一句話說清楚少了什麼。 */}
      {!owner && <p class="hint" style="margin-bottom:10px">{t('helperLimits')}</p>}

      {/*
        照一場活動的時間軸排：把代碼發出去（開場）→ 把名單弄對 → 把它留下來。
        三列都是「這個空間裡面」的事；空間本身的事（建立副本、刪除空間）在首頁
        那顆「更多」裡，車開了那一刻的事在「結束點名」的確認鍵前面。
      */}
      <div class="menu">
        {/*
          邀請點名。它 2026-09 在三個地方待過：選單 → 底部動作列 → 頂欄的分享
          圖示 → 又回到選單。理由是**一個空間只該有一顆「更多」**：分享單獨掛在
          頂欄時，這個畫面上同時有兩個入口通往同一張面板的不同頁，而使用者要記
          的是「哪一件事在外面、哪一件事在裡面」。收回來之後頂欄只剩返回、標題、
          更多，選單也不再是薄薄一兩列。
          代價：發代碼要多開一層。那是一場活動按一次的動作，而且不趕時間——
          真正趕的那一顆（結束點名）在底部動作列上，沒有跟著收進來。
        */}
        <button class="menu-item" onClick={() => setMode('invite')}>
          <IconShare />
          <span><strong>{t('invite')}</strong></span>
        </button>

        {/*
          編輯不開子畫面，直接把點名畫面切進編輯模式（見 Room.tsx）：名字右邊
          長出叉叉、底下變成一顆「＋」、標題變成可以改的輸入框。改的是眼前這份
          名單，不是它的文字複本。協助者也進得去——他只是看不到叉叉與標題。
        */}
        <button class="menu-item" onClick={() => { onEdit(); }}>
          <IconEdit />
          <span><strong>{t('edit')}</strong></span>
        </button>

        {owner && isSupabaseConfigured && (
          <button
            class="menu-item"
            onClick={() => { setValue(current.name); setMode('saveRoster') }}
          >
            <IconBookmark />
            <span><strong>{t('saveAsRoster')}</strong></span>
          </button>
        )}

      </div>

      {error && <p class="note note-warn" style="margin-top:12px">{error}</p>}

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

  // 單機模式是建置期常數（沒設定 Supabase），不是暫時斷線。
  const localOnly = connection.value === 'local-only'
  // 「從清單移除」只對本機那份「最近的空間」有意義：「我的活動」是帳號那邊的
  // 清單，移掉了下一次同步又會長回來——那是一顆按了看起來沒反應的按鈕。
  const inRecents = recentRooms.value.some((r) => r.code === code)
  const inMyRooms = Boolean(session.value) && myRooms.value.some((r) => r.code === code)
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
    不要了。兩個選項擺在同一頁，因為它們的差別要並排看才看得出來：「從清單移除」
    只影響這支手機（別人照樣進得去），「刪除空間」是所有人的紀錄一起沒。

    單機模式是例外：那份名單只存在這支手機裡，移除等於刪掉，所以那時候的警告換
    一句話說，而且才用 danger。
  */
  if (mode === 'remove') {
    return (
      <Sheet title={t('deleteRoom')} onClose={onClose} onBack={() => setMode('menu')}>
        <p class="hint" style="margin-bottom:10px">{t('deleteHint')}</p>
        <div class="menu">
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

        {/*
          從清單移除也要問一次。它在首頁曾經是一顆一按就生效的垃圾桶，但在單機
          模式下它同時會清掉本機那份快照——那個空間就真的沒了，而按鍵旁邊沒有
          一個字說得出這件事。
        */}
        {confirming === 'forget' && (
          <ConfirmDialog
            title={t('forget')}
            body={localOnly ? t('forgetWarningLocal') : t('forgetWarning')}
            confirmLabel={t('forget')}
            danger={localOnly}
            onClose={() => setConfirming(null)}
            onConfirm={() => { void run(async () => { await forgetRecentRoom(code); onClose() }) }}
          />
        )}

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

  /*
    這一份**要有標題列**，跟空間裡那一份相反。那一份的標題印的是空間名字，而那個
    名字就在面板正上方的頂欄裡，同一屏印兩次；這一份是從一列七個長得差不多的空間
    裡點開的，不印名字就沒有東西說得出「我剛剛按的是哪一間」。
  */
  return (
    <Sheet title={name} onClose={onClose}>
      <div class="menu">
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
            setValue(name.includes(t('returnTrip')) ? name : `${name} · ${t('returnTrip')}`)
            setMode('copy')
          }}
        >
          <IconDuplicate />
          <span><strong>{t('copyRoom')}</strong></span>
        </button>

        {/*
          「從清單移除」收進「刪除空間」裡（2026-09）。按下去的當下想的是同一件事
          ——「我不要再看到這個」——差別在那句話是對誰說的：只有這支手機看不到，
          還是所有人的紀錄一起沒。選單上並排兩列等於要人在按之前就先分清楚，而那
          正好是點進去才講得完的事。

          自動刪除的日期印在這一列右邊：那句話講的就是「這個空間什麼時候會不見」，
          跟這一列是同一件事的兩種發生方式——你按，或是時間到。**印的是值，不是
          說明**。
        */}
        {(owner || forgettable) && (
          <button class="menu-item danger" onClick={() => setMode('remove')}>
            <IconTrash />
            <span>
              <strong>{t('deleteRoom')}</strong>
              {expires && <span class="sub">{t('expiresOn', { date: expires })}</span>}
            </span>
          </button>
        )}
      </div>

      {error && <p class="note note-warn" style="margin-top:12px">{error}</p>}
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
